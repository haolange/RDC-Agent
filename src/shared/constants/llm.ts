import type {
  LlmProviderCategoryDescriptor,
  LlmProviderProtocol,
  LlmProviderProtocolDescriptor,
} from '@shared/types/settings';

export const SUPER_GROK_OAUTH_REDIRECT_URI = 'http://127.0.0.1:56121/callback';


export const LLM_PROVIDER_CATEGORY_DEFINITIONS: LlmProviderCategoryDescriptor[] = [
  {
    id: 'login-authorization',
    label: 'OAuth / Login',
    description: 'Official account login, OAuth, device flow, or account authorization providers.',
  },
  {
    id: 'official-direct',
    label: 'First-party Direct',
    description: 'First-party native APIs operated directly by the model vendor.',
  },
  {
    id: 'cloud-platform',
    label: 'Cloud Platform',
    description: 'Enterprise cloud platforms that host model APIs through cloud credentials or deployments.',
  },
  {
    id: 'compatible-access',
    label: 'Compatible Access',
    description: 'Official or third-party services reached through a compatibility protocol; operator facts remain explicit.',
  },
  {
    id: 'coding-token-plan',
    label: 'Coding / Token Plan',
    description: 'Separate coding plan or token plan products with their own provider entry.',
  },
  {
    id: 'local',
    label: 'Local Model Service',
    description: 'Local runtimes and localhost services with selectable chat or Responses protocols.',
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
    id: 'GoogleInteractions',
    label: 'Google Interactions',
    description: 'Google Gemini Interactions API with structured steps and optional provider-managed state.',
    responseEndpointHint: 'First-party Gemini /v1/interactions endpoint.',
  },
  {
    id: 'GoogleGemini',
    label: 'Google GenerateContent',
    description: 'Google Generative Language / Gemini generateContent protocol.',
  },
  {
    id: 'GoogleVertexGemini',
    label: 'Google Vertex Gemini',
    description: 'Vertex AI publisher model streamGenerateContent with OAuth bearer authentication.',
  },
  {
    id: 'GoogleVertexAnthropic',
    label: 'Google Vertex Anthropic',
    description: 'Vertex AI Anthropic partner-model streamRawPredict with OAuth bearer authentication.',
  },
  {
    id: 'GitLabDuo',
    label: 'GitLab Duo',
    description: 'GitLab Duo Agentic Chat using GitLab direct-access and AI Gateway contracts.',
  },
  {
    id: 'SapAiCoreOrchestration',
    label: 'SAP AI Core Orchestration',
    description: 'SAP AI Core Orchestration API with deployment resolution and service-key OAuth.',
  },
  {
    id: 'SapAiCoreFoundationModels',
    label: 'SAP AI Core Foundation Models',
    description: 'SAP AI Core Foundation Models API with deployment resolution and service-key OAuth.',
  },
  {
    id: 'OllamaOpenAICompatibleChatCompletions',
    label: 'Ollama OpenAI Chat Completions',
    description: 'Local Ollama OpenAI-compatible chat completions endpoint.',
  },
];


export function isLlmProviderProtocol(value: unknown): value is LlmProviderProtocol {
  return typeof value === 'string'
    && LLM_PROVIDER_PROTOCOL_DEFINITIONS.some((entry) => entry.id === value);
}
