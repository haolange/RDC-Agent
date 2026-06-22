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

const LEGACY_CATEGORY_MAP: Record<string, LlmProviderCategory> = {
  account: 'login-authorization',
  'openai-compatible': 'third-party-compatible',
  'anthropic-compatible': 'third-party-compatible',
  'cloud-platform': 'cloud-platform',
  local: 'local',
  plan: 'coding-token-plan',
  image: 'image',
};

const LEGACY_PROTOCOL_MAP: Record<string, LlmProviderProtocol> = {
  openrouter: 'OpenRouterChatCompletions',
  'openai-compatible': 'OpenAICompatibleChatCompletions',
  anthropic: 'AnthropicMessages',
  'google-ai-studio': 'GoogleGemini',
  'azure-openai': 'AzureOpenAIChatCompletions',
  bedrock: 'AwsBedrock',
  vertex: 'GoogleVertexAI',
  ollama: 'OllamaOpenAICompatibleChatCompletions',
};

function isProviderCategory(value: unknown): value is LlmProviderCategory {
  return typeof value === 'string' && PROVIDER_CATEGORIES.includes(value as LlmProviderCategory);
}

function legacyCategory(value: unknown): LlmProviderCategory | null {
  return typeof value === 'string' ? LEGACY_CATEGORY_MAP[value] ?? null : null;
}

function legacyProtocol(value: unknown): LlmProviderProtocol | null {
  return typeof value === 'string' ? LEGACY_PROTOCOL_MAP[value] ?? null : null;
}

export function normalizeProviderCategory(
  provider: {
    id?: string;
    category?: unknown;
    catalogGroup?: unknown;
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

  const migratedCategory = legacyCategory(provider.category) ?? legacyCategory(provider.catalogGroup);
  if (migratedCategory) {
    return migratedCategory;
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
        { id: provider.id, authMode: provider.authMode, category: provider.category, catalogGroup: provider.catalogGroup },
      );
      return 'third-party-compatible';
  }
}

export function normalizeProviderProtocol(
  provider: {
    id?: string;
    protocol?: unknown;
    kind?: unknown;
  },
): LlmProviderProtocol {
  const id = typeof provider.id === 'string' ? provider.id.trim() : '';
  const builtin = id ? getBuiltinProviderDefinition(id) : null;
  if (builtin) {
    const options = getBuiltinProviderProtocolOptions(id);
    if (builtin.protocolEditable && isLlmProviderProtocol(provider.protocol) && options.includes(provider.protocol)) {
      return provider.protocol;
    }
    if (builtin.protocolEditable) {
      const migrated = legacyProtocol(provider.kind);
      if (migrated && options.includes(migrated)) {
        return migrated;
      }
    }
    return builtin.protocol;
  }

  if (isLlmProviderProtocol(provider.protocol)) {
    return provider.protocol;
  }

  const migratedProtocol = legacyProtocol(provider.protocol) ?? legacyProtocol(provider.kind);
  if (migratedProtocol) {
    return migratedProtocol;
  }

  console.warn(
    '[SettingsService] Unable to infer provider protocol; defaulting to OpenAICompatibleChatCompletions.',
    { id: provider.id, protocol: provider.protocol, kind: provider.kind },
  );
  return 'OpenAICompatibleChatCompletions';
}
