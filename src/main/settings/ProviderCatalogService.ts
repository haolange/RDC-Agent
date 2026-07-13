import { LLM_PROVIDER_CATEGORY_DEFINITIONS, LLM_PROVIDER_PROTOCOL_DEFINITIONS } from '@shared/constants/llm';
import { createProviderEntryFromPreset, listProviderPresets } from './ProviderPresetRegistry';
import type {
  LlmProviderCatalogEntry,
  LlmProviderCatalogResponse,
} from '@shared/types/settings';

const categoryRank = new Map(LLM_PROVIDER_CATEGORY_DEFINITIONS.map((entry, index) => [entry.id, index]));

function toCatalogEntry(provider: ReturnType<typeof createProviderEntryFromPreset>): LlmProviderCatalogEntry {
  return {
    id: provider.id,
    protocol: provider.protocol,
    authMode: provider.authMode,
    category: provider.category,
    catalogOwnership: provider.catalogOwnership,
    label: provider.label,
    baseUrlEditable: provider.baseUrlEditable,
    protocolEditable: provider.protocolEditable,
    protocolOptions: provider.protocolOptions ? [...provider.protocolOptions] : undefined,
    protocolBaseUrls: provider.protocolBaseUrls ? { ...provider.protocolBaseUrls } : undefined,
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
    const catalogProviders = listProviderPresets()
      .map((preset) => createProviderEntryFromPreset(preset.id as Parameters<typeof createProviderEntryFromPreset>[0]))
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
