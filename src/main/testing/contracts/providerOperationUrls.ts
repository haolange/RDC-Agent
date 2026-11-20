import {
  getProviderAdapterImplementation,
  type ProviderAdapterId,
} from '@shared/provider-catalog/implementationRegistry';
import { buildAnthropicMessagesUrl } from '../../agent-runtime/providers/AnthropicProvider';
import { buildAzureResponsesUrl } from '../../agent-runtime/providers/AzureOpenAIResponsesProvider';
import { buildBedrockConverseStreamUrl } from '../../agent-runtime/providers/BedrockConverseProvider';
import { buildGeminiStreamUrl } from '../../agent-runtime/providers/GeminiProvider';
import { buildGoogleInteractionsUrl } from '../../agent-runtime/providers/GoogleInteractionsWire';
import { buildMistralChatCompletionsUrl } from '../../agent-runtime/providers/MistralProvider';
import { buildChatCompletionsUrl } from '../../agent-runtime/providers/OpenAICompatibleProvider';
import { buildOpenAIResponsesUrl } from '../../agent-runtime/providers/OpenAIResponsesProvider';

/**
 * The final operation URL an HTTP adapter's own builder sends to, for route contract tests. SDK
 * transports (GitLab Duo, SAP AI Core) build their URLs inside the SDK, so they have none here.
 */
export function adapterOperationUrl(adapterId: ProviderAdapterId, baseUrl: string, modelId: string): string | null {
  const implementation = getProviderAdapterImplementation(adapterId);
  if (!implementation) throw new Error(`Adapter ${adapterId} is not registered.`);
  if (implementation.transport === 'sdk') return null;
  const base = baseUrl.trim().replace(/\/+$/u, '');
  switch (implementation.operationBuilderId) {
    case 'anthropic-messages':
      return buildAnthropicMessagesUrl(base, modelId);
    case 'google-vertex-anthropic':
      return buildAnthropicMessagesUrl(base, modelId, 'vertex');
    case 'azure-openai-responses':
      return buildAzureResponsesUrl(base, '2024-10-21');
    case 'azure-chat-completions':
      return buildChatCompletionsUrl(base, { 'api-version': '2024-10-21' });
    case 'bedrock-converse-stream':
      return buildBedrockConverseStreamUrl(modelId, base);
    case 'google-interactions':
      return buildGoogleInteractionsUrl(base);
    case 'google-gemini':
      return buildGeminiStreamUrl(base, modelId, 'catalog-contract-key', 'ai-studio');
    case 'google-vertex-gemini':
      return buildGeminiStreamUrl(base, modelId, 'catalog-contract-token', 'vertex');
    case 'mistral-conversations':
      return buildMistralChatCompletionsUrl(base);
    case 'ollama-chat-completions':
    case 'openai-chat-completions':
    case 'openrouter-chat-completions':
      return buildChatCompletionsUrl(base);
    case 'openai-responses':
      return buildOpenAIResponsesUrl(base);
    default:
      throw new Error(`HTTP adapter ${adapterId} has no operation URL builder.`);
  }
}
