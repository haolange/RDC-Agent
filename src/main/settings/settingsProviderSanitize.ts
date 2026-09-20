import { randomUUID } from 'crypto';
import type {
  LlmAgentRoute,
  LlmProviderAuthMode,
  LlmProviderAvailability,
  LlmProviderConnectionStatus,
  LlmProviderConnectionSchema,
  LlmProviderEntry,
  LlmProviderModel,
  LlmProviderModelPreference,
} from '@shared/types/settings';
import { isReasoningSelection } from '@shared/types/modelCapability';
import { DEFAULT_MODEL_ROUTING, isSafeAgentProfileId } from '@shared/types/agent';
import {
  createProviderEntryFromCatalog,
  createProviderEntriesFromCatalog,
  getProviderAuthModeAvailability,
  getProviderCatalogModelSummaries,
  getProviderCatalogOwnership,
  getProviderDiscoveryAuthority,
  getProviderDefaultBaseUrl,
  getProviderModelSummaries,
  isBuiltinProviderId,
} from '../provider-catalog/ProviderCatalogRegistry';
import { appPathService } from '../runtime/AppPathService';
import { normalizeProviderCategory, normalizeProviderProtocol } from './providerCatalogNormalize';
import { secretStorageService } from './SecretStorageService';
import { isAdmittedDiscoveredModel, normalizeDiscoveredModelMatchKey } from './DiscoveryAdmission';
import { resolvePrimaryConnectionSecretFieldId } from './ProviderConnectionSchema';
import type { PersistedLlmProviderEntry } from './settingsDefaults';

export type ProviderCredentialView = 'runtime' | 'storage-metadata';

export interface ProviderSanitizeOptions {
  credentialView?: ProviderCredentialView;
}

export function isVendorSecretUsable(providerId: string, secret: string): boolean {
  const normalized = secret.trim();
  if (!normalized) {
    return false;
  }

  if (providerId === 'openrouter') {
    return /^sk-or-/i.test(normalized);
  }

  if (providerId === 'openai') {
    return /^sk-/i.test(normalized);
  }

  if (providerId === 'anthropic') {
    return /^sk-ant-/i.test(normalized);
  }

  return true;
}

export function getResolvedProviderSecret(providerId: string, secretRef: string | undefined, workspaceRoot: string): string {
  const secret = secretStorageService.getSecret(secretRef, workspaceRoot).trim();
  return isVendorSecretUsable(providerId, secret) ? secret : '';
}

export function createLocalAccountId(): string {
  return `account-${randomUUID()}`;
}

