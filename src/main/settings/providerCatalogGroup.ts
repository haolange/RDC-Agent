import {
  BUILTIN_LLM_PROVIDER_DEFINITIONS,
} from '../../shared/constants/llm';
import type {
  LlmProviderAuthMode,
  LlmProviderCatalogGroup,
} from '../../shared/types/settings';

const CATALOG_GROUPS: LlmProviderCatalogGroup[] = [
  'account',
  'openai-compatible',
  'anthropic-compatible',
  'cloud-platform',
  'local',
  'image',
];

export function normalizeProviderCatalogGroup(
  provider: {
    id?: string;
    catalogGroup?: LlmProviderCatalogGroup | string;
    authMode?: LlmProviderAuthMode | string;
  },
): LlmProviderCatalogGroup {
  const current = provider.catalogGroup;
  if (typeof current === 'string' && CATALOG_GROUPS.includes(current as LlmProviderCatalogGroup)) {
    return current as LlmProviderCatalogGroup;
  }

  const id = typeof provider.id === 'string' ? provider.id.trim() : '';
  if (id) {
    const builtinDef = BUILTIN_LLM_PROVIDER_DEFINITIONS.find((def) => def.id === id);
    if (builtinDef) {
      return builtinDef.catalogGroup;
    }
  }

  switch (provider.authMode) {
    case 'account':
      return 'account';
    case 'local':
      return 'local';
    case 'environment':
      return 'cloud-platform';
    default:
      console.warn(
        '[SettingsService] Unable to infer catalogGroup for provider; defaulting to openai-compatible.',
        { id, authMode: provider.authMode, catalogGroup: current },
      );
      return 'openai-compatible';
  }
}
