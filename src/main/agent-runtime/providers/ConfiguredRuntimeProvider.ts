import type { LLMProviderConfig } from '@shared/types/llm';
import type { LlmProviderProtocol } from '@shared/types/settings';
import { EventStream } from '../core/EventStream';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  ProviderCapabilities,
  StreamOptions,
} from '../core/types';
import { settingsService } from '../../settings/SettingsService';
import { resolveEffectiveModel } from '../../settings/EffectiveModelResolver';
import { AnthropicProvider } from './AnthropicProvider';
import { GeminiProvider } from './GeminiProvider';
import { OllamaProvider } from './OllamaProvider';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider';

const CONFIGURED_PROVIDER_API = 'rdc-agent-configured-provider';

type ConfiguredProvider = LLMProviderConfig;

interface EncodedAgentModel {
  providerId: string;
  modelId: string;
}

export function encodeAgentModel(
  providerId: string,
  modelId: string,
  options?: { contextWindow?: number },
): Model {
  return {
    id: `${providerId}::${modelId}`,
    name: modelId,
    provider: providerId,
    api: CONFIGURED_PROVIDER_API,
    contextWindow: options?.contextWindow ?? 256_000,
    maxTokens: 4096,
    reasoning: false,
    vision: false,
  };
}

function decodeAgentModel(model: Model): EncodedAgentModel {
  const marker = '::';
  const idx = model.id.indexOf(marker);
  if (idx > 0) {
    return {
      providerId: model.id.slice(0, idx),
      modelId: model.id.slice(idx + marker.length),
    };
  }
  return {
    providerId: model.provider,
    modelId: model.id,
  };
}

function requireProviderProtocol(provider: ConfiguredProvider): LlmProviderProtocol {
  if (!provider.protocol) {
    throw new Error(`Provider ${provider.id} has no configured protocol.`);
  }
  return provider.protocol;
}

function normalizeLocalBaseUrl(baseUrl: string | undefined): string | undefined {
  return baseUrl?.replace(/\/v1\/?$/i, '');
}

function toRuntimeApi(protocol: LlmProviderProtocol): Model['api'] {
  switch (protocol) {
    case 'AnthropicMessages':
      return 'anthropic-messages';
    case 'GoogleGemini':
      return 'google-gemini';
    case 'OllamaOpenAICompatibleChatCompletions':
      return 'ollama';
    case 'OpenAIResponses':
      return 'openai-responses';
    case 'OpenAICompatibleChatCompletions':
    case 'OpenRouterChatCompletions':
      return 'openai-compatible';
    case 'AzureOpenAIChatCompletions':
      return 'azure-openai';
    case 'AwsBedrock':
      return 'bedrock';
    case 'GoogleVertexAI':
      return 'vertex';
    default:
      return protocol;
  }
}

function createProviderStrategy(
  provider: ConfiguredProvider,
  protocol: LlmProviderProtocol,
  capabilities: ProviderCapabilities,
): ProviderStrategy {
  switch (protocol) {
    case 'AnthropicMessages':
      return new AnthropicProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        headers: provider.id === 'kimi-coding-plan' ? { 'User-Agent': 'RDC-Agent' } : undefined,
        capabilities,
      });
    case 'GoogleGemini':
      return new GeminiProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        capabilities,
      });
    case 'OllamaOpenAICompatibleChatCompletions':
      return new OllamaProvider({
        apiKey: provider.apiKey || undefined,
        baseUrl: normalizeLocalBaseUrl(provider.baseUrl),
        capabilities,
      });
    case 'OpenRouterChatCompletions':
      return new OpenAICompatibleProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        headers: {
          'HTTP-Referer': 'https://rdcagent.local',
          'X-Title': 'RDC-Agent',
        },
        capabilities,
      });
    case 'OpenAICompatibleChatCompletions':
      return new OpenAICompatibleProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        capabilities,
      });
    case 'OpenAIResponses':
      return new OpenAIResponsesProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        accountId: provider.accountId,
        capabilities,
      });
    case 'AzureOpenAIChatCompletions':
    case 'AwsBedrock':
    case 'GoogleVertexAI':
    default:
      throw new Error(`Provider protocol "${protocol}" is not available in the agent runtime provider path.`);
  }
}

