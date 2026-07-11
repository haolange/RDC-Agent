import type {
  BuiltinLlmProviderId,
  LlmProviderAuthMode,
  LlmProviderCapability,
  LlmProviderCategory,
  LlmProviderCategoryDescriptor,
  LlmProviderCatalogOwnership,
  LlmProviderEntry,
  LlmProviderModel,
  LlmProviderModelDiscoveryStrategy,
  LlmProviderProtocol,
  LlmProviderProtocolDescriptor,
} from '@shared/types/settings';
import {
  getManagedProviderModels,
} from './modelCapabilityCatalog';

export const SUPER_GROK_OAUTH_CALLBACK_PORT = 1456;
export const SUPER_GROK_OAUTH_REDIRECT_URI = `http://localhost:${SUPER_GROK_OAUTH_CALLBACK_PORT}/oauth/grok/callback`;

export interface BuiltinProviderDefinition {
  id: BuiltinLlmProviderId;
  protocol: LlmProviderProtocol;
  authMode: LlmProviderAuthMode;
  category: LlmProviderCategory;
  catalogOwnership?: LlmProviderCatalogOwnership;
  modelDiscovery: LlmProviderModelDiscoveryStrategy | null;
  label: string;
  baseUrl?: string;
  baseUrlEditable?: boolean;
  protocolEditable?: boolean;
  protocolOptions?: LlmProviderProtocol[];
  /** Per-protocol default base URLs when the provider exposes multiple wire protocols. */
  protocolBaseUrls?: Partial<Record<LlmProviderProtocol, string>>;
  docsUrl?: string;
  recommendedModels: string[];
  capabilities?: LlmProviderCapability[];
  accountLoginConfigured?: boolean;
  unavailableReason?: string;
}

export const LLM_PROVIDER_CATEGORY_DEFINITIONS: LlmProviderCategoryDescriptor[] = [
  {
    id: 'login-authorization',
    label: 'Login Authorization',
    description: 'Official account login, OAuth, device flow, or account authorization providers.',
  },
  {
    id: 'official-direct',
    label: 'Official Direct API',
    description: 'First-party native APIs operated directly by the model vendor.',
  },
  {
    id: 'cloud-platform',
    label: 'Cloud Platform',
    description: 'Enterprise cloud platforms that host model APIs through cloud credentials or deployments.',
  },
  {
    id: 'official-compatible',
    label: 'Official Compatible API',
    description: 'Vendor-official APIs reached through OpenAI, Anthropic, or similar compatibility protocols.',
  },
  {
    id: 'coding-token-plan',
    label: 'Coding / Token Plan',
    description: 'Separate coding plan or token plan products with their own provider entry.',
  },
  {
    id: 'third-party-compatible',
    label: 'Third-party Compatible Endpoint',
    description: 'Gateways, routers, relays, and user-provided API endpoints.',
  },
  {
    id: 'local',
    label: 'Local Model Service',
    description: 'Local runtimes and localhost services with selectable chat or Responses protocols.',
  },
  {
    id: 'image',
    label: 'Image Capability',
    description: 'Image-generation capability entries. This catalog currently keeps them fail-closed.',
  },
];

export const LLM_PROVIDER_PROTOCOL_DEFINITIONS: LlmProviderProtocolDescriptor[] = [
  {
    id: 'OpenAICompatibleChatCompletions',
    label: 'OpenAI Chat Completions',
    description: 'OpenAI-compatible /v1/chat/completions request and streaming shape.',
  },
  {
    id: 'OpenAIResponses',
    label: 'OpenAI Responses',
    description: 'OpenAI Responses API request and streaming shape.',
    responseEndpointHint: 'Only choose this when the endpoint explicitly supports /v1/responses.',
  },
  {
    id: 'AnthropicMessages',
    label: 'Anthropic Messages',
    description: 'Anthropic-compatible /v1/messages request and streaming shape.',
  },
  {
    id: 'OpenRouterChatCompletions',
    label: 'OpenRouter Chat Completions',
    description: 'OpenRouter gateway using OpenAI-style chat completions plus routing headers.',
  },
  {
    id: 'AzureOpenAIChatCompletions',
    label: 'Azure OpenAI Chat Completions',
    description: 'Azure OpenAI deployment endpoint with Azure API version and api-key header.',
  },
  {
    id: 'GoogleGemini',
    label: 'Google Gemini',
    description: 'Google Generative Language / Gemini generateContent protocol.',
  },
  {
    id: 'AwsBedrock',
    label: 'AWS Bedrock',
    description: 'AWS Bedrock model invocation through cloud credentials.',
  },
  {
    id: 'GoogleVertexAI',
    label: 'Google Vertex AI',
    description: 'Google Vertex AI model invocation through cloud credentials.',
  },
  {
    id: 'OllamaOpenAICompatibleChatCompletions',
    label: 'Ollama OpenAI Chat Completions',
    description: 'Local Ollama OpenAI-compatible chat completions endpoint.',
  },
];