export function extractOAuthBundleAccountId(raw: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const accountId = (JSON.parse(raw) as { accountId?: unknown }).accountId;
    return typeof accountId === 'string' && accountId.trim() ? accountId.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function getProviderAccountSecretRef(
  providerId: string,
  accountId: string | undefined,
  kind: 'api-key' | 'oauth',
): string | undefined {
  return accountId
    ? secretStorageService.createProviderAccountSecretRef(providerId, accountId, kind)
    : undefined;
}

export function resolveProviderAuthMode(
  provider: Partial<LlmProviderEntry>,
  fallback: LlmProviderEntry,
): LlmProviderAuthMode {
  const options = fallback.authModeOptions ?? [fallback.authMode];
  return typeof provider.authMode === 'string' && options.includes(provider.authMode)
    ? provider.authMode
    : fallback.authMode;
}

export function sanitizeAuthAccountIds(
  provider: Partial<LlmProviderEntry>,
  selectedMode: LlmProviderAuthMode,
): Partial<Record<LlmProviderAuthMode, string>> {
  const result: Partial<Record<LlmProviderAuthMode, string>> = {};
  if (provider.authAccountIds && typeof provider.authAccountIds === 'object') {
    for (const mode of ['api-key', 'account', 'local', 'environment'] as const) {
      const accountId = provider.authAccountIds[mode];
      if (typeof accountId === 'string' && accountId.trim()) result[mode] = accountId.trim();
    }
  }
  if (!result[selectedMode] && typeof provider.activeAccountId === 'string' && provider.activeAccountId.trim()) {
    result[selectedMode] = provider.activeAccountId.trim();
  }
  return result;
}

export function resolveSelectedAuthAvailability(
  providerId: string,
  mode: LlmProviderAuthMode,
  fallback: LlmProviderEntry,
): LlmProviderAvailability {
  return getProviderAuthModeAvailability(providerId)[mode]
    ?? fallback.authModeAvailability?.[mode]
    ?? fallback.providerAvailability;
}

export function resolveAccountRuntimeCredential(
  provider: Pick<LlmProviderEntry, 'id' | 'activeAccountId'>,
  workspaceRoot: string,
): { apiKey: string; baseUrl?: string; accountId?: string } {
  const providerId = provider.id;
  const raw = secretStorageService.getSecret(
    getProviderAccountSecretRef(providerId, provider.activeAccountId, 'oauth'),
    workspaceRoot,
  );
  if (!raw) {
    return { apiKey: '' };
  }
  try {
    const bundle = JSON.parse(raw) as {
      accessToken?: string;
      apiKey?: string;
      copilotToken?: string;
      copilotApiBaseUrl?: string;
      accountId?: string;
      resourceUrl?: string;
    };
    if (providerId === 'github-copilot') {
      return {
        apiKey: bundle.copilotToken ?? '',
        baseUrl: bundle.copilotApiBaseUrl ?? 'https://api.githubcopilot.com',
      };
    }
    if (providerId === 'chatgpt-account') {
      return {
        apiKey: bundle.accessToken ?? bundle.apiKey ?? '',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        accountId: bundle.accountId,
      };
    }
    if (providerId === 'grok-account') {
      return {
        apiKey: bundle.accessToken ?? bundle.apiKey ?? '',
        baseUrl: 'https://cli-chat-proxy.grok.com/v1',
        accountId: bundle.accountId,
      };
    }
    if (providerId === 'nous') {
      return {
        apiKey: bundle.accessToken ?? bundle.apiKey ?? '',
        baseUrl: bundle.resourceUrl ?? 'https://inference-api.nousresearch.com/v1',
        accountId: bundle.accountId,
      };
    }
    if (providerId === 'openrouter') {
      return {
        apiKey: bundle.apiKey ?? bundle.accessToken ?? '',
        baseUrl: 'https://openrouter.ai/api/v1',
        accountId: bundle.accountId,
      };
    }
    return {
      apiKey: bundle.accessToken ?? '',
      baseUrl: 'https://api.anthropic.com/v1',
      accountId: bundle.accountId,
    };
  } catch {
    return { apiKey: '' };
  }
}

export function sanitizeModels(models: unknown): LlmProviderModel[] {
  const candidates = Array.isArray(models) ? models : [];
  const modelMap = new Map<string, LlmProviderModel>();

  for (const entry of candidates) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const candidate = entry as Partial<LlmProviderModel>;
    const modelId = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    if (!modelId || modelMap.has(modelId)) {
      continue;
    }
    const availability = candidate.availability === 'available'
      || candidate.availability === 'unavailable'
      || candidate.availability === 'unknown'
      ? candidate.availability
      : undefined;

    const aliases = Array.isArray(candidate.aliases)
      ? [...new Set(candidate.aliases.filter((value): value is string => (
          typeof value === 'string' && Boolean(value.trim()) && value.trim() !== modelId
        )).map((value) => value.trim()))]
      : [];
    modelMap.set(modelId, {
      id: modelId,
      label: typeof candidate.label === 'string' && candidate.label.trim() ? candidate.label.trim() : modelId,
      enabled: candidate.enabled !== false,
      defaultReasoningSelection: isReasoningSelection(candidate.defaultReasoningSelection)
        ? candidate.defaultReasoningSelection
        : undefined,
      defaultBudgetTokens: typeof candidate.defaultBudgetTokens === 'number'
        && Number.isSafeInteger(candidate.defaultBudgetTokens)
        && candidate.defaultBudgetTokens > 0
        ? candidate.defaultBudgetTokens
        : undefined,
      preferredRouteOptionId: typeof candidate.preferredRouteOptionId === 'string'
        && candidate.preferredRouteOptionId.trim()
        ? candidate.preferredRouteOptionId.trim()
        : undefined,
      ...(aliases.length > 0 ? { aliases } : {}),
      availability,
      availabilityReason: typeof candidate.availabilityReason === 'string' && candidate.availabilityReason.trim()
        ? candidate.availabilityReason.trim()
        : undefined,
    });
  }

  return Array.from(modelMap.values());
}

