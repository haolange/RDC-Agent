import type { LLMProviderConfig } from '@shared/types/llm';
import type { LlmProviderProtocol } from '@shared/types/settings';
import { EventStream } from '../core/EventStream';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  StreamOptions,
} from '../core/types';
import { settingsService } from '../../settings/SettingsService';
import { providerAccountAuthService } from '../../settings/ProviderAccountAuthService';
import { resolveEffectiveModel } from '../../settings/EffectiveModelResolver';
import { CLAUDE_ACCOUNT_WIRE_HEADERS } from '../../settings/ClaudeWire';
import { COPILOT_WIRE_HEADERS } from '../../settings/CopilotWire';
import { AnthropicProvider } from './AnthropicProvider';
import { GeminiProvider } from './GeminiProvider';
import { OllamaProvider } from './OllamaProvider';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider';
import { streamWithUnauthorizedRefresh } from './AccountStreamRetry';

const CONFIGURED_PROVIDER_API = 'rdc-agent-configured-provider';

type ConfiguredProvider = LLMProviderConfig;

interface EncodedAgentModel {
  providerId: string;
  modelId: string;
}

export function encodeAgentModel(
  providerId: string,
  modelId: string,
  options: { contextWindow: number },
): Model {
  return {
    id: `${providerId}::${modelId}`,
    name: modelId,
    provider: providerId,
    api: CONFIGURED_PROVIDER_API,
    contextWindow: options.contextWindow,
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
): ProviderStrategy {
  const accountHeaders = provider.id === 'github-copilot'
    ? COPILOT_WIRE_HEADERS
    : provider.id === 'claude-account'
      ? CLAUDE_ACCOUNT_WIRE_HEADERS
      : undefined;
  switch (protocol) {
    case 'AnthropicMessages':
      return new AnthropicProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        headers: provider.id === 'kimi-coding-plan'
          ? { 'User-Agent': 'RDC-Agent' }
          : accountHeaders,
      });
    case 'GoogleGemini':
      return new GeminiProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
      });
    case 'OllamaOpenAICompatibleChatCompletions':
      return new OllamaProvider({
        apiKey: provider.apiKey || undefined,
        baseUrl: normalizeLocalBaseUrl(provider.baseUrl),
      });
    case 'OpenRouterChatCompletions':
      return new OpenAICompatibleProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        headers: {
          'HTTP-Referer': 'https://rdcagent.local',
          'X-Title': 'RDC-Agent',
        },
      });
    case 'OpenAICompatibleChatCompletions':
      return new OpenAICompatibleProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        headers: accountHeaders,
      });
    case 'OpenAIResponses':
      return new OpenAIResponsesProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        accountId: provider.accountId,
        headers: accountHeaders,
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

  stream(
    model: Model,
    context: Context,
    options: StreamOptions,
  ): EventStream<AssistantMessageEvent, AssistantMessage> {
    const decoded = decodeAgentModel(model);
    const requestPlan = options.requestPlan;
    if (requestPlan.providerId !== decoded.providerId) {
      return missingProviderStream(new Error(
        `RequestPlan provider ${requestPlan.providerId} does not match ${decoded.providerId}.`,
      ));
    }
    const llmConfig = settingsService.getLlmConfig();
    const provider = llmConfig.providers.find((entry: ConfiguredProvider) => entry.id === decoded.providerId);
    if (!provider) {
      return missingProviderStream(new Error(`No verified configured provider is available for ${decoded.providerId}.`));
    }
    const protocol = requestPlan.route.protocol;
    const effectiveModelId = requestPlan.effectiveModelId;
    const effectiveModel = resolveEffectiveModel(decoded.providerId, decoded.modelId, settingsService.getAll());
    if (!effectiveModel) {
      return missingProviderStream(new Error(`No EffectiveModel is available for ${decoded.providerId}/${decoded.modelId}.`));
    }
    const runtimeModel: Model = {
      ...model,
      id: effectiveModelId,
      name: effectiveModelId,
      provider: decoded.providerId,
      api: toRuntimeApi(protocol),
    };

    const createAttempt = (): EventStream<AssistantMessageEvent, AssistantMessage> => {
      const latest = settingsService.getLlmConfig().providers.find((entry) => entry.id === decoded.providerId);
      if (!latest) return missingProviderStream(new Error(`Provider ${decoded.providerId} became unavailable.`));
      const latestBaseUrl = protocol === 'OllamaOpenAICompatibleChatCompletions'
        ? normalizeLocalBaseUrl(requestPlan.route.baseUrl ?? latest.baseUrl)
        : requestPlan.route.baseUrl ?? latest.baseUrl;
      try {
        const strategy = createProviderStrategy({ ...latest, baseUrl: latestBaseUrl }, protocol);
        return strategy.stream(runtimeModel, context, {
          ...options,
          apiKey: latest.apiKey,
          baseUrl: latestBaseUrl,
          requestPlan,
        });
      } catch (error) {
        return missingProviderStream(error instanceof Error ? error : new Error(String(error)));
      }
    };

    if (provider.authMode !== 'account') return createAttempt();
    return streamWithUnauthorizedRefresh({
      createAttempt,
      refresh: () => providerAccountAuthService.forceRefreshRuntimeCredentials(decoded.providerId),
    });
  }
}

export const configuredRuntimeProvider = new ConfiguredRuntimeProvider();