const ANTHROPIC_ALIAS_MODELS = ['sonnet', 'opus', 'haiku'];
const ANTHROPIC_FIRST_PARTY_MODELS = ['sonnet', 'opus'];
export const CLAUDE_ACCOUNT_MODELS = [
  'claude-fable-5',
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-haiku-4-5-20251001',
];
export const CHATGPT_ACCOUNT_MODELS = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5-instant',
  'gpt-5.5-thinking',
  'gpt-5.5-pro',
];
export const GITHUB_COPILOT_ACCOUNT_MODELS = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.3-codex',
  'claude-sonnet-5',
  'claude-opus-4-8',
  'gemini-3.1-pro-preview',
  'gemini-3.5-flash',
];
export const GROK_ACCOUNT_MODELS = [
  'grok-4.5',
  'grok-4.3',
  'grok-build-0.1',
  'grok-code-fast-1',
];
export const GEMINI_ACCOUNT_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];
export const QWEN_ACCOUNT_MODELS = [
  'qwen-turbo',
  'qwen-plus',
  'qwen-max',
  'qwen-vl-max',
];
const OPENAI_CODE_MODELS = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-4.1',
];

const CAPS_OPENAI_COMPATIBLE: LlmProviderCapability[] = ['chat', 'tool-calling', 'model-discovery'];
const CAPS_ANTHROPIC: LlmProviderCapability[] = ['chat', 'tool-calling', 'reasoning', 'prompt-cache', 'model-discovery'];
const CAPS_GOOGLE_AI_STUDIO: LlmProviderCapability[] = ['chat', 'tool-calling', 'reasoning', 'vision-input', 'model-discovery'];
const CAPS_OLLAMA: LlmProviderCapability[] = ['chat', 'model-discovery'];
const CAPS_OPENROUTER: LlmProviderCapability[] = ['chat', 'model-discovery'];
const CAPS_AZURE_OPENAI: LlmProviderCapability[] = ['chat', 'model-discovery'];
const CAPS_OPENAI_FIRST_PARTY: LlmProviderCapability[] = ['chat', 'tool-calling', 'structured-output', 'vision-input', 'model-discovery'];
const CAPS_ANTHROPIC_FIRST_PARTY: LlmProviderCapability[] = ['chat', 'tool-calling', 'reasoning', 'prompt-cache', 'vision-input', 'model-discovery'];
const CAPS_XAI: LlmProviderCapability[] = ['chat', 'tool-calling', 'vision-input', 'model-discovery'];
const CAPS_STATIC_CLOUD: LlmProviderCapability[] = ['chat'];

const OPENAI_RESPONSES_OPTIONS: LlmProviderProtocol[] = ['OpenAICompatibleChatCompletions', 'OpenAIResponses'];
const LOCAL_PROTOCOL_OPTIONS: LlmProviderProtocol[] = ['OllamaOpenAICompatibleChatCompletions', 'OpenAIResponses'];
const ANTHROPIC_OPENAI_CHAT_OPTIONS: LlmProviderProtocol[] = ['AnthropicMessages', 'OpenAICompatibleChatCompletions'];
const ANTHROPIC_OPENAI_CHAT_RESPONSES_OPTIONS: LlmProviderProtocol[] = [
  'AnthropicMessages',
  'OpenAICompatibleChatCompletions',
  'OpenAIResponses',
];

const CAPS_COMPAT_REASONING: LlmProviderCapability[] = ['chat', 'tool-calling', 'reasoning', 'model-discovery'];

const APP_MANAGED_PROVIDER_CATEGORIES = new Set<LlmProviderCategory>([
  'login-authorization',
  'official-direct',
  'cloud-platform',
  'official-compatible',
  'coding-token-plan',
]);

export function getProviderCatalogOwnership(category: LlmProviderCategory): LlmProviderCatalogOwnership {
  return APP_MANAGED_PROVIDER_CATEGORIES.has(category) ? 'app-managed' : 'user-managed';
}

