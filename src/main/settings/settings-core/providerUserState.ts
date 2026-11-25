import {
  createProviderEntryFromCatalog,
  getProviderCatalogModelSummaries,
  getProviderModelSummaries,
  isBuiltinProviderId,
  listProviderSummaries,
} from '../../provider-catalog/ProviderCatalogRegistry';
import { resolvePrimaryConnectionSecretFieldId } from '../provider-auth/ProviderConnectionSchema';
import { secretStorageService } from './SecretStorageService';
import {
  applyModelEnabledState,
  cloneConnectionSchema,
  getProviderAccountSecretRef,
  getResolvedProviderSecret,
  isConnectionSchemaSatisfied,
  resolveProviderModels,
  resolveSelectedAuthAvailability,
  sanitizeAuthAccountIds,
  sanitizeConnectionValues,
} from './settingsProviderSanitize';
import type { UserModelState, UserProviderState } from './settingsFileSchema';
import type {
  LlmProviderAuthMode,
  LlmProviderConnectionStatus,
  LlmProviderEntry,
  LlmProviderModel,
} from '@shared/types/settings';

/** Composed providers by id. `SettingsService.providerConnections` is the live, memoized one. */
export interface ProviderConnections {
  get(providerId: string): LlmProviderEntry | undefined;
  list(): readonly LlmProviderEntry[];
}

/** What a reader needs to look one provider up. */
export type ProviderLookup = Pick<ProviderConnections, 'get'>;

/**
 * The runtime provider entry is composed from three inputs: the catalog (everything about the service), the user's
 * stored state (`UserProviderState`), and which credentials the secret store holds. `toUserProviderState` is the way
 * back: it keeps only the user's part of an entry, so catalog facts never enter the settings file.
 */

function modelRowsFromState(models: Record<string, UserModelState>): LlmProviderModel[] {
  return Object.entries(models).map(([id, model]) => ({
    id,
    label: model.label ?? id,
    enabled: model.enabled ?? true,
    defaultReasoningSelection: model.defaultReasoningSelection,
    defaultBudgetTokens: model.defaultBudgetTokens,
    preferredRouteOptionId: model.preferredRouteOptionId,
    ...(model.aliases ? { aliases: [...model.aliases] } : {}),
    availability: model.availability,
    availabilityReason: model.availabilityReason,
  }));
}

/** Account discovery is scoped to the signed-in identity: without its credential only always-listed rows remain. */
function visibleModels(
  providerId: string,
  observed: LlmProviderModel[],
  authMode: LlmProviderAuthMode,
  hasAccountCredential: boolean,
): LlmProviderModel[] {
  const resolved = resolveProviderModels(providerId, observed);
  if (authMode !== 'account' || hasAccountCredential) return resolved;
  const maintainedIds = new Set(getProviderCatalogModelSummaries(providerId)
    .filter((metadata) => metadata.presencePolicy === 'maintained')
    .map((metadata) => metadata.modelId));
  const structural = getProviderModelSummaries(providerId).filter((model) => maintainedIds.has(model.id));
  const structuralById = new Map(structural.map((model) => [model.id, model]));
  return applyModelEnabledState(structural, resolved).map((model) => ({
    ...model,
    availability: structuralById.get(model.id)?.availability,
    availabilityReason: structuralById.get(model.id)?.availabilityReason,
  }));
}

