import { LLM_PROVIDER_CATEGORY_DEFINITIONS, LLM_PROVIDER_PROTOCOL_DEFINITIONS } from '@shared/constants/llm';
import {
  createProviderEntryFromCatalog,
  listProviderSummaries,
} from '../provider-catalog/ProviderCatalogRegistry';
import type {
  LlmProviderCatalogEntry,
  LlmProviderCatalogResponse,
} from '@shared/types/settings';

const categoryRank = new Map(LLM_PROVIDER_CATEGORY_DEFINITIONS.map((entry, index) => [entry.id, index]));

function toCatalogEntry(provider: ReturnType<typeof createProviderEntryFromCatalog>): LlmProviderCatalogEntry {
  return {
    id: provider.id,
    protocol: provider.protocol,
    authMode: provider.authMode,
    authModeOptions: provider.authModeOptions,
    authModeAvailability: provider.authModeAvailability,
    lifecycleStatus: provider.lifecycleStatus,
    providerAvailability: { ...provider.providerAvailability },
    category: provider.category,
    serviceOperator: provider.serviceOperator,
    endpointClass: provider.endpointClass,
    catalogOwnership: provider.catalogOwnership,
    catalogProvenance: provider.catalogProvenance.map((entry) => ({ ...entry })),
    connectionSchema: provider.connectionSchema
      ? {
          ...provider.connectionSchema,
          fields: provider.connectionSchema.fields.map((field) => ({ ...field })),
          credentialAlternatives: provider.connectionSchema.credentialAlternatives
            ?.map((alternative) => ({ ...alternative, fieldIds: [...alternative.fieldIds] })),
          headerMappings: provider.connectionSchema.headerMappings?.map((mapping) => ({ ...mapping })),
        }
      : undefined,
    label: provider.label,
    baseUrlEditable: provider.baseUrlEditable,
    recommendedModels: [...provider.recommendedModels],
    docsUrl: provider.docsUrl,
    accountLoginConfigured: provider.accountLoginConfigured,
    unavailableReason: provider.unavailableReason,
    capabilities: provider.capabilities ? [...provider.capabilities] : undefined,
  };
}

function compareProvider(left: LlmProviderCatalogEntry, right: LlmProviderCatalogEntry): number {
  const leftRank = categoryRank.get(left.category) ?? Number.MAX_SAFE_INTEGER;
  const rightRank = categoryRank.get(right.category) ?? Number.MAX_SAFE_INTEGER;
  const categoryDelta = leftRank - rightRank;
  if (categoryDelta !== 0) {
    return categoryDelta;
  }
  return left.label.localeCompare(right.label, 'en', { sensitivity: 'base' });
}

export class ProviderCatalogService {
  getProviderCatalog(): LlmProviderCatalogResponse {
    const catalogProviders = listProviderSummaries()
      .map((surface) => createProviderEntryFromCatalog(surface.id))
      .map(toCatalogEntry)
      .sort(compareProvider);

    return {
      categories: LLM_PROVIDER_CATEGORY_DEFINITIONS.map((category) => ({ ...category })),
      protocols: LLM_PROVIDER_PROTOCOL_DEFINITIONS.map((protocol) => ({ ...protocol })),
      providers: catalogProviders,
    };
  }
}

export const providerCatalogService = new ProviderCatalogService();