export const BUILTIN_LLM_PROVIDER_DEFINITIONS: BuiltinProviderDefinition[] = [
  {
    id: 'claude-account',
    protocol: 'AnthropicMessages',
    authMode: 'account',
    category: 'login-authorization',
    modelDiscovery: 'account-catalog',
    label: 'Claude Account',
    recommendedModels: CLAUDE_ACCOUNT_MODELS,
    docsUrl: 'https://claude.ai/',
    accountLoginConfigured: true,
    capabilities: CAPS_ANTHROPIC,
  },
  {
    id: 'chatgpt-account',
    protocol: 'OpenAIResponses',
    authMode: 'account',
    category: 'login-authorization',
    modelDiscovery: 'account-catalog',
    label: 'ChatGPT Account',
    recommendedModels: CHATGPT_ACCOUNT_MODELS,
    docsUrl: 'https://chatgpt.com/',
    accountLoginConfigured: true,
    capabilities: CAPS_OPENAI_COMPATIBLE,
  },
  {
    id: 'github-copilot',
    protocol: 'OpenAICompatibleChatCompletions',
    authMode: 'account',
    category: 'login-authorization',
    modelDiscovery: 'account-catalog',
    label: 'GitHub Copilot',
    recommendedModels: GITHUB_COPILOT_ACCOUNT_MODELS,
    docsUrl: 'https://github.com/features/copilot',
    accountLoginConfigured: true,
    capabilities: CAPS_OPENAI_COMPATIBLE,
  },
  {
    id: 'grok-account',
    protocol: 'OpenAICompatibleChatCompletions',
    authMode: 'account',
    category: 'login-authorization',
    modelDiscovery: 'account-catalog',
    label: 'Super Grok Account',
    baseUrl: 'https://api.x.ai/v1',
    recommendedModels: GROK_ACCOUNT_MODELS,
    docsUrl: 'https://grok.com/',
    accountLoginConfigured: true,
    capabilities: CAPS_OPENAI_COMPATIBLE,
  },
  {
    id: 'gemini-account',
    protocol: 'GoogleGemini',
    authMode: 'account',
    category: 'login-authorization',
    modelDiscovery: 'account-catalog',
    label: 'Gemini Account',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    recommendedModels: GEMINI_ACCOUNT_MODELS,
    docsUrl: 'https://gemini.google.com/',
    accountLoginConfigured: true,
    unavailableReason: 'Live Gemini account OAuth requires a stable public account authorization contract; this adapter is unavailable outside automated test mode.',
    capabilities: CAPS_GOOGLE_AI_STUDIO,
  },
  {
    id: 'qwen-account',
    protocol: 'OpenAICompatibleChatCompletions',
    authMode: 'account',
    category: 'login-authorization',
    modelDiscovery: 'account-catalog',
    label: 'Qwen Account',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    recommendedModels: QWEN_ACCOUNT_MODELS,
    docsUrl: 'https://chat.qwen.ai/',
    accountLoginConfigured: true,
    unavailableReason: 'Live Qwen account OAuth requires a stable public account authorization contract; this adapter is unavailable outside automated test mode.',
    capabilities: CAPS_OPENAI_COMPATIBLE,
  },
  {
    id: 'openai',
    protocol: 'OpenAIResponses',
    authMode: 'api-key',
    category: 'official-direct',
    modelDiscovery: 'openai-compatible',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    recommendedModels: OPENAI_CODE_MODELS,
    docsUrl: 'https://platform.openai.com/api-keys',
    capabilities: CAPS_OPENAI_FIRST_PARTY,
  },
  {
    id: 'openai-eu',
    protocol: 'OpenAIResponses',
    authMode: 'api-key',
    category: 'official-direct',
    modelDiscovery: 'openai-compatible',
    label: 'OpenAI (EU)',
    baseUrl: 'https://eu.api.openai.com/v1',
    recommendedModels: OPENAI_CODE_MODELS,
    docsUrl: 'https://platform.openai.com/api-keys',
    capabilities: CAPS_OPENAI_FIRST_PARTY,
  },
  {
    id: 'openai-us',
    protocol: 'OpenAIResponses',
    authMode: 'api-key',
    category: 'official-direct',
    modelDiscovery: 'openai-compatible',
    label: 'OpenAI (US)',
    baseUrl: 'https://us.api.openai.com/v1',
    recommendedModels: OPENAI_CODE_MODELS,
    docsUrl: 'https://platform.openai.com/api-keys',
    capabilities: CAPS_OPENAI_FIRST_PARTY,
  },
  {
    id: 'anthropic',
    protocol: 'AnthropicMessages',
    authMode: 'api-key',
    category: 'official-direct',
    modelDiscovery: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    recommendedModels: ANTHROPIC_FIRST_PARTY_MODELS,
    docsUrl: 'https://platform.claude.com/settings/keys',
    capabilities: CAPS_ANTHROPIC_FIRST_PARTY,
  },
  {
    id: 'google-ai-studio',
    protocol: 'GoogleGemini',
    authMode: 'api-key',
    category: 'official-direct',
    modelDiscovery: 'google-ai-studio',
    label: 'Google AI Studio',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    recommendedModels: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    docsUrl: 'https://aistudio.google.com/app/apikey',
    capabilities: CAPS_GOOGLE_AI_STUDIO,
  },
  {
    id: 'azure-openai',
    protocol: 'AzureOpenAIChatCompletions',
    authMode: 'api-key',
    category: 'cloud-platform',
    modelDiscovery: 'azure-openai',
    label: 'Azure OpenAI',
    baseUrl: '',
    baseUrlEditable: true,
    recommendedModels: ['gpt-4.1', 'gpt-5-mini'],
    docsUrl: 'https://learn.microsoft.com/azure/ai-services/openai/',
    capabilities: CAPS_AZURE_OPENAI,
  },
  {
    id: 'bedrock',
    protocol: 'AwsBedrock',
    authMode: 'environment',
    category: 'cloud-platform',
    modelDiscovery: 'static',
    label: 'Amazon Bedrock',
    recommendedModels: ANTHROPIC_ALIAS_MODELS,
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/amazon-bedrock',
    capabilities: CAPS_STATIC_CLOUD,
  },
  {
    id: 'vertex',
    protocol: 'GoogleVertexAI',
    authMode: 'environment',
    category: 'cloud-platform',
    modelDiscovery: 'static',
    label: 'Google Vertex AI',
    recommendedModels: ANTHROPIC_ALIAS_MODELS,
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/google-vertex-ai',
    capabilities: CAPS_STATIC_CLOUD,
  },
  {
    id: 'deepseek',
    protocol: 'AnthropicMessages',
    authMode: 'api-key',
    category: 'official-compatible',
    modelDiscovery: 'anthropic-candidate-validation',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    protocolEditable: true,
    protocolOptions: ANTHROPIC_OPENAI_CHAT_OPTIONS,
    protocolBaseUrls: {
      AnthropicMessages: 'https://api.deepseek.com/anthropic',
      OpenAICompatibleChatCompletions: 'https://api.deepseek.com',
    },
    recommendedModels: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    docsUrl: 'https://platform.deepseek.com/api_keys',
    capabilities: CAPS_COMPAT_REASONING,
  },
  {
    id: 'bailian',
    protocol: 'AnthropicMessages',
    authMode: 'api-key',
    category: 'official-compatible',
    modelDiscovery: null,
    label: 'Alibaba Cloud Bailian',
    recommendedModels: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-vl-max'],
    docsUrl: 'https://bailian.console.aliyun.com/',
    unavailableReason: 'The general Bailian API endpoint is not pinned in this catalog. Use Qwen / DashScope or Bailian Coding Plan until a stable official endpoint is configured.',
    capabilities: CAPS_ANTHROPIC,
  },
  {
    id: 'qwen',
    protocol: 'OpenAICompatibleChatCompletions',
    authMode: 'api-key',
    category: 'official-compatible',
    modelDiscovery: 'openai-compatible',
    label: 'Qwen / DashScope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    recommendedModels: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-flash', 'qwen-vl-max'],
    docsUrl: 'https://dashscope.console.aliyun.com/apiKey',
    capabilities: CAPS_OPENAI_COMPATIBLE,
  },
  {
    id: 'volcengine',
    protocol: 'OpenAICompatibleChatCompletions',
    authMode: 'api-key',
    category: 'official-compatible',
    modelDiscovery: null,
    label: 'Volcengine Ark (Doubao)',
    recommendedModels: ['doubao-seed-2.1-pro', 'doubao-seed-2.1-turbo', 'glm-4.6', 'deepseek-v4-pro', 'kimi-k2.5'],
    docsUrl: 'https://www.volcengine.com/docs/82379/1928262',
    unavailableReason: 'The general Volcengine Ark API endpoint is not pinned in this catalog. Use Volcengine Ark Coding Plan until a stable official endpoint is configured.',
    capabilities: CAPS_OPENAI_COMPATIBLE,
  },
  {
    id: 'glm-cn',
    protocol: 'AnthropicMessages',
    authMode: 'api-key',
    category: 'official-compatible',
    modelDiscovery: 'anthropic-candidate-validation',
    label: 'Zhipu AI GLM (CN)',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    protocolEditable: true,
    protocolOptions: ANTHROPIC_OPENAI_CHAT_OPTIONS,
    protocolBaseUrls: {
      AnthropicMessages: 'https://open.bigmodel.cn/api/anthropic',
      OpenAICompatibleChatCompletions: 'https://open.bigmodel.cn/api/paas/v4',
    },
    recommendedModels: ANTHROPIC_ALIAS_MODELS,
    docsUrl: 'https://open.bigmodel.cn/',
    capabilities: CAPS_COMPAT_REASONING,
  },
  {
    id: 'glm-global',
    protocol: 'AnthropicMessages',
    authMode: 'api-key',
    category: 'official-compatible',
    modelDiscovery: 'anthropic-candidate-validation',
    label: 'Z.ai GLM (Global)',
    baseUrl: 'https://api.z.ai/api/anthropic',
    protocolEditable: true,
    protocolOptions: ANTHROPIC_OPENAI_CHAT_OPTIONS,
    protocolBaseUrls: {
      AnthropicMessages: 'https://api.z.ai/api/anthropic',
      OpenAICompatibleChatCompletions: 'https://api.z.ai/api/paas/v4',
    },
    recommendedModels: ANTHROPIC_ALIAS_MODELS,
    docsUrl: 'https://platform.z.ai/',
    capabilities: CAPS_COMPAT_REASONING,
  },
  {
    id: 'minimax-cn',
    protocol: 'AnthropicMessages',
    authMode: 'api-key',
    category: 'official-compatible',
    modelDiscovery: 'anthropic-candidate-validation',
    label: 'MiniMax (CN)',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    protocolEditable: true,
    protocolOptions: ANTHROPIC_OPENAI_CHAT_OPTIONS,
    protocolBaseUrls: {
      AnthropicMessages: 'https://api.minimaxi.com/anthropic',
      OpenAICompatibleChatCompletions: 'https://api.minimaxi.com/v1',
    },
    recommendedModels: ['MiniMax-M2.7'],
    docsUrl: 'https://platform.minimaxi.com/',
    capabilities: CAPS_COMPAT_REASONING,
  },
  {
    id: 'minimax-global',
    protocol: 'AnthropicMessages',
    authMode: 'api-key',
    category: 'official-compatible',
    modelDiscovery: 'anthropic-candidate-validation',
    label: 'MiniMax (Global)',
    baseUrl: 'https://api.minimax.io/anthropic',
    protocolEditable: true,
    protocolOptions: ANTHROPIC_OPENAI_CHAT_OPTIONS,
    protocolBaseUrls: {
      AnthropicMessages: 'https://api.minimax.io/anthropic',
      OpenAICompatibleChatCompletions: 'https://api.minimax.io/v1',
    },
    recommendedModels: ['MiniMax-M2.7'],
    docsUrl: 'https://platform.minimaxi.com/',
    capabilities: CAPS_COMPAT_REASONING,
  },
  {
    id: 'xiaomi-mimo',
    protocol: 'AnthropicMessages',
    authMode: 'api-key',
    category: 'official-compatible',
    modelDiscovery: 'anthropic-candidate-validation',
    label: 'Xiaomi MiMo',
    baseUrl: 'https://api.xiaomimimo.com/anthropic',
    protocolEditable: true,
    protocolOptions: ANTHROPIC_OPENAI_CHAT_RESPONSES_OPTIONS,
    protocolBaseUrls: {
      AnthropicMessages: 'https://api.xiaomimimo.com/anthropic',
      OpenAICompatibleChatCompletions: 'https://api.xiaomimimo.com/v1',
      OpenAIResponses: 'https://api.xiaomimimo.com/v1',
    },
    recommendedModels: ['mimo-v2.5-pro'],
    docsUrl: 'https://platform.xiaomimimo.com/#/console/api-keys',
    capabilities: CAPS_COMPAT_REASONING,
  },
  {
    id: 'moonshot',
    protocol: 'AnthropicMessages',
    authMode: 'api-key',
    category: 'official-compatible',
    modelDiscovery: 'anthropic-candidate-validation',
    label: 'Kimi / Moonshot AI',
    baseUrl: 'https://api.moonshot.cn/anthropic',
    protocolEditable: true,
    protocolOptions: ANTHROPIC_OPENAI_CHAT_OPTIONS,
    protocolBaseUrls: {
      AnthropicMessages: 'https://api.moonshot.cn/anthropic',
      OpenAICompatibleChatCompletions: 'https://api.moonshot.cn/v1',
    },
    recommendedModels: ['sonnet'],
    docsUrl: 'https://platform.moonshot.cn/console/api-keys',
    capabilities: CAPS_COMPAT_REASONING,
  },
  {
    id: 'xai',
    protocol: 'OpenAICompatibleChatCompletions',
    authMode: 'api-key',
    category: 'official-compatible',
    modelDiscovery: 'openai-compatible',
    label: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    recommendedModels: GROK_ACCOUNT_MODELS,
    docsUrl: 'https://docs.x.ai/',
    capabilities: CAPS_XAI,
  },
  {
    id: 'groq',
    protocol: 'OpenAICompatibleChatCompletions',
    authMode: 'api-key',
    category: 'official-compatible',
    modelDiscovery: 'openai-compatible',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    recommendedModels: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'],
    docsUrl: 'https://console.groq.com/keys',
    capabilities: CAPS_OPENAI_COMPATIBLE,
  },
  {
    id: 'mistral',
    protocol: 'OpenAICompatibleChatCompletions',
    authMode: 'api-key',
    category: 'official-compatible',
    modelDiscovery: 'openai-compatible',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    recommendedModels: ['mistral-large-latest', 'codestral-latest'],
    docsUrl: 'https://console.mistral.ai/api-keys/',
    capabilities: CAPS_OPENAI_COMPATIBLE,
  },
  {
    id: 'cerebras',
    protocol: 'OpenAICompatibleChatCompletions',
    authMode: 'api-key',
    category: 'official-compatible',
    modelDiscovery: 'openai-compatible',
    label: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    recommendedModels: ['llama-4-scout-17b-16e-instruct', 'qwen-3-coder-480b'],
    docsUrl: 'https://cloud.cerebras.ai/',
    capabilities: CAPS_OPENAI_COMPATIBLE,
  },
  {
    id: 'kimi-coding-plan',
    protocol: 'AnthropicMessages',
    authMode: 'api-key',
    category: 'coding-token-plan',
    modelDiscovery: 'anthropic-candidate-validation',
    label: 'Kimi Coding Plan',
    baseUrl: 'https://api.kimi.com/coding/',
    protocolEditable: true,
    protocolOptions: ANTHROPIC_OPENAI_CHAT_OPTIONS,
    protocolBaseUrls: {
      AnthropicMessages: 'https://api.kimi.com/coding/',
      OpenAICompatibleChatCompletions: 'https://api.kimi.com/coding/v1',
    },
    recommendedModels: ['kimi-for-coding'],
    docsUrl: 'https://www.kimi.com/code/docs/en/',
    capabilities: CAPS_COMPAT_REASONING,
  },
  {
    id: 'bailian-coding-plan',
    protocol: 'AnthropicMessages',
    authMode: 'api-key',
    category: 'coding-token-plan',
    modelDiscovery: 'anthropic-candidate-validation',
    label: 'Alibaba Cloud Bailian Coding Plan',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    recommendedModels: ['qwen3.6-plus', 'qwen3-coder-next', 'qwen3-coder-plus', 'kimi-k2.5', 'glm-5', 'glm-4.7'],
    docsUrl: 'https://bailian.console.aliyun.com/',
    capabilities: CAPS_COMPAT_REASONING,
  },
  {
    id: 'volcengine-coding-plan',
    protocol: 'AnthropicMessages',
    authMode: 'api-key',
    category: 'coding-token-plan',
    modelDiscovery: 'anthropic-candidate-validation',
    label: 'Volcengine Ark Coding Plan',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
    protocolEditable: true,
    protocolOptions: ANTHROPIC_OPENAI_CHAT_OPTIONS,
    protocolBaseUrls: {
      AnthropicMessages: 'https://ark.cn-beijing.volces.com/api/coding',
      OpenAICompatibleChatCompletions: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    },
    recommendedModels: ['doubao-seed-2.1-pro', 'doubao-seed-2.1-turbo', 'glm-4.6', 'deepseek-v4-pro', 'kimi-k2.5'],
    docsUrl: 'https://www.volcengine.com/docs/82379/1928262',
    capabilities: CAPS_COMPAT_REASONING,
  },
  {
    id: 'glm-cn-coding-plan',
    protocol: 'AnthropicMessages',
    authMode: 'api-key',
    category: 'coding-token-plan',
    modelDiscovery: 'anthropic-candidate-validation',
    label: 'Zhipu AI GLM Coding Plan (CN)',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    protocolEditable: true,
    protocolOptions: ANTHROPIC_OPENAI_CHAT_OPTIONS,
    protocolBaseUrls: {
      AnthropicMessages: 'https://open.bigmodel.cn/api/anthropic',
      OpenAICompatibleChatCompletions: 'https://open.bigmodel.cn/api/coding/paas/v4',
    },
    recommendedModels: ['glm-5', 'glm-4.7', 'sonnet', 'opus', 'haiku'],
    docsUrl: 'https://open.bigmodel.cn/',
    capabilities: CAPS_COMPAT_REASONING,
  },
  {
    id: 'glm-global-coding-plan',
    protocol: 'AnthropicMessages',
    authMode: 'api-key',
    category: 'coding-token-plan',
    modelDiscovery: 'anthropic-candidate-validation',
    label: 'Z.ai GLM Coding Plan (Global)',
    baseUrl: 'https://api.z.ai/api/anthropic',
    protocolEditable: true,
    protocolOptions: ANTHROPIC_OPENAI_CHAT_OPTIONS,
    protocolBaseUrls: {
      AnthropicMessages: 'https://api.z.ai/api/anthropic',
      OpenAICompatibleChatCompletions: 'https://api.z.ai/api/coding/paas/v4',
    },
    recommendedModels: ['glm-5', 'glm-4.7', 'sonnet', 'opus', 'haiku'],
    docsUrl: 'https://platform.z.ai/',
    capabilities: CAPS_COMPAT_REASONING,
  },
  {
    id: 'minimax-cn-coding-plan',
    protocol: 'AnthropicMessages',
    authMode: 'api-key',
    category: 'coding-token-plan',
    modelDiscovery: 'anthropic-candidate-validation',
    label: 'MiniMax Coding Plan (CN)',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    protocolEditable: true,
    protocolOptions: ANTHROPIC_OPENAI_CHAT_OPTIONS,
    protocolBaseUrls: {
      AnthropicMessages: 'https://api.minimaxi.com/anthropic',
      OpenAICompatibleChatCompletions: 'https://api.minimaxi.com/v1',
    },
    recommendedModels: ['MiniMax-M2.7'],
    docsUrl: 'https://platform.minimaxi.com/',
    capabilities: CAPS_COMPAT_REASONING,
  },
  {
    id: 'minimax-global-coding-plan',
    protocol: 'AnthropicMessages',
    authMode: 'api-key',
    category: 'coding-token-plan',
    modelDiscovery: 'anthropic-candidate-validation',
    label: 'MiniMax Coding Plan (Global)',
    baseUrl: 'https://api.minimax.io/anthropic',
    protocolEditable: true,
    protocolOptions: ANTHROPIC_OPENAI_CHAT_OPTIONS,
    protocolBaseUrls: {
      AnthropicMessages: 'https://api.minimax.io/anthropic',
      OpenAICompatibleChatCompletions: 'https://api.minimax.io/v1',
    },
    recommendedModels: ['MiniMax-M2.7'],
    docsUrl: 'https://platform.minimaxi.com/',
    capabilities: CAPS_COMPAT_REASONING,
  },
  {
    id: 'xiaomi-mimo-token-plan',
    protocol: 'AnthropicMessages',
    authMode: 'api-key',
    category: 'coding-token-plan',
    modelDiscovery: 'anthropic-candidate-validation',
    label: 'Xiaomi MiMo Token Plan',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic',
    protocolEditable: true,
    protocolOptions: ANTHROPIC_OPENAI_CHAT_RESPONSES_OPTIONS,
    protocolBaseUrls: {
      AnthropicMessages: 'https://token-plan-cn.xiaomimimo.com/anthropic',
      OpenAICompatibleChatCompletions: 'https://token-plan-cn.xiaomimimo.com/v1',
      OpenAIResponses: 'https://token-plan-cn.xiaomimimo.com/v1',
    },
    recommendedModels: ['mimo-v2.5-pro'],
    docsUrl: 'https://platform.xiaomimimo.com/#/console/plan-manage',
    capabilities: CAPS_COMPAT_REASONING,
  },
  {
    id: 'openrouter',
    protocol: 'OpenRouterChatCompletions',
    authMode: 'api-key',
    category: 'third-party-compatible',
    modelDiscovery: 'openai-compatible',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    recommendedModels: ['anthropic/claude-haiku-latest', 'anthropic/claude-sonnet-4.5', 'openai/gpt-5.2'],
    docsUrl: 'https://openrouter.ai/keys',
    capabilities: CAPS_OPENROUTER,
  },
  {
    id: 'custom-endpoint',
    protocol: 'OpenAICompatibleChatCompletions',
    authMode: 'api-key',
    category: 'third-party-compatible',
    modelDiscovery: 'openai-compatible',
    label: 'Custom OpenAI Endpoint',
    baseUrl: '',
    baseUrlEditable: true,
    protocolEditable: true,
    protocolOptions: OPENAI_RESPONSES_OPTIONS,
    recommendedModels: ['gpt-4.1'],
    docsUrl: 'https://platform.openai.com/docs/api-reference',
    capabilities: CAPS_OPENAI_COMPATIBLE,
  },
  {
    id: 'anthropic-thirdparty',
    protocol: 'AnthropicMessages',
    authMode: 'api-key',
    category: 'third-party-compatible',
    modelDiscovery: 'anthropic-candidate-validation',
    label: 'Custom Anthropic Endpoint',
    baseUrl: '',
    baseUrlEditable: true,
    recommendedModels: ANTHROPIC_ALIAS_MODELS,
    docsUrl: 'https://platform.claude.com/docs/en/api/overview',
    capabilities: CAPS_ANTHROPIC,
  },
  {
    id: '302ai',
    protocol: 'OpenAICompatibleChatCompletions',
    authMode: 'api-key',
    category: 'third-party-compatible',
    modelDiscovery: 'openai-compatible',
    label: '302.AI',
    baseUrl: 'https://api.302.ai/v1',
    recommendedModels: ['gpt-4o', 'claude-3-7-sonnet'],
    docsUrl: 'https://302.ai/',
    capabilities: CAPS_OPENAI_COMPATIBLE,
  },
  {
    id: 'siliconflow',
    protocol: 'OpenAICompatibleChatCompletions',
    authMode: 'api-key',
    category: 'third-party-compatible',
    modelDiscovery: 'openai-compatible',
    label: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    recommendedModels: ['Qwen/Qwen3-32B', 'deepseek-ai/DeepSeek-V3'],
    docsUrl: 'https://siliconflow.cn/',
    capabilities: CAPS_OPENAI_COMPATIBLE,
  },
  {
    id: 'litellm',
    protocol: 'AnthropicMessages',
    authMode: 'api-key',
    category: 'third-party-compatible',
    modelDiscovery: 'anthropic-candidate-validation',
    label: 'LiteLLM',
    baseUrl: 'http://localhost:4000',
    baseUrlEditable: true,
    recommendedModels: ANTHROPIC_ALIAS_MODELS,
    docsUrl: 'https://docs.litellm.ai/docs/',
    capabilities: CAPS_ANTHROPIC,
  },
  {
    id: 'vercel-ai-gateway',
    protocol: 'OpenAICompatibleChatCompletions',
    authMode: 'api-key',
    category: 'third-party-compatible',
    modelDiscovery: 'openai-compatible',
    label: 'Vercel AI Gateway',
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    recommendedModels: ['openai/gpt-5.2', 'anthropic/claude-sonnet-4.5'],
    docsUrl: 'https://vercel.com/docs/ai-gateway',
    capabilities: CAPS_OPENAI_COMPATIBLE,
  },
  {
    id: 'huggingface',
    protocol: 'OpenAICompatibleChatCompletions',
    authMode: 'api-key',
    category: 'third-party-compatible',
    modelDiscovery: 'openai-compatible',
    label: 'Hugging Face Router',
    baseUrl: 'https://router.huggingface.co/v1',
    recommendedModels: ['openai/gpt-oss-120b', 'Qwen/Qwen3-Coder-480B-A35B-Instruct'],
    docsUrl: 'https://huggingface.co/settings/tokens',
    capabilities: CAPS_OPENAI_COMPATIBLE,
  },
  {
    id: 'manifest',
    protocol: 'OpenAICompatibleChatCompletions',
    authMode: 'api-key',
    category: 'third-party-compatible',
    modelDiscovery: 'openai-compatible',
    label: 'Manifest',
    baseUrl: 'https://app.manifest.build/v1',
    recommendedModels: ['gpt-4.1'],
    docsUrl: 'https://app.manifest.build/',
    capabilities: CAPS_OPENAI_COMPATIBLE,
  },
  {
    id: 'ollama',
    protocol: 'OllamaOpenAICompatibleChatCompletions',
    authMode: 'local',
    category: 'local',
    modelDiscovery: 'ollama-tags',
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    baseUrlEditable: true,
    protocolEditable: true,
    protocolOptions: LOCAL_PROTOCOL_OPTIONS,
    recommendedModels: ['qwen2.5-coder:14b', 'llama3.1:8b'],
    docsUrl: 'https://ollama.com/download',
    capabilities: CAPS_OLLAMA,
  },
];