export function applyModelEnabledState(
  catalogModels: LlmProviderModel[],
  persistedModels: LlmProviderModel[],
): LlmProviderModel[] {
  const persistedById = new Map(persistedModels.map((model) => [model.id, model]));
  return catalogModels.map((model) => {
    const persisted = persistedById.get(model.id);
    const manifestDenied = model.availability === 'unavailable';
    return {
      ...model,
      enabled: persisted?.enabled ?? true,
      defaultReasoningSelection: persisted?.defaultReasoningSelection,
      defaultBudgetTokens: persisted?.defaultBudgetTokens,
      preferredRouteOptionId: persisted?.preferredRouteOptionId,
      availability: manifestDenied ? 'unavailable' : persisted?.availability ?? model.availability,
      availabilityReason: manifestDenied ? model.availabilityReason : persisted?.availabilityReason,
    };
  });
}

export function applyModelPreferences(
  models: LlmProviderModel[],
  preferences: readonly LlmProviderModelPreference[] | undefined,
): LlmProviderModel[] {
  if (!preferences?.length) return models;
  const byId = new Map(preferences.map((preference) => [preference.id, preference]));
  return models.map((model) => {
    const preference = byId.get(model.id);
    if (!preference) return model;
    return {
      ...model,
      enabled: preference.enabled,
      defaultReasoningSelection: isReasoningSelection(preference.defaultReasoningSelection)
        ? preference.defaultReasoningSelection
        : undefined,
      defaultBudgetTokens: typeof preference.defaultBudgetTokens === 'number'
        && Number.isSafeInteger(preference.defaultBudgetTokens)
        && preference.defaultBudgetTokens > 0
        ? preference.defaultBudgetTokens
        : undefined,
      preferredRouteOptionId: typeof preference.preferredRouteOptionId === 'string'
        && preference.preferredRouteOptionId.trim()
        ? preference.preferredRouteOptionId.trim()
        : undefined,
    };
  });
}

export function resolveProviderModels(providerId: string, persistedModels: unknown): LlmProviderModel[] {
  const sanitized = sanitizeModels(persistedModels);
  const ownership = getProviderCatalogOwnership(providerId);
  const authority = getProviderDiscoveryAuthority(providerId);
  const catalogMetadata = getProviderCatalogModelSummaries(providerId);
  const metadataById = new Map(catalogMetadata.map((metadata) => [metadata.modelId, metadata]));
  const catalogModels = getProviderModelSummaries(providerId);
  const catalogKeys = new Set(catalogMetadata.flatMap((metadata) => (
    [metadata.modelId, ...metadata.aliases].map(normalizeDiscoveredModelMatchKey).filter(Boolean)
  )));
  const observedKeys = new Set(sanitized.flatMap((model) => (
    [model.id, ...(model.aliases ?? [])].map(normalizeDiscoveredModelMatchKey).filter(Boolean)
  )));
  const visibleCatalogModels = catalogModels.filter((model) => {
    const metadata = metadataById.get(model.id);
    if (!metadata || metadata.presencePolicy === 'maintained') return true;
    return [metadata.modelId, ...metadata.aliases]
      .map(normalizeDiscoveredModelMatchKey)
      .some((key) => observedKeys.has(key));
  });
  const dynamicAllowed = ownership !== 'app-managed'
    && authority !== 'candidate-validation'
    && authority !== 'entitlement-overlay';
  const dynamicModels = dynamicAllowed
    ? sanitized.filter((model) => {
        if (!isAdmittedDiscoveredModel({ id: model.id })) return false;
        return ![model.id, ...(model.aliases ?? [])]
          .map(normalizeDiscoveredModelMatchKey)
          .some((key) => catalogKeys.has(key));
      })
    : [];
  return [
    ...applyModelEnabledState(visibleCatalogModels, sanitized),
    ...dynamicModels,
  ];
}

export function createEmptyAgentRoutes(): LlmAgentRoute[] {
  return Object.keys(DEFAULT_MODEL_ROUTING).map((agentId) => ({
    agentId: agentId as LlmAgentRoute['agentId'],
    providerId: '',
    modelId: '',
  }));
}

function sanitizeRoute(entry: unknown): LlmAgentRoute | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const route = entry as Partial<LlmAgentRoute>;
  if (typeof route.agentId !== 'string' || !isSafeAgentProfileId(route.agentId)) {
    return null;
  }

  return {
    agentId: route.agentId as LlmAgentRoute['agentId'],
    providerId: typeof route.providerId === 'string' ? route.providerId.trim() : '',
    modelId: typeof route.modelId === 'string' ? route.modelId.trim() : '',
  };
}

