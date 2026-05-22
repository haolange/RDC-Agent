import type {
  BuiltinLlmProviderId,
  LlmProviderAuthMode,
  LlmProviderCatalogGroup,
  LlmProviderEntry,
  LlmProviderKind,
  LlmProviderModel,
  LlmProviderModelDiscoveryStrategy,
} from '@shared/types/settings';

export interface BuiltinProviderDefinition {
  id: BuiltinLlmProviderId;
  kind: LlmProviderKind;
  authMode: LlmProviderAuthMode;
  catalogGroup: LlmProviderCatalogGroup;
  modelDiscovery: LlmProviderModelDiscoveryStrategy | null;
  label: string;
  baseUrl?: string;
  docsUrl?: string;
  recommendedModels: string[];
  accountLoginConfigured?: boolean;
  unavailableReason?: string;
}

export const BUILTIN_LLM_PROVIDER_DEFINITIONS: BuiltinProviderDefinition[] = [
  {
    id: 'openrouter',
    kind: 'openrouter',
    authMode: 'api-key',
    catalogGroup: 'api-key',
    modelDiscovery: 'openai-compatible',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    recommendedModels: [
      'anthropic/claude-sonnet-4.5',
      'anthropic/claude-opus-4.1',
      'moonshotai/kimi-k2.5',
      'openai/gpt-5.2',
    ],
    docsUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'openai',
    kind: 'openai-compatible',
    authMode: 'api-key',
    catalogGroup: 'api-key',
    modelDiscovery: 'openai-compatible',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    recommendedModels: ['gpt-5.2', 'gpt-4.1'],
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    kind: 'anthropic',
    authMode: 'api-key',
    catalogGroup: 'api-key',
    modelDiscovery: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    recommendedModels: ['claude-sonnet-4-5', 'claude-opus-4-1'],
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'deepseek',
    kind: 'openai-compatible',
    authMode: 'api-key',
    catalogGroup: 'api-key',
    modelDiscovery: 'openai-compatible',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    recommendedModels: ['deepseek-chat', 'deepseek-reasoner'],
    docsUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'gemini',
    kind: 'openai-compatible',
    authMode: 'api-key',
    catalogGroup: 'api-key',
    modelDiscovery: 'gemini',
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    recommendedModels: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    docsUrl: 'https://aistudio.google.com/app/apikey',
  },
  {
    id: 'xai',
    kind: 'openai-compatible',
    authMode: 'api-key',
    catalogGroup: 'api-key',
    modelDiscovery: 'openai-compatible',
    label: 'xAI Grok',
    baseUrl: 'https://api.x.ai/v1',
    recommendedModels: ['grok-4', 'grok-3'],
    docsUrl: 'https://console.x.ai/',
  },
  {
    id: 'kimi',
    kind: 'openai-compatible',
    authMode: 'api-key',
    catalogGroup: 'api-key',
    modelDiscovery: 'openai-compatible',
    label: 'Kimi / Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    recommendedModels: ['kimi-k2-0711-preview', 'moonshot-v1-128k'],
    docsUrl: 'https://platform.kimi.ai/console/api-keys',
  },
  {
    id: 'minimax',
    kind: 'openai-compatible',
    authMode: 'api-key',
    catalogGroup: 'api-key',
    modelDiscovery: 'openai-compatible',
    label: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    recommendedModels: ['MiniMax-M1', 'abab6.5s-chat'],
    docsUrl: 'https://platform.minimaxi.com/',
  },
  {
    id: 'zai',
    kind: 'openai-compatible',
    authMode: 'api-key',
    catalogGroup: 'api-key',
    modelDiscovery: 'openai-compatible',
    label: 'GLM / Z.ai',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    recommendedModels: ['glm-4.6', 'glm-4.5-air'],
    docsUrl: 'https://platform.z.ai/',
  },
  {
    id: 'qwen',
    kind: 'openai-compatible',
    authMode: 'api-key',
    catalogGroup: 'api-key',
    modelDiscovery: 'openai-compatible',
    label: 'Qwen / DashScope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    recommendedModels: ['qwen-plus', 'qwen-max'],
    docsUrl: 'https://dashscope.console.aliyun.com/apiKey',
  },
  {
    id: 'volcengine',
    kind: 'openai-compatible',
    authMode: 'api-key',
    catalogGroup: 'api-key',
    modelDiscovery: 'openai-compatible',
    label: 'Doubao / Volcengine Ark',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    recommendedModels: ['doubao-seed-1-6', 'doubao-pro-32k'],
    docsUrl: 'https://www.volcengine.com/docs/82379',
  },
  {
    id: '302ai',
    kind: 'openai-compatible',
    authMode: 'api-key',
    catalogGroup: 'api-key',
    modelDiscovery: 'openai-compatible',
    label: '302.AI',
    baseUrl: 'https://api.302.ai/v1',
    recommendedModels: ['gpt-4o', 'claude-3-7-sonnet'],
    docsUrl: 'https://302.ai/',
  },
  {
    id: 'siliconflow',
    kind: 'openai-compatible',
    authMode: 'api-key',
    catalogGroup: 'api-key',
    modelDiscovery: 'openai-compatible',
    label: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    recommendedModels: ['Qwen/Qwen3-32B', 'deepseek-ai/DeepSeek-V3'],
    docsUrl: 'https://siliconflow.cn/',
  },
  {
    id: 'ollama',
    kind: 'ollama',
    authMode: 'local',
    catalogGroup: 'local',
    modelDiscovery: 'ollama-tags',
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    recommendedModels: ['qwen2.5-coder:14b', 'llama3.1:8b'],
    docsUrl: 'https://ollama.com/download',
  },
  {
    id: 'claude-account',
    kind: 'anthropic',
    authMode: 'account',
    catalogGroup: 'account',
    modelDiscovery: null,
    label: 'Claude Account',
    recommendedModels: [],
    docsUrl: 'https://claude.ai/',
    accountLoginConfigured: false,
    unavailableReason: '当前版本未配置登录通道',
  },
  {
    id: 'chatgpt-account',
    kind: 'openai-compatible',
    authMode: 'account',
    catalogGroup: 'account',
    modelDiscovery: null,
    label: 'ChatGPT Account',
    recommendedModels: [],
    docsUrl: 'https://chatgpt.com/',
    accountLoginConfigured: false,
    unavailableReason: '当前版本未配置登录通道',
  },
  {
    id: 'github-copilot',
    kind: 'openai-compatible',
    authMode: 'account',
    catalogGroup: 'account',
    modelDiscovery: null,
    label: 'GitHub Copilot',
    recommendedModels: [],
    docsUrl: 'https://github.com/features/copilot',
    accountLoginConfigured: false,
    unavailableReason: '当前版本未配置登录通道',
  },
];