export function isBuiltinProviderId(id: string): id is BuiltinLlmProviderId {
  return BUILTIN_LLM_PROVIDER_DEFINITIONS.some((entry) => entry.id === id);
}

export function getBuiltinProviderDefinition(id: string): BuiltinProviderDefinition | null {
  return BUILTIN_LLM_PROVIDER_DEFINITIONS.find((entry) => entry.id === id) ?? null;
}

export function getBuiltinProviderCatalogOwnership(id: string): LlmProviderCatalogOwnership {
  const definition = getBuiltinProviderDefinition(id);
  if (!definition) {
    return 'user-managed';
  }
  return definition.catalogOwnership ?? getProviderCatalogOwnership(definition.category);
}

export function isLlmProviderProtocol(value: unknown): value is LlmProviderProtocol {
  return typeof value === 'string'
    && LLM_PROVIDER_PROTOCOL_DEFINITIONS.some((entry) => entry.id === value);
}

export function getBuiltinProviderProtocolOptions(id: string): LlmProviderProtocol[] {
  const definition = getBuiltinProviderDefinition(id);
  if (!definition) {
    return [];
  }
  return definition.protocolOptions?.length ? [...definition.protocolOptions] : [definition.protocol];
}

export function resolveBuiltinProviderProtocol(id: string, candidate: unknown): LlmProviderProtocol | null {
  const definition = getBuiltinProviderDefinition(id);
  if (!definition) {
    return null;
  }
  const options = getBuiltinProviderProtocolOptions(id);
  if (definition.protocolEditable && isLlmProviderProtocol(candidate) && options.includes(candidate)) {
    return candidate;
  }
  return definition.protocol;
}