function pickProviderStatus(
  provider: Partial<LlmProviderEntry>,
  fallback: LlmProviderEntry,
  canUseProvider: boolean,
  models: LlmProviderModel[],
): LlmProviderConnectionStatus {
  const hasEnabledModels = models.some((model) => model.enabled !== false);
  if (fallback.status === 'unavailable') {
    return 'unavailable';
  }
  if (provider.status === 'failed') {
    return 'failed';
  }
  if ((provider.status === 'verified' || provider.isConfigured === true) && canUseProvider && hasEnabledModels) {
    return 'verified';
  }
  return 'unconfigured';
}

export function isFixtureProvider(provider: Partial<LlmProviderEntry>): boolean {
  const id = typeof provider.id === 'string' ? provider.id.trim() : '';
  const baseUrl = typeof provider.baseUrl === 'string' ? provider.baseUrl.trim().toLowerCase() : '';

  return (
    /^provider-\d+$/i.test(id)
    || id === 'acme'
    || id === 'vendorx'
    || baseUrl.includes('example.com')
    || baseUrl.includes('acme.local')
    || baseUrl.includes('vendorx.ai')
  );
}

function cloneConnectionSchema(
  schema: LlmProviderConnectionSchema | undefined,
): LlmProviderConnectionSchema | undefined {
  return schema
    ? {
        ...schema,
        fields: schema.fields.map((field) => ({ ...field })),
        credentialAlternatives: schema.credentialAlternatives
          ?.map((alternative) => ({ ...alternative, fieldIds: [...alternative.fieldIds] })),
        headerMappings: schema.headerMappings?.map((mapping) => ({ ...mapping })),
      }
    : undefined;
}

export function sanitizeConnectionValues(
  schema: LlmProviderConnectionSchema | undefined,
  values: Record<string, string> | undefined,
): Record<string, string> {
  const nonSecretFieldIds = new Set(
    schema?.fields.filter((field) => field.kind !== 'secret').map((field) => field.id) ?? [],
  );
  return Object.fromEntries(
    Object.entries(values ?? {}).flatMap(([fieldId, value]) => {
      if (!nonSecretFieldIds.has(fieldId) || typeof value !== 'string' || !value.trim()) {
        return [];
      }
      return [[fieldId, value.trim()]];
    }),
  );
}

function sanitizeConnectionSecretRefs(
  providerId: string,
  accountId: string | undefined,
  schema: LlmProviderConnectionSchema | undefined,
  refs: Record<string, string> | undefined,
): Record<string, string> {
  if (!accountId) {
    return {};
  }
  const primarySecretFieldId = resolvePrimaryConnectionSecretFieldId(schema);
  const secretFieldIds = new Set(
    schema?.fields
      .filter((field) => field.kind === 'secret' && field.id !== primarySecretFieldId)
      .map((field) => field.id) ?? [],
  );
  return Object.fromEntries(
    Object.entries(refs ?? {}).flatMap(([fieldId, secretRef]) => {
      if (!secretFieldIds.has(fieldId) || typeof secretRef !== 'string') {
        return [];
      }
      const expectedRef = secretStorageService.createProviderConnectionSecretRef(providerId, accountId, fieldId);
      return secretRef.trim() === expectedRef ? [[fieldId, expectedRef]] : [];
    }),
  );
}

export function isConnectionSchemaSatisfied(
  schema: LlmProviderConnectionSchema | undefined,
  connectionValues: Record<string, string>,
  secretPresence: Record<string, boolean>,
): boolean {
  if (!schema || schema.fields.length === 0) {
    return true;
  }
  const isPresent = (fieldId: string): boolean => {
    const field = schema.fields.find((candidate) => candidate.id === fieldId);
    return field?.kind === 'secret'
      ? secretPresence[fieldId] === true
      : Boolean(connectionValues[fieldId]?.trim());
  };
  const alternativeFieldIds = new Set(
    schema.credentialAlternatives?.flatMap((alternative) => alternative.fieldIds) ?? [],
  );
  const requiredFieldsPresent = schema.fields
    .filter((field) => field.required && !alternativeFieldIds.has(field.id))
    .every((field) => isPresent(field.id));
  if (!requiredFieldsPresent) {
    return false;
  }
  return !schema.credentialAlternatives?.length
    || schema.credentialAlternatives.some((alternative) => (
      alternative.ambient === true
      || (alternative.fieldIds.length > 0 && alternative.fieldIds.every(isPresent))
    ));
}

