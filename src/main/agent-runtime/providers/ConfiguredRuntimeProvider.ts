import type { LLMProviderConfig } from '@shared/types/llm';
import type { LlmProviderKind } from '@shared/types/settings';
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
import { AnthropicProvider } from './AnthropicProvider';
import { GeminiProvider } from './GeminiProvider';
import { OllamaProvider } from './OllamaProvider';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';

const CONFIGURED_PROVIDER_API = 'rdc-agent-configured-provider';

interface EncodedAgentModel {
  providerId: string;
  modelId: string;
}

export function encodeAgentModel(providerId: string, modelId: string): Model {
  return {
    id: `${providerId}::${modelId}`,
    name: modelId,
    provider: providerId,
    api: CONFIGURED_PROVIDER_API,
    contextWindow: 128000,
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

function toRuntimeApi(kind: LlmProviderKind): Model['api'] {
  switch (kind) {
    case 'anthropic':
      return 'anthropic-messages';
    case 'google-ai-studio':
      return 'google-gemini';
    case 'ollama':
      return 'ollama';
    case 'openai-compatible':
    case 'openrouter':
    case 'azure-openai':
      return 'openai-compatible';
    case 'bedrock':
    case 'vertex':
    default:
      return kind;
  }
}

function createProviderStrategy(provider: LLMProviderConfig): ProviderStrategy {
  switch (provider.kind) {
    case 'anthropic':
      return new AnthropicProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
      });
    case 'google-ai-studio':
      return new GeminiProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
      });
    case 'ollama':
      return new OllamaProvider({
        apiKey: provider.apiKey || undefined,
        baseUrl: provider.baseUrl,
      });
    case 'openrouter':
      return new OpenAICompatibleProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        headers: {
          'HTTP-Referer': 'https://rdcagent.local',
          'X-Title': 'RDC-Agent',
        },
      });
    case 'openai-compatible':
    case 'azure-openai':
      return new OpenAICompatibleProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
      });
    case 'bedrock':
    case 'vertex':
    default:
      throw new Error(`Provider kind "${provider.kind}" is not available in the agent runtime provider path.`);
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
      structuredOutput: true,
      vision: true,
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
    const llmConfig = settingsService.getLlmConfig();
    const provider = llmConfig.providers.find((entry) => entry.id === decoded.providerId);
    if (!provider) {
      return missingProviderStream(new Error(`No verified configured provider is available for ${decoded.providerId}.`));
    }
    if (!provider.models.includes(decoded.modelId)) {
      return missingProviderStream(new Error(`Model ${decoded.providerId}/${decoded.modelId} is not enabled for agent runtime.`));
    }

    const runtimeModel: Model = {
      ...model,
      id: decoded.modelId,
      name: decoded.modelId,
      provider: decoded.providerId,
      api: toRuntimeApi(provider.kind),
    };
    const strategy = createProviderStrategy(provider);
    return strategy.stream(runtimeModel, context, {
      ...options,
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
    });
  }
}

export const configuredRuntimeProvider = new ConfiguredRuntimeProvider();