export function isBuiltinProviderId(id: string): id is BuiltinLlmProviderId {
  return BUILTIN_LLM_PROVIDER_DEFINITIONS.some((entry) => entry.id === id);
}

export function getBuiltinProviderDefinition(id: string): BuiltinProviderDefinition | null {
  return BUILTIN_LLM_PROVIDER_DEFINITIONS.find((entry) => entry.id === id) ?? null;
}

const toModels = (modelIds: string[]): LlmProviderModel[] =>
  Array.from(new Set(modelIds)).map((modelId) => ({
    id: modelId,
    label: modelId,
    enabled: true,
  }));

export const createBuiltinProviderEntry = (id: BuiltinLlmProviderId): LlmProviderEntry => {
  const definition = getBuiltinProviderDefinition(id);
  if (!definition) {
    throw new Error(`Unknown builtin provider: ${id}`);
  }

  return {
    id: definition.id,
    kind: definition.kind,
    authMode: definition.authMode,
    catalogGroup: definition.catalogGroup,
    modelDiscovery: definition.modelDiscovery,
    label: definition.label,
    enabled: false,
    apiKey: '',
    hasStoredSecret: definition.authMode === 'local',
    baseUrl: definition.baseUrl,
    models: toModels([]),
    recommendedModels: definition.recommendedModels,
    docsUrl: definition.docsUrl,
    status: definition.authMode === 'account' && definition.accountLoginConfigured !== true
      ? 'unavailable'
      : 'unconfigured',
    accountLoginConfigured: definition.accountLoginConfigured,
    unavailableReason: definition.unavailableReason,
    isConfigured: false,
  };
};

export const createBuiltinProviderEntries = (): LlmProviderEntry[] =>
  BUILTIN_LLM_PROVIDER_DEFINITIONS.map((entry) => createBuiltinProviderEntry(entry.id));