export function resolveBuiltinProtocolBaseUrl(
  id: string,
  protocol: LlmProviderProtocol,
): string | undefined {
  const definition = getBuiltinProviderDefinition(id);
  if (!definition) return undefined;
  const mapped = definition.protocolBaseUrls?.[protocol];
  if (typeof mapped === 'string' && mapped.trim()) return mapped.trim().replace(/\/+$/, '');
  if (protocol === definition.protocol && typeof definition.baseUrl === 'string') {
    return definition.baseUrl.trim().replace(/\/+$/, '');
  }
  return typeof definition.baseUrl === 'string' ? definition.baseUrl.trim().replace(/\/+$/, '') : undefined;
}

export function resolveBaseUrlForProtocolChange(
  id: string,
  previousProtocol: LlmProviderProtocol,
  nextProtocol: LlmProviderProtocol,
  currentBaseUrl: string | undefined,
): string {
  const previousDefault = resolveBuiltinProtocolBaseUrl(id, previousProtocol) ?? '';
  const nextDefault = resolveBuiltinProtocolBaseUrl(id, nextProtocol) ?? '';
  const current = (currentBaseUrl ?? '').trim().replace(/\/+$/, '');
  if (!current || current === previousDefault) {
    return nextDefault || current;
  }
  return currentBaseUrl?.trim() ?? current;
}

