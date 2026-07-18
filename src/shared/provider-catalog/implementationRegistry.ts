import type { LlmProviderProtocol } from '../types/settings';

export type ProviderOperationBuilderId =
  | 'anthropic-messages'
  | 'azure-chat-completions'
  | 'gitlab-agentic-chat'
  | 'google-gemini'
  | 'google-vertex-anthropic'
  | 'google-vertex-gemini'
  | 'ollama-chat-completions'
  | 'openai-chat-completions'
  | 'openai-responses'
  | 'openrouter-chat-completions'
  | 'sap-ai-core-foundation-models'
  | 'sap-ai-core-orchestration';

export interface ProviderAdapterImplementation {
  protocols: readonly LlmProviderProtocol[];
  operationBuilderId: ProviderOperationBuilderId;
  transport: 'http' | 'sdk';
}

/**
 * Closed behavior registry for every adapter that a JSON manifest may name.
 * Catalog facts stay in JSON; executable transport and operation mechanics stay in TypeScript.
 */
export const PROVIDER_ADAPTER_IMPLEMENTATIONS = {
  'anthropic-messages': {
    protocols: ['AnthropicMessages'],
    operationBuilderId: 'anthropic-messages',
    transport: 'http',
  },
  'azure-openai-chat': {
    protocols: ['AzureOpenAIChatCompletions'],
    operationBuilderId: 'azure-chat-completions',
    transport: 'http',
  },
  'gitlab-duo': {
    protocols: ['GitLabDuo'],
    operationBuilderId: 'gitlab-agentic-chat',
    transport: 'sdk',
  },
  'google-gemini': {
    protocols: ['GoogleGemini'],
    operationBuilderId: 'google-gemini',
    transport: 'http',
  },
  'google-vertex-anthropic': {
    protocols: ['GoogleVertexAnthropic'],
    operationBuilderId: 'google-vertex-anthropic',
    transport: 'http',
  },
  'google-vertex-gemini': {
    protocols: ['GoogleVertexGemini'],
    operationBuilderId: 'google-vertex-gemini',
    transport: 'http',
  },
  'ollama-openai-compatible': {
    protocols: ['OllamaOpenAICompatibleChatCompletions'],
    operationBuilderId: 'ollama-chat-completions',
    transport: 'http',
  },
  'openai-compatible': {
    protocols: ['OpenAICompatibleChatCompletions'],
    operationBuilderId: 'openai-chat-completions',
    transport: 'http',
  },
  'openai-responses': {
    protocols: ['OpenAIResponses'],
    operationBuilderId: 'openai-responses',
    transport: 'http',
  },
  'openrouter-chat': {
    protocols: ['OpenRouterChatCompletions'],
    operationBuilderId: 'openrouter-chat-completions',
    transport: 'http',
  },
  'sap-ai-core-foundation-models': {
    protocols: ['SapAiCoreFoundationModels'],
    operationBuilderId: 'sap-ai-core-foundation-models',
    transport: 'sdk',
  },
  'sap-ai-core-orchestration': {
    protocols: ['SapAiCoreOrchestration'],
    operationBuilderId: 'sap-ai-core-orchestration',
    transport: 'sdk',
  },
} as const satisfies Record<string, ProviderAdapterImplementation>;

export type ProviderAdapterId = keyof typeof PROVIDER_ADAPTER_IMPLEMENTATIONS;

export const PROVIDER_ADAPTER_IDS = Object.freeze(
  Object.keys(PROVIDER_ADAPTER_IMPLEMENTATIONS) as ProviderAdapterId[],
);

export function getProviderAdapterImplementation(
  adapterId: string,
): ProviderAdapterImplementation | undefined {
  return PROVIDER_ADAPTER_IMPLEMENTATIONS[adapterId as ProviderAdapterId];
}

export function providerAdapterSupportsProtocol(
  adapterId: string,
  protocol: LlmProviderProtocol,
): boolean {
  return getProviderAdapterImplementation(adapterId)?.protocols.includes(protocol) === true;
}

export function providerAdapterIdForProtocol(protocol: LlmProviderProtocol): ProviderAdapterId {
  const matches = PROVIDER_ADAPTER_IDS.filter((adapterId) => (
    (PROVIDER_ADAPTER_IMPLEMENTATIONS[adapterId].protocols as readonly LlmProviderProtocol[]).includes(protocol)
  ));
  if (matches.length !== 1) {
    throw new Error(`Protocol ${protocol} must resolve to exactly one runtime adapter; received ${matches.length}.`);
  }
  return matches[0];
}

export const PROVIDER_AUTH_SCHEMA_IDS = [
  'aws-bedrock',
  'declarative-api-key',
  'device-account',
  'google-vertex',
  'local-runtime',
  'oauth-account',
  'sap-ai-core',
  'user-endpoint',
] as const;

export const PROVIDER_DISCOVERY_POLICY_IDS = [
  'none',
  'account-catalog',
  'anthropic',
  'anthropic-candidate-validation',
  'azure-deployment',
  'cline-catalog',
  'freemodel-catalog',
  'gitlab-duo-direct-access',
  'google-ai-studio',
  'google-vertex-models',
  'grok-account-catalog',
  'json-catalog',
  'kimi-code-catalog',
  'ollama-tags',
  'openai-compatible',
  'openrouter-catalog',
  'opencode-go-catalog',
  'sap-ai-core-deployments',
] as const;

export type ProviderAuthSchemaId = typeof PROVIDER_AUTH_SCHEMA_IDS[number];
export type ProviderDiscoveryPolicyId = typeof PROVIDER_DISCOVERY_POLICY_IDS[number];
