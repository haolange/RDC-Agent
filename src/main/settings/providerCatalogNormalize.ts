import {
  BUILTIN_LLM_PROVIDER_DEFINITIONS,
  LLM_PROVIDER_CATEGORY_DEFINITIONS,
  getBuiltinProviderDefinition,
  getBuiltinProviderProtocolOptions,
  isLlmProviderProtocol,
} from '@shared/constants/llm';
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
  const builtin = id ? BUILTIN_LLM_PROVIDER_DEFINITIONS.find((definition) => definition.id === id) : null;
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
  const builtin = id ? getBuiltinProviderDefinition(id) : null;
  if (builtin) {
    const options = getBuiltinProviderProtocolOptions(id);
    if (builtin.protocolEditable && isLlmProviderProtocol(provider.protocol) && options.includes(provider.protocol)) {
      return provider.protocol;
    }
    return builtin.protocol;
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