export function composeProviderEntry(
  providerId: string,
  state: UserProviderState | undefined,
  workspaceRoot: string,
): LlmProviderEntry {
  const catalog = createProviderEntryFromCatalog(providerId);
  const authModeOptions = catalog.authModeOptions ?? [catalog.authMode];
  const authMode = state?.authMode && authModeOptions.includes(state.authMode) ? state.authMode : catalog.authMode;
  const authAccountIds = { ...(state?.authAccountIds ?? {}) };
  const apiKeyAccountId = authAccountIds['api-key'];
  const connectionSchema = cloneConnectionSchema(catalog.connectionSchema);
  const primarySecretFieldId = resolvePrimaryConnectionSecretFieldId(connectionSchema);
  const connectionValues = sanitizeConnectionValues(connectionSchema, state?.connectionValues);
  const secretRef = getProviderAccountSecretRef(providerId, apiKeyAccountId, 'api-key');
  const apiKeySecret = getResolvedProviderSecret(providerId, secretRef, workspaceRoot);
  const oauthSecret = secretStorageService.getSecret(
    getProviderAccountSecretRef(providerId, authAccountIds.account, 'oauth'),
    workspaceRoot,
  );
  const secretRefs: Record<string, string> = {};
  const hasStoredConnectionSecrets: Record<string, boolean> = {};
  for (const field of connectionSchema?.fields ?? []) {
    if (field.kind !== 'secret') continue;
    if (field.id === primarySecretFieldId) {
      hasStoredConnectionSecrets[field.id] = Boolean(apiKeySecret);
      continue;
    }
    const fieldRef = apiKeyAccountId
      ? secretStorageService.createProviderConnectionSecretRef(providerId, apiKeyAccountId, field.id)
      : undefined;
    if (fieldRef && secretStorageService.hasSecretRecord(fieldRef, workspaceRoot)) secretRefs[field.id] = fieldRef;
    hasStoredConnectionSecrets[field.id] = Boolean(secretStorageService.getSecret(fieldRef, workspaceRoot));
  }
  const apiKeyCredentialPresent = connectionSchema?.fields.length
    ? isConnectionSchemaSatisfied(connectionSchema, connectionValues, hasStoredConnectionSecrets)
    : Boolean(apiKeySecret);
  const hasStoredSecretByAuthMode = Object.fromEntries(authModeOptions.map((mode) => [
    mode,
    mode === 'local' || mode === 'environment' ? true : mode === 'api-key' ? apiKeyCredentialPresent : Boolean(oauthSecret),
  ])) as Partial<Record<LlmProviderAuthMode, boolean>>;
  const hasStoredSecret = hasStoredSecretByAuthMode[authMode] === true;
  const models = visibleModels(
    providerId,
    state?.models ? modelRowsFromState(state.models) : catalog.models,
    authMode,
    hasStoredSecretByAuthMode.account === true,
  );
  const selectedAvailability = resolveSelectedAuthAvailability(providerId, authMode, catalog);
  const configuredAuthMode = state?.configuredAuthMode && authModeOptions.includes(state.configuredAuthMode)
    ? state.configuredAuthMode
    : undefined;
  const status: LlmProviderConnectionStatus = selectedAvailability.state === 'unavailable'
    ? 'unavailable'
    : state?.status === 'failed' && (!configuredAuthMode || configuredAuthMode === authMode)
      ? 'failed'
      : configuredAuthMode === authMode && hasStoredSecret ? 'verified' : 'unconfigured';
  return {
    id: providerId,
    activeAccountId: authAccountIds[authMode],
    authAccountIds,
    protocol: catalog.protocol,
    routeCount: catalog.routeCount,
    authMode,
    authModeOptions: catalog.authModeOptions,
    authModeAvailability: catalog.authModeAvailability,
    hasStoredSecretByAuthMode,
    configuredAuthMode,
    lifecycleStatus: catalog.lifecycleStatus,
    providerAvailability: catalog.providerAvailability,
    category: catalog.category,
    catalogOwnership: catalog.catalogOwnership,
    serviceOperator: catalog.serviceOperator,
    endpointClass: catalog.endpointClass,
    catalogProvenance: catalog.catalogProvenance,
    label: catalog.label,
    enabled: status === 'verified' && models.some((model) => model.enabled !== false),
    apiKey: '',
    secretRef,
    secretRefs,
    connectionValues,
    hasStoredConnectionSecrets,
    connectionSchema,
    hasStoredSecret,
    baseUrl: catalog.baseUrlEditable ? state?.baseUrl ?? catalog.baseUrl : catalog.baseUrl,
    baseUrlEditable: catalog.baseUrlEditable,
    models,
    recommendedModels: catalog.recommendedModels.filter((id) => models.some((model) => (
      model.id === id && model.enabled !== false && model.availability !== 'unavailable'
    ))),
    docsUrl: catalog.docsUrl,
    status,
    lastTestedAt: state?.lastTestedAt,
    lastModelRefreshAt: state?.lastModelRefreshAt,
    lastError: status === 'failed' ? state?.lastError : undefined,
    accountLogin: catalog.accountLogin,
    accountLabel: state?.accountLabel,
    planLabel: state?.planLabel,
    oauthExpiresAt: state?.oauthExpiresAt,
    oauthRefreshAvailable: state?.oauthRefreshAvailable,
    unavailableReason: selectedAvailability.state === 'unavailable' ? selectedAvailability.reason : undefined,
    isConfigured: status === 'verified',
    capabilities: catalog.capabilities,
  };
}

/**
 * Every catalog provider in catalog order. A stored provider the catalog no longer has stays in the file untouched; it
 * is left out here and reported, so a catalog update never makes the settings file unreadable.
 */