export function sanitizeUserProvider(
  provider: PersistedLlmProviderEntry,
  workspaceRoot = appPathService.getUserRdcRoot(),
  options: ProviderSanitizeOptions = {},
): LlmProviderEntry | null {
  const incomingId = typeof provider.id === 'string' ? provider.id.trim() : '';
  const rawId = incomingId;
  if (!rawId || !isBuiltinProviderId(rawId)) {
    return null;
  }

  const builtinFallback = createProviderEntryFromCatalog(rawId);
  const definition = builtinFallback;
  const authMode = resolveProviderAuthMode(provider, builtinFallback);
  const authAccountIds = sanitizeAuthAccountIds(provider, authMode);
  const activeAccountId = authAccountIds[authMode];
  const connectionSchema = cloneConnectionSchema(builtinFallback.connectionSchema);
  const primarySecretFieldId = resolvePrimaryConnectionSecretFieldId(connectionSchema);
  const connectionValues = sanitizeConnectionValues(connectionSchema, provider.connectionValues);
  const secretRefs = sanitizeConnectionSecretRefs(
    rawId,
    authAccountIds['api-key'],
    connectionSchema,
    provider.secretRefs,
  );
  const secretRef = getProviderAccountSecretRef(rawId, authAccountIds['api-key'], 'api-key');
  const protocol = normalizeProviderProtocol({ ...provider, id: rawId });
  const catalogOwnership = getProviderCatalogOwnership(rawId);
  const apiKeySecret = getResolvedProviderSecret(rawId, secretRef, workspaceRoot);
  const oauthSecret = secretStorageService.getSecret(
    getProviderAccountSecretRef(rawId, authAccountIds.account, 'oauth'),
    workspaceRoot,
  );
  const preserveStorageMetadata = options.credentialView === 'storage-metadata';
  const persistedApiKeyPresence = preserveStorageMetadata && (
    provider.hasStoredSecretByAuthMode?.['api-key'] === true
    || (authMode === 'api-key' && provider.hasStoredSecret === true)
  );
  const hasStoredConnectionSecrets = Object.fromEntries(
    (connectionSchema?.fields ?? [])
      .filter((field) => field.kind === 'secret')
      .map((field) => {
        const present = field.id === primarySecretFieldId
          ? Boolean(apiKeySecret) || persistedApiKeyPresence
          : Boolean(secretStorageService.getSecret(secretRefs[field.id], workspaceRoot))
            || (preserveStorageMetadata && (
              secretStorageService.hasSecretRecord(secretRefs[field.id], workspaceRoot)
              || provider.hasStoredConnectionSecrets?.[field.id] === true
            ));
        return [field.id, present];
      }),
  ) as Record<string, boolean>;
  const apiKeyCredentialPresent = connectionSchema?.fields.length
    ? isConnectionSchemaSatisfied(connectionSchema, connectionValues, hasStoredConnectionSecrets)
    : Boolean(apiKeySecret) || persistedApiKeyPresence;
  const hasStoredSecretByAuthMode = Object.fromEntries(
    (builtinFallback.authModeOptions ?? [builtinFallback.authMode]).map((mode) => {
      const persisted = preserveStorageMetadata && (
        provider.hasStoredSecretByAuthMode?.[mode] === true
        || (mode === authMode && provider.hasStoredSecret === true)
      );
      const present = mode === 'local' || mode === 'environment'
        ? true
        : mode === 'api-key'
          ? apiKeyCredentialPresent
          : Boolean(oauthSecret) || persisted;
      return [mode, present];
    }),
  ) as Partial<Record<LlmProviderAuthMode, boolean>>;
  const hasStoredSecret = hasStoredSecretByAuthMode[authMode] === true;
  const persistedModels = resolveProviderModels(rawId, provider.models ?? []);
  const structuralMetadataById = new Map(
    getProviderCatalogModelSummaries(rawId).map((metadata) => [metadata.modelId, metadata]),
  );
  const structuralModels = getProviderModelSummaries(rawId)
    .filter((model) => structuralMetadataById.get(model.id)?.presencePolicy === 'maintained');
  const structuralModelsById = new Map(structuralModels.map((model) => [model.id, model]));
  // Account discovery is scoped to the active identity. Once its credential is
  // absent, retain only released structural rows and discard account-specific
  // dynamic models and availability overlays.
  const models = catalogOwnership !== 'user-managed' && (authMode !== 'account' || hasStoredSecretByAuthMode.account === true)
    ? persistedModels
    : authMode === 'account' && hasStoredSecretByAuthMode.account !== true
    ? applyModelEnabledState(structuralModels, persistedModels).map((model) => {
        const structural = structuralModelsById.get(model.id);
        return {
          ...model,
          availability: structural?.availability,
          availabilityReason: structural?.availabilityReason,
        };
      })
    : persistedModels;
  const selectedAvailability = resolveSelectedAuthAvailability(rawId, authMode, builtinFallback);
  const canUseProvider = selectedAvailability.state !== 'unavailable' && hasStoredSecret;
  const configuredAuthMode = (builtinFallback.authModeOptions ?? [builtinFallback.authMode]).includes(provider.configuredAuthMode as LlmProviderAuthMode)
    ? provider.configuredAuthMode
    : provider.status === 'verified' || provider.isConfigured === true
      ? authMode
      : undefined;
  const status = pickProviderStatus(
    configuredAuthMode && configuredAuthMode !== authMode
      ? { ...provider, status: 'unconfigured', isConfigured: false }
      : provider,
    {
      ...builtinFallback,
      status: selectedAvailability.state === 'unavailable' ? 'unavailable' : 'unconfigured',
    },
    canUseProvider,
    models,
  );
  const hasEnabledModels = models.some((model) => model.enabled !== false);
  const enabled = status === 'verified' && hasEnabledModels;
  const label = builtinFallback.label;
  const recommendedModels = builtinFallback.recommendedModels;
  const docsUrl = builtinFallback.docsUrl;

  return {
    id: rawId,
    activeAccountId,
    authAccountIds,
    protocol,
    routeCount: builtinFallback.routeCount,
    authMode,
    authModeOptions: builtinFallback.authModeOptions,
    authModeAvailability: builtinFallback.authModeAvailability,
    hasStoredSecretByAuthMode,
    configuredAuthMode,
    lifecycleStatus: builtinFallback.lifecycleStatus,
    providerAvailability: { ...builtinFallback.providerAvailability },
    category: normalizeProviderCategory({ ...provider, id: rawId, authMode }),
    catalogOwnership,
    serviceOperator: builtinFallback.serviceOperator,
    endpointClass: builtinFallback.endpointClass,
    catalogProvenance: builtinFallback.catalogProvenance.map((entry) => ({ ...entry })),
    label,
    enabled,
    apiKey: '',
    secretRef,
    secretRefs,
    connectionValues,
    hasStoredConnectionSecrets,
    connectionSchema,
    hasStoredSecret,
    baseUrl: (() => {
      const defaultBaseUrl = getProviderDefaultBaseUrl(rawId);
      if (definition?.baseUrlEditable) {
        return typeof provider.baseUrl === 'string' && provider.baseUrl.trim()
          ? provider.baseUrl.trim()
          : defaultBaseUrl ?? definition.baseUrl;
      }
      return definition?.baseUrl;
    })(),
    baseUrlEditable: definition?.baseUrlEditable,
    models,
    recommendedModels,
    docsUrl,
    status,
    lastTestedAt: typeof provider.lastTestedAt === 'string' ? provider.lastTestedAt : undefined,
    lastModelRefreshAt: typeof provider.lastModelRefreshAt === 'string' ? provider.lastModelRefreshAt : undefined,
    lastError: status === 'failed' && typeof provider.lastError === 'string' ? provider.lastError : undefined,
    accountLoginConfigured: definition?.accountLoginConfigured,
    accountLabel: typeof provider.accountLabel === 'string' ? provider.accountLabel : undefined,
    planLabel: typeof provider.planLabel === 'string' ? provider.planLabel : undefined,
    oauthExpiresAt: typeof provider.oauthExpiresAt === 'string' ? provider.oauthExpiresAt : undefined,
    oauthRefreshAvailable: typeof provider.oauthRefreshAvailable === 'boolean' ? provider.oauthRefreshAvailable : undefined,
    unavailableReason: selectedAvailability.state === 'unavailable' ? selectedAvailability.reason : undefined,
    isConfigured: status === 'verified' && hasEnabledModels && enabled,
    capabilities: definition?.capabilities ? [...definition.capabilities] : undefined,
  };
}