function missingProviderStream(error: Error): EventStream<AssistantMessageEvent, AssistantMessage> {
  const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
    (event) => event.type === 'done',
    (event) => (event as Extract<AssistantMessageEvent, { type: 'done' }>).message,
  );
  queueMicrotask(() => {
    stream.error(error);
  });
  return stream;
}

export class ConfiguredRuntimeProvider implements ProviderStrategy {
  readonly api = CONFIGURED_PROVIDER_API;

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      nativeToolCalling: true,
      structuredOutput: false,
      vision: false,
      reasoning: true,
      parallelToolCalls: true,
    };
  }

  stream(
    model: Model,
    context: Context,
    options: StreamOptions = {},
  ): EventStream<AssistantMessageEvent, AssistantMessage> {
    const decoded = decodeAgentModel(model);
    const requestPlan = options.requestPlan;
    if (requestPlan && requestPlan.providerId !== decoded.providerId) {
      return missingProviderStream(new Error(
        `RequestPlan provider ${requestPlan.providerId} does not match ${decoded.providerId}.`,
      ));
    }
    const llmConfig = settingsService.getLlmConfig();
    const provider = llmConfig.providers.find((entry: ConfiguredProvider) => entry.id === decoded.providerId);
    if (!provider) {
      return missingProviderStream(new Error(`No verified configured provider is available for ${decoded.providerId}.`));
    }
    if (!provider.models.includes(decoded.modelId)) {
      return missingProviderStream(new Error(`Model ${decoded.providerId}/${decoded.modelId} is not enabled for agent runtime.`));
    }

    let protocol: LlmProviderProtocol;
    try {
      protocol = requestPlan?.route.protocol ?? requireProviderProtocol(provider);
    } catch (error) {
      return missingProviderStream(error instanceof Error ? error : new Error(String(error)));
    }

    const plannedBaseUrl = requestPlan?.route.baseUrl ?? provider.baseUrl;
    const runtimeBaseUrl = protocol === 'OllamaOpenAICompatibleChatCompletions'
      ? normalizeLocalBaseUrl(plannedBaseUrl)
      : plannedBaseUrl;
    const effectiveModelId = requestPlan?.effectiveModelId ?? decoded.modelId;
    const effectiveModel = resolveEffectiveModel(decoded.providerId, decoded.modelId, settingsService.getAll());
    if (!effectiveModel) {
      return missingProviderStream(new Error(`No EffectiveModel is available for ${decoded.providerId}/${decoded.modelId}.`));
    }
    const toolCalling = effectiveModel.toolCalling.state !== 'unsupported';
    const capabilities: ProviderCapabilities = {
      streaming: true,
      nativeToolCalling: toolCalling,
      structuredOutput: effectiveModel.structuredOutput.state === 'supported',
      vision: effectiveModel.visionInput.state === 'supported',
      reasoning: effectiveModel.reasoning.kind !== 'none',
      parallelToolCalls: toolCalling,
    };
    const runtimeModel: Model = {
      ...model,
      id: effectiveModelId,
      name: effectiveModelId,
      provider: decoded.providerId,
      api: toRuntimeApi(protocol),
    };

    let strategy: ProviderStrategy;
    try {
      strategy = createProviderStrategy({ ...provider, baseUrl: runtimeBaseUrl }, protocol, capabilities);
    } catch (error) {
      return missingProviderStream(error instanceof Error ? error : new Error(String(error)));
    }
    return strategy.stream(runtimeModel, context, {
      ...options,
      apiKey: provider.apiKey,
      baseUrl: runtimeBaseUrl,
      requestPlan,
    });
  }
}

export const configuredRuntimeProvider = new ConfiguredRuntimeProvider();
