import type {
  LlmProviderCategory,
  LlmProviderCategoryDescriptor,
  LlmProviderCatalogOwnership,
  LlmProviderProtocol,
  LlmProviderProtocolDescriptor,
} from '@shared/types/settings';

export const SUPER_GROK_OAUTH_CALLBACK_PORT = 1456;
export const SUPER_GROK_OAUTH_REDIRECT_URI = `http://localhost:${SUPER_GROK_OAUTH_CALLBACK_PORT}/oauth/grok/callback`;


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

export function isLlmProviderProtocol(value: unknown): value is LlmProviderProtocol {
  return typeof value === 'string'
    && LLM_PROVIDER_PROTOCOL_DEFINITIONS.some((entry) => entry.id === value);
}