export function getBuiltinProviderProtocolBaseUrls(
  id: string,
): Partial<Record<LlmProviderProtocol, string>> | undefined {
  const definition = getBuiltinProviderDefinition(id);
  if (!definition?.protocolBaseUrls) return undefined;
  return { ...definition.protocolBaseUrls };
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

  const catalogOwnership = getBuiltinProviderCatalogOwnership(definition.id);
  const managedModels = catalogOwnership === 'app-managed'
    ? getManagedProviderModels(definition.id)
    : [];
  const recommendedModels = managedModels.length > 0
    ? managedModels.map((entry) => entry.id)
    : [...definition.recommendedModels];
  const status = definition.unavailableReason ? 'unavailable' : 'unconfigured';

  return {
    id: definition.id,
    protocol: definition.protocol,
    authMode: definition.authMode,
    category: definition.category,
    catalogOwnership,
    modelDiscovery: definition.modelDiscovery,
    label: definition.label,
    enabled: false,
    apiKey: '',
    hasStoredSecret: !definition.unavailableReason && (definition.authMode === 'local' || definition.authMode === 'environment'),
    baseUrl: definition.baseUrl,
    baseUrlEditable: definition.baseUrlEditable,
    protocolEditable: definition.protocolEditable,
    protocolOptions: getBuiltinProviderProtocolOptions(definition.id),
    protocolBaseUrls: getBuiltinProviderProtocolBaseUrls(definition.id),
    models: managedModels.length > 0
      ? managedModels
      : definition.modelDiscovery === 'static' && definition.authMode === 'environment'
        ? toModels(definition.recommendedModels)
        : toModels([]),
    recommendedModels,
    docsUrl: definition.docsUrl,
    status,
    accountLoginConfigured: definition.accountLoginConfigured,
    unavailableReason: definition.unavailableReason,
    isConfigured: false,
    capabilities: definition.capabilities ? [...definition.capabilities] : undefined,
  };
};

export const createBuiltinProviderEntries = (): LlmProviderEntry[] =>
  BUILTIN_LLM_PROVIDER_DEFINITIONS.map((entry) => createBuiltinProviderEntry(entry.id));
