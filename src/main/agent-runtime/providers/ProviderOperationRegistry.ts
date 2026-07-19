import {
  getProviderAdapterImplementation,
  providerAdapterSupportsProtocol,
  type ProviderAdapterId,
  type ProviderOperationBuilderId,
} from '@shared/provider-catalog/implementationRegistry';
import type { LlmProviderProtocol } from '@shared/types/settings';
import { buildAnthropicMessagesUrl } from './AnthropicProvider';
import { buildGeminiStreamUrl } from './GeminiProvider';
import { buildGoogleInteractionsUrl } from './GoogleInteractionsProvider';
import { buildChatCompletionsUrl } from './OpenAICompatibleProvider';
import { buildOpenAIResponsesUrl } from './OpenAIResponsesProvider';

export interface ProviderOperationInput {
  adapterId: ProviderAdapterId;
  protocol: LlmProviderProtocol;
  baseUrl: string;
  modelId: string;
  connectionValues?: Readonly<Record<string, string>>;
}

export interface ProviderOperationTarget {
  operationBuilderId: ProviderOperationBuilderId;
  transport: 'http' | 'sdk';
  url: string;
}

/** Builds the exact operation URL shape used by each registered adapter. */
export function buildProviderOperationTarget(input: ProviderOperationInput): ProviderOperationTarget {
  const implementation = getProviderAdapterImplementation(input.adapterId);
  if (!implementation || !providerAdapterSupportsProtocol(input.adapterId, input.protocol)) {
    throw new Error(`Adapter ${input.adapterId} does not implement ${input.protocol}.`);
  }
  const baseUrl = requireBaseUrl(input.baseUrl);
  const url = buildOperationUrl(implementation.operationBuilderId, baseUrl, input);
  return {
    operationBuilderId: implementation.operationBuilderId,
    transport: implementation.transport,
    url,
  };
}

function buildOperationUrl(
  operationBuilderId: ProviderOperationBuilderId,
  baseUrl: string,
  input: ProviderOperationInput,
): string {
  switch (operationBuilderId) {
    case 'anthropic-messages':
      return buildAnthropicMessagesUrl(baseUrl, input.modelId);
    case 'google-vertex-anthropic':
      return buildAnthropicMessagesUrl(baseUrl, input.modelId, 'vertex');
    case 'google-interactions':
      return buildGoogleInteractionsUrl(baseUrl);
    case 'google-gemini':
      return buildGeminiStreamUrl(baseUrl, input.modelId, 'catalog-contract-key', 'ai-studio');
    case 'google-vertex-gemini':
      return buildGeminiStreamUrl(baseUrl, input.modelId, 'catalog-contract-token', 'vertex');
    case 'azure-chat-completions':
      return buildChatCompletionsUrl(baseUrl, { 'api-version': '2024-10-21' });
    case 'ollama-chat-completions':
    case 'openai-chat-completions':
    case 'openrouter-chat-completions':
      return buildChatCompletionsUrl(baseUrl);
    case 'openai-responses':
      return buildOpenAIResponsesUrl(baseUrl);
    case 'gitlab-agentic-chat':
      return buildGitLabAgenticChatUrl(baseUrl, input.modelId);
    case 'sap-ai-core-orchestration':
      return buildSapAiCoreOperationUrl(baseUrl, requireDeploymentId(input), 'orchestration');
    case 'sap-ai-core-foundation-models':
      return buildSapAiCoreOperationUrl(baseUrl, requireDeploymentId(input), 'foundation-models');
    default:
      return assertNever(operationBuilderId);
  }
}

export function buildGitLabAgenticChatUrl(instanceUrl: string, modelId: string): string {
  const url = new URL('/api/v4/ai/duo_workflows/ws', `${requireBaseUrl(instanceUrl)}/`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (modelId && modelId !== 'default') url.searchParams.set('user_selected_model_identifier', modelId);
  return url.toString();
}

export function buildSapAiCoreOperationUrl(
  aiApiUrl: string,
  deploymentId: string,
  api: 'orchestration' | 'foundation-models',
): string {
  const operation = api === 'orchestration' ? 'v2/completion' : 'chat/completions';
  return `${requireBaseUrl(aiApiUrl)}/inference/deployments/${encodeURIComponent(deploymentId)}/${operation}`;
}

function requireDeploymentId(input: ProviderOperationInput): string {
  const value = input.connectionValues?.AICORE_DEPLOYMENT_ID?.trim();
  if (!value) throw new Error(`${input.adapterId} requires a resolved AICORE_DEPLOYMENT_ID.`);
  return value;
}

function requireBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/u, '');
  if (!normalized) throw new Error('Provider operation base URL is required.');
  return normalized;
}

function assertNever(value: never): never {
  throw new Error(`Unknown provider operation builder: ${String(value)}`);
}
