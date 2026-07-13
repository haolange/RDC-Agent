import { LLM_PROVIDER_CATEGORY_DEFINITIONS, isLlmProviderProtocol } from '@shared/constants/llm';
import { getProviderPreset, getProviderPresetProtocolOptions } from './ProviderPresetRegistry';
import type {
  LlmProviderAuthMode,
  LlmProviderCategory,
  LlmProviderProtocol,
} from '@shared/types/settings';

export const PROVIDER_CATEGORIES: readonly LlmProviderCategory[] = LLM_PROVIDER_CATEGORY_DEFINITIONS.map((entry) => entry.id);

function isProviderCategory(value: unknown): value is LlmProviderCategory {
  return typeof value === 'string' && PROVIDER_CATEGORIES.includes(value as LlmProviderCategory);
}

export function normalizeProviderCategory(
  provider: {
    id?: string;
    category?: unknown;
    authMode?: LlmProviderAuthMode | string;
  },
): LlmProviderCategory {
  const id = typeof provider.id === 'string' ? provider.id.trim() : '';
  const builtin = id ? getProviderPreset(id) : null;
  if (builtin) {
    return builtin.category;
  }

  if (isProviderCategory(provider.category)) {
    return provider.category;
  }

  switch (provider.authMode) {
    case 'account':
      return 'login-authorization';
    case 'local':
      return 'local';
    case 'environment':
      return 'cloud-platform';
    default:
      console.warn(
        '[SettingsService] Unable to infer provider category; defaulting to third-party-compatible.',
        { id: provider.id, authMode: provider.authMode, category: provider.category },
      );
      return 'third-party-compatible';
  }
}

export function normalizeProviderProtocol(
  provider: {
    id?: string;
    protocol?: unknown;
  },
): LlmProviderProtocol {
  const id = typeof provider.id === 'string' ? provider.id.trim() : '';
  const builtin = id ? getProviderPreset(id) : null;
  if (builtin) {
    const options = getProviderPresetProtocolOptions(id);
    if (builtin.userSelectableRoute && isLlmProviderProtocol(provider.protocol) && options.includes(provider.protocol)) {
      return provider.protocol;
    }
    return builtin.routes.find((route) => route.default)?.protocol ?? builtin.routes[0].protocol;
  }

  if (isLlmProviderProtocol(provider.protocol)) {
    return provider.protocol;
  }

  console.warn(
    '[SettingsService] Unable to infer provider protocol; defaulting to OpenAICompatibleChatCompletions.',
    { id: provider.id, protocol: provider.protocol },
  );
  return 'OpenAICompatibleChatCompletions';
}
