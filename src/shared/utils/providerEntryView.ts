import { LLM_PROVIDER_CATALOG_FIELDS } from '../types/settings';
import type {
  LlmProviderCatalogEntry,
  LlmProviderConnectionState,
  LlmProviderEntry,
  LlmProviderModel,
} from '../types/settings';

/** The catalog's recommended models that an enabled, available row still offers. */
export const offeredRecommendedModels = (
  recommended: readonly string[],
  models: readonly LlmProviderModel[],
): string[] =>
  recommended.filter((id) =>
    models.some((model) => model.id === id && model.enabled !== false && model.availability !== 'unavailable'),
  );

/** A provider entry without its catalog facts: what `settings:get` sends for it. */
export function providerConnectionState(entry: LlmProviderEntry): LlmProviderConnectionState {
  const state: Partial<LlmProviderEntry> = { ...entry };
  for (const field of LLM_PROVIDER_CATALOG_FIELDS) delete state[field];
  return state as LlmProviderConnectionState;
}

/**
 * The provider entry main composes, rebuilt from the catalog entry and the connection state: the catalog facts, the
 * recommended models the enabled rows still offer, and everything else from the state.
 */
export function joinProviderEntry(
  catalog: LlmProviderCatalogEntry,
  state: LlmProviderConnectionState,
): LlmProviderEntry {
  return {
    ...state,
    protocol: catalog.protocol,
    routeCount: catalog.routeCount,
    authModeOptions: catalog.authModeOptions,
    authModeAvailability: catalog.authModeAvailability,
    lifecycleStatus: catalog.lifecycleStatus,
    providerAvailability: catalog.providerAvailability,
    category: catalog.category,
    catalogOwnership: catalog.catalogOwnership,
    serviceOperator: catalog.serviceOperator,
    endpointClass: catalog.endpointClass,
    catalogProvenance: catalog.catalogProvenance,
    label: catalog.label,
    connectionSchema: catalog.connectionSchema,
    baseUrlEditable: catalog.baseUrlEditable,
    recommendedModels: offeredRecommendedModels(catalog.recommendedModels, state.models),
    docsUrl: catalog.docsUrl,
    accountLogin: catalog.accountLogin,
    capabilities: catalog.capabilities,
    apiKey: '',
  };
}