export function normalizeUserProviders(
  providers: unknown,
  workspaceRoot: string,
  options: ProviderSanitizeOptions = {},
): LlmProviderEntry[] {
  const persistedProviders = new Map<string, LlmProviderEntry>();

  for (const entry of Array.isArray(providers) ? providers : []) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const provider = sanitizeUserProvider(entry as Partial<LlmProviderEntry>, workspaceRoot, options);
    if (!provider || persistedProviders.has(provider.id)) {
      continue;
    }

    persistedProviders.set(provider.id, provider);
  }

  return createProviderEntriesFromCatalog()
    .map((catalogProvider) => sanitizeUserProvider(
      persistedProviders.get(catalogProvider.id) ?? catalogProvider,
      workspaceRoot,
      options,
    ))
    .filter((provider): provider is LlmProviderEntry => provider !== null);
}

export function hydrateProviderSecrets(
  providers: LlmProviderEntry[],
  workspaceRoot: string,
): LlmProviderEntry[] {
  return providers.map((provider) => {
    const primarySecretFieldId = resolvePrimaryConnectionSecretFieldId(provider.connectionSchema);
    const apiKeySecret = getResolvedProviderSecret(provider.id, provider.secretRef, workspaceRoot);
    const oauthSecret = secretStorageService.getSecret(
      getProviderAccountSecretRef(provider.id, provider.authAccountIds?.account, 'oauth'),
      workspaceRoot,
    );
    const hasStoredConnectionSecrets = Object.fromEntries(
      (provider.connectionSchema?.fields ?? [])
        .filter((field) => field.kind === 'secret')
        .map((field) => [
          field.id,
          field.id === primarySecretFieldId
            ? Boolean(apiKeySecret)
            : Boolean(secretStorageService.getSecret(provider.secretRefs?.[field.id], workspaceRoot)),
        ]),
    ) as Record<string, boolean>;
    const apiKeyCredentialPresent = provider.connectionSchema?.fields.length
      ? isConnectionSchemaSatisfied(
          provider.connectionSchema,
          provider.connectionValues ?? {},
          hasStoredConnectionSecrets,
        )
      : Boolean(apiKeySecret);
    const hasStoredSecretByAuthMode = Object.fromEntries(
      (provider.authModeOptions ?? [provider.authMode]).map((mode) => [
        mode,
        mode === 'local' || mode === 'environment'
          ? true
          : mode === 'api-key'
            ? apiKeyCredentialPresent
            : Boolean(oauthSecret),
      ]),
    ) as Partial<Record<LlmProviderAuthMode, boolean>>;
    const hasStoredSecret = hasStoredSecretByAuthMode[provider.authMode] === true;
    const canUseProvider = hasStoredSecret && provider.authModeAvailability?.[provider.authMode]?.state !== 'unavailable';
    const hasEnabledModels = provider.models.some((model) => model.enabled !== false);
    const status = provider.status === 'unavailable'
      ? 'unavailable'
      : provider.status === 'verified'
        && provider.configuredAuthMode === provider.authMode
        && canUseProvider
        && hasEnabledModels
        ? 'verified'
        : provider.status === 'failed'
          ? 'failed'
          : 'unconfigured';
    const isConfigured = status === 'verified' && hasEnabledModels;

    return {
      ...provider,
      // The renderer only needs to know whether a secret exists.
      // Keep plaintext secrets out of settings:get payloads.
      apiKey: '',
      hasStoredSecret,
      hasStoredSecretByAuthMode,
      hasStoredConnectionSecrets,
      enabled: isConfigured,
      status,
      isConfigured,
    };
  });
}

export function normalizeManifestRoutes(
  routes: unknown,
): LlmAgentRoute[] {
  const routeMap = new Map<string, LlmAgentRoute>(
    createEmptyAgentRoutes().map((route) => [route.agentId, route]),
  );
  for (const route of Array.isArray(routes) ? routes.map(sanitizeRoute) : []) {
    if (!route) {
      continue;
    }
    routeMap.set(route.agentId, route);
  }

  for (const [agentId, incoming] of routeMap.entries()) {
    if (!incoming.providerId || !incoming.modelId) {
      routeMap.set(agentId, { agentId, providerId: '', modelId: '' });
      continue;
    }

    // Preserve the explicit route. EffectiveCatalog resolves proven aliases and reports
    // MODEL_UNAVAILABLE without rewriting the canonical manifest or silently substituting a model.
  }

  return Array.from(routeMap.values());
}