export function composeProviders(
  states: Record<string, UserProviderState>,
  workspaceRoot: string,
): { providers: LlmProviderEntry[]; orphanProviderIds: string[] } {
  return {
    providers: listProviderSummaries().map((surface) => composeProviderEntry(surface.id, states[surface.id], workspaceRoot)),
    orphanProviderIds: Object.keys(states).filter((providerId) => !isBuiltinProviderId(providerId)),
  };
}

function toUserModelStates(providerId: string, models: readonly LlmProviderModel[]): Record<string, UserModelState> {
  const catalogById = new Map(getProviderModelSummaries(providerId).map((model) => [model.id, model]));
  return Object.fromEntries(models.map((model) => {
    const catalogModel = catalogById.get(model.id);
    const manifestDenied = catalogModel?.availability === 'unavailable';
    const state: UserModelState = {
      ...(model.enabled === false ? { enabled: false } : {}),
      ...(model.defaultReasoningSelection ? { defaultReasoningSelection: model.defaultReasoningSelection } : {}),
      ...(model.defaultBudgetTokens ? { defaultBudgetTokens: model.defaultBudgetTokens } : {}),
      ...(model.preferredRouteOptionId ? { preferredRouteOptionId: model.preferredRouteOptionId } : {}),
      ...(!manifestDenied && model.availability && model.availability !== catalogModel?.availability
        ? { availability: model.availability }
        : {}),
      ...(!manifestDenied && model.availabilityReason ? { availabilityReason: model.availabilityReason } : {}),
      ...(!catalogModel && model.label && model.label !== model.id ? { label: model.label } : {}),
      ...(!catalogModel && model.aliases?.length ? { aliases: [...model.aliases] } : {}),
    };
    return [model.id, state];
  }));
}

function userStateOf(entry: LlmProviderEntry): UserProviderState {
  const catalog = createProviderEntryFromCatalog(entry.id);
  const authModeOptions = catalog.authModeOptions ?? [catalog.authMode];
  const authMode = authModeOptions.includes(entry.authMode) ? entry.authMode : catalog.authMode;
  const authAccountIds = sanitizeAuthAccountIds(entry, authMode);
  const configuredAuthMode = entry.configuredAuthMode && authModeOptions.includes(entry.configuredAuthMode)
    ? entry.configuredAuthMode
    : entry.status === 'verified' || entry.isConfigured ? authMode : undefined;
  const failed = entry.status === 'failed';
  const connectionValues = sanitizeConnectionValues(catalog.connectionSchema, entry.connectionValues);
  const baseUrl = entry.baseUrl?.trim();
  const optionalText = (value: string | undefined) => (typeof value === 'string' && value ? value : undefined);
  const state: UserProviderState = {
    authMode,
    ...(Object.keys(authAccountIds).length ? { authAccountIds } : {}),
    ...(configuredAuthMode ? { configuredAuthMode } : {}),
    ...(failed ? { status: 'failed' as const } : {}),
    ...(failed && typeof entry.lastError === 'string' ? { lastError: entry.lastError } : {}),
    ...(optionalText(entry.lastTestedAt) ? { lastTestedAt: entry.lastTestedAt } : {}),
    ...(optionalText(entry.lastModelRefreshAt) ? { lastModelRefreshAt: entry.lastModelRefreshAt } : {}),
    ...(Object.keys(connectionValues).length ? { connectionValues } : {}),
    ...(catalog.baseUrlEditable && baseUrl && baseUrl !== catalog.baseUrl ? { baseUrl } : {}),
    ...(typeof entry.accountLabel === 'string' ? { accountLabel: entry.accountLabel } : {}),
    ...(typeof entry.planLabel === 'string' ? { planLabel: entry.planLabel } : {}),
    ...(optionalText(entry.oauthExpiresAt) ? { oauthExpiresAt: entry.oauthExpiresAt } : {}),
    ...(typeof entry.oauthRefreshAvailable === 'boolean' ? { oauthRefreshAvailable: entry.oauthRefreshAvailable } : {}),
    models: toUserModelStates(entry.id, resolveProviderModels(entry.id, entry.models)),
  };
  return state;
}

/**
 * The user's part of a runtime entry, or `undefined` when the user has nothing stored for the provider (the entry is
 * what the catalog alone composes), so untouched providers never enter the file.
 */
export function toUserProviderState(entry: LlmProviderEntry, workspaceRoot: string): UserProviderState | undefined {
  const state = userStateOf(entry);
  const untouched = userStateOf(composeProviderEntry(entry.id, undefined, workspaceRoot));
  // Both states are built by userStateOf, so equal content serializes in the same key order.
  return JSON.stringify(state) === JSON.stringify(untouched) ? undefined : state;
}
