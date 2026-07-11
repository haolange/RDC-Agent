import {
  BUILTIN_LLM_PROVIDER_DEFINITIONS,
  getBuiltinProviderCatalogOwnership,
  LLM_PROVIDER_CATEGORY_DEFINITIONS,
  LLM_PROVIDER_PROTOCOL_DEFINITIONS,
} from '@shared/constants/llm';
import { getManagedProviderModelIds } from '@shared/constants/modelCapabilityCatalog';
import type {
  LlmProviderCatalogEntry,
  LlmProviderCatalogResponse,
} from '@shared/types/settings';

const categoryRank = new Map(LLM_PROVIDER_CATEGORY_DEFINITIONS.map((entry, index) => [entry.id, index]));

function toCatalogEntry(provider: typeof BUILTIN_LLM_PROVIDER_DEFINITIONS[number]): LlmProviderCatalogEntry {
  const catalogOwnership = getBuiltinProviderCatalogOwnership(provider.id);
  const managedModelIds = catalogOwnership === 'app-managed'
    ? getManagedProviderModelIds(provider.id)
    : [];
  return {
    id: provider.id,
    protocol: provider.protocol,
    authMode: provider.authMode,
    category: provider.category,
    catalogOwnership,
    label: provider.label,
    baseUrlEditable: provider.baseUrlEditable,
    protocolEditable: provider.protocolEditable,
    protocolOptions: provider.protocolOptions ? [...provider.protocolOptions] : undefined,
    protocolBaseUrls: provider.protocolBaseUrls ? { ...provider.protocolBaseUrls } : undefined,
    recommendedModels: managedModelIds.length > 0 ? managedModelIds : [...provider.recommendedModels],
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
    const catalogProviders = BUILTIN_LLM_PROVIDER_DEFINITIONS.map(toCatalogEntry).sort(compareProvider);

    return {
      categories: LLM_PROVIDER_CATEGORY_DEFINITIONS.map((category) => ({ ...category })),
      protocols: LLM_PROVIDER_PROTOCOL_DEFINITIONS.map((protocol) => ({ ...protocol })),
      providers: catalogProviders,
    };
  }
}

export const providerCatalogService = new ProviderCatalogService();
