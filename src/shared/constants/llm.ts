import type {
  BuiltinLlmProviderId,
  LlmProviderEntry,
  LlmProviderKind,
  LlmProviderModel,
} from '@shared/types/settings';

interface BuiltinProviderDefinition {
  id: BuiltinLlmProviderId;
  kind: LlmProviderKind;
  label: string;
  enabled: boolean;
  baseUrl?: string;
  recommendedModels: string[];
  defaultModels?: string[];
  docsUrl?: string;
}

export const BUILTIN_LLM_PROVIDER_DEFINITIONS: BuiltinProviderDefinition[] = [
  {
    id: 'openrouter',
    kind: 'openrouter',
    label: 'OpenRouter',
    enabled: true,
    baseUrl: 'https://openrouter.ai/api/v1',
    recommendedModels: [
      'anthropic/claude-sonnet-4.5',
      'anthropic/claude-opus-4.1',
      'moonshotai/kimi-k2.5',
      'openai/gpt-5.2',
    ],
    defaultModels: [
      'anthropic/claude-3-opus',
      'anthropic/claude-3-sonnet',
      'google/gemini-pro-1.5',
      'openai/gpt-4o',
    ],
    docsUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'minimax',
    kind: 'openai-compatible',
    label: 'MiniMax',
    enabled: false,
    baseUrl: 'https://api.minimax.chat/v1',
    recommendedModels: ['MiniMax-M1', 'abab6.5s-chat'],
    docsUrl: 'https://platform.minimaxi.com/',
  },
  {
    id: 'zai',
    kind: 'openai-compatible',
    label: 'Z.ai',
    enabled: false,
    baseUrl: 'https://api.z.ai/api/paas/v4',
    recommendedModels: ['glm-4.6', 'glm-4.5-air'],
    docsUrl: 'https://platform.z.ai/',
  },
  {
    id: 'volcengine',
    kind: 'openai-compatible',
    label: 'Volcengine',
    enabled: false,
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    recommendedModels: ['doubao-seed-1-6', 'doubao-pro-32k'],
    docsUrl: 'https://www.volcengine.com/docs/82379',
  },
  {
    id: '302ai',
    kind: 'openai-compatible',
    label: '302.AI',
    enabled: false,
    baseUrl: 'https://api.302.ai/v1',
    recommendedModels: ['gpt-4o', 'claude-3-7-sonnet'],
    docsUrl: 'https://302.ai/',
  },
  {
    id: 'ollama',
    kind: 'ollama',
    label: 'Ollama',
    enabled: false,
    baseUrl: 'http://127.0.0.1:11434/v1',
    recommendedModels: ['qwen2.5-coder:14b', 'llama3.1:8b'],
    docsUrl: 'https://ollama.com/download',
  },
  {
    id: 'siliconflow',
    kind: 'openai-compatible',
    label: 'SiliconFlow',
    enabled: false,
    baseUrl: 'https://api.siliconflow.cn/v1',
    recommendedModels: ['Qwen/Qwen3-32B', 'deepseek-ai/DeepSeek-V3'],
    docsUrl: 'https://siliconflow.cn/',
  },
  {
    id: 'openai',
    kind: 'openai-compatible',
    label: 'OpenAI',
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    recommendedModels: ['gpt-4o', 'gpt-4.1'],
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    kind: 'anthropic',
    label: 'Anthropic',
    enabled: false,
    baseUrl: 'https://api.anthropic.com/v1',
    recommendedModels: ['claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest'],
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
];

const toModels = (modelIds: string[]): LlmProviderModel[] =>
  Array.from(new Set(modelIds)).map((modelId) => ({
    id: modelId,
    label: modelId,
    enabled: true,
  }));

export const createBuiltinProviderEntry = (id: BuiltinLlmProviderId): LlmProviderEntry => {
  const definition = BUILTIN_LLM_PROVIDER_DEFINITIONS.find((entry) => entry.id === id);
  if (!definition) {
    throw new Error(`Unknown builtin provider: ${id}`);
  }

  const defaultModels = definition.defaultModels ?? [];

  return {
    id: definition.id,
    kind: definition.kind,
    label: definition.label,
    enabled: definition.enabled,
    apiKey: '',
    baseUrl: definition.baseUrl,
    models: toModels(defaultModels),
    recommendedModels: definition.recommendedModels,
    docsUrl: definition.docsUrl,
    isConfigured: false,
  };
};

export const createBuiltinProviderEntries = (): LlmProviderEntry[] =>
  BUILTIN_LLM_PROVIDER_DEFINITIONS.map((entry) => createBuiltinProviderEntry(entry.id));
