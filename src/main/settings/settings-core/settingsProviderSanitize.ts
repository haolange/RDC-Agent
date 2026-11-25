import { randomUUID } from 'crypto';
import { z } from 'zod';
import { isReasoningSelection } from '@shared/types/modelCapability';
import { TOP_LEVEL_AGENT_IDS, isSafeAgentProfileId } from '@shared/types/agent';
import {
  getProviderAuthModeAvailability,
  getProviderCatalogModelSummaries,
  getProviderCatalogOwnership,
  getProviderDiscoveryAuthority,
  getProviderDefaultBaseUrl,
  getProviderAccountAuth,
  getProviderModelSummaries,
  getProviderSurfaceSummary,
  isRetiredProviderModel,
} from '../../provider-catalog/ProviderCatalogRegistry';
import { isAdmittedDiscoveredModel, normalizeDiscoveredModelMatchKey } from '../provider-catalog/DiscoveryAdmission';
import { secretStorageService } from './SecretStorageService';
import type {
  LlmAgentRoute,
  LlmProviderAuthMode,
  LlmProviderAvailability,
  LlmProviderConnectionSchema,
  LlmProviderEntry,
  LlmProviderModel,
  LlmProviderModelPreference,
} from '@shared/types/settings';

/** A stored key is usable when it is non-empty and carries the prefix the provider's manifest declares. */
export function isVendorSecretUsable(providerId: string, secret: string): boolean {
  const normalized = secret.trim().toLowerCase();
  if (!normalized) return false;
  const schema = getProviderSurfaceSummary(providerId)?.connectionSchema;
  const primaryField = schema?.fields.find((field) => field.id === schema.primarySecretFieldId);
  return !primaryField?.valuePrefix || normalized.startsWith(primaryField.valuePrefix.toLowerCase());
}

export function getResolvedProviderSecret(providerId: string, secretRef: string | undefined, workspaceRoot: string): string {
  const secret = secretStorageService.getSecret(secretRef, workspaceRoot).trim();
  return isVendorSecretUsable(providerId, secret) ? secret : '';
}

export function createLocalAccountId(): string {
  return `account-${randomUUID()}`;
}

/** A stored OAuth bundle as far as Settings reads it: string fields by name; anything else is not a bundle. */
const OAuthBundleFieldsSchema = z.record(z.string(), z.unknown());

function readOAuthBundle(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = OAuthBundleFieldsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const bundleText = (value: unknown): string | undefined => (
  typeof value === 'string' && value.trim() ? value.trim() : undefined
);

/** The upstream account id an OAuth bundle names; undefined when the payload is not a bundle or names none. */
export function extractOAuthBundleAccountId(raw: string): string | undefined {
  return bundleText(readOAuthBundle(raw)?.accountId);
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
  const accountAuth = getProviderAccountAuth(providerId);
  if (!accountAuth) {
    return { apiKey: '' };
  }
  const raw = secretStorageService.getSecret(
    getProviderAccountSecretRef(providerId, provider.activeAccountId, 'oauth'),
    workspaceRoot,
  );
  // A stored credential that is not a bundle leaves the account unconfigured.
  const bundle = readOAuthBundle(raw);
  if (!bundle) {
    return { apiKey: '' };
  }
  const { tokenFields, baseUrlField } = accountAuth.credential;
  return {
    apiKey: tokenFields.map((field) => bundleText(bundle[field])).find(Boolean) ?? '',
    baseUrl: (baseUrlField ? bundleText(bundle[baseUrlField]) : undefined) ?? getProviderDefaultBaseUrl(providerId),
    accountId: bundleText(bundle.accountId),
  };
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
  const sanitized = sanitizeModels(persistedModels).filter((model) => !isRetiredProviderModel(providerId, model.id));
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
  return TOP_LEVEL_AGENT_IDS.map((agentId) => ({
    agentId,
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

export function cloneConnectionSchema(
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
