import type { LLMProviderConfig } from '@shared/types/llm';
import type { LlmProviderProtocol } from '@shared/types/settings';
import {
  providerAdapterSupportsProtocol,
  type ProviderAdapterId,
} from '@shared/provider-catalog/implementationRegistry';
import { EventStream } from '../core/EventStream';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  StreamOptions,
} from '../core/types';
import { providerAccountAuthService } from '../../settings/ProviderAccountAuthService';
import { CLAUDE_ACCOUNT_WIRE_HEADERS } from '../../settings/ClaudeWire';
import { COPILOT_WIRE_HEADERS } from '../../settings/CopilotWire';
import { AnthropicProvider } from './AnthropicProvider';
import { GeminiProvider } from './GeminiProvider';
import { OllamaProvider } from './OllamaProvider';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider';
import { streamWithUnauthorizedRefresh } from './AccountStreamRetry';
import {
  createAwsBedrockRequestAuthorizerFromCredentials,
  type ProviderRequestAuthorizer,
} from '../../settings/AwsBedrockCredentials';
import { providerRuntimeCredentialService } from '../../settings/ProviderRuntimeCredentialService';
import { createGitLabDuoProvider, createSapAiCoreProvider } from './DedicatedAiSdkProviders';

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
    case 'GoogleVertexGemini':
      return 'google-vertex-gemini';
    case 'GoogleVertexAnthropic':
      return 'google-vertex-anthropic';
    case 'GitLabDuo':
      return 'gitlab-duo';
    case 'SapAiCoreOrchestration':
      return 'sap-ai-core-orchestration';
    case 'SapAiCoreFoundationModels':
      return 'sap-ai-core-foundation-models';
    case 'OllamaOpenAICompatibleChatCompletions':
      return 'ollama';
    case 'OpenAIResponses':
      return 'openai-responses';
    case 'OpenAICompatibleChatCompletions':
    case 'OpenRouterChatCompletions':
      return 'openai-compatible';
    case 'AzureOpenAIChatCompletions':
      return 'azure-openai';
    default:
      return protocol;
  }
}

function createProviderStrategy(
  provider: ConfiguredProvider,
  adapterId: ProviderAdapterId,
  protocol: LlmProviderProtocol,
  requestAuthorizer?: ProviderRequestAuthorizer,
  connectionValues?: Readonly<Record<string, string>>,
  connectionHeaders: Readonly<Record<string, string>> = {},
): ProviderStrategy {
  const accountHeaders = provider.id === 'github-copilot'
    ? COPILOT_WIRE_HEADERS
    : provider.id === 'claude-account'
      ? CLAUDE_ACCOUNT_WIRE_HEADERS
      : undefined;
  if (!providerAdapterSupportsProtocol(adapterId, protocol)) {
    throw new Error(`Provider adapter ${adapterId} does not implement ${protocol}.`);
  }
  switch (adapterId) {
    case 'anthropic-messages':
      return new AnthropicProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        headers: provider.id === 'kimi-coding-plan'
          ? { ...connectionHeaders, 'User-Agent': 'RDC-Agent' }
          : { ...connectionHeaders, ...accountHeaders },
      });
    case 'google-gemini':
      return new GeminiProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        headers: connectionHeaders,
      });
    case 'google-vertex-gemini':
      return new GeminiProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        surface: 'vertex',
        headers: connectionHeaders,
      });
    case 'google-vertex-anthropic':
      return new AnthropicProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        surface: 'vertex',
        headers: connectionHeaders,
      });
    case 'ollama-openai-compatible':
      return new OllamaProvider({
        apiKey: provider.apiKey || undefined,
        baseUrl: normalizeLocalBaseUrl(provider.baseUrl),
        headers: connectionHeaders,
      });
    case 'openrouter-chat':
      return new OpenAICompatibleProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        headers: {
          ...connectionHeaders,
          'HTTP-Referer': 'https://rdcagent.local',
          'X-Title': 'RDC-Agent',
        },
      });
    case 'openai-compatible':
      return new OpenAICompatibleProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        headers: { ...connectionHeaders, ...accountHeaders },
        ...(requestAuthorizer ? { authorization: 'none', requestAuthorizer } : {}),
      });
    case 'azure-openai-chat':
      return new OpenAICompatibleProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        authorization: 'none',
        headers: { ...connectionHeaders, 'api-key': provider.apiKey },
        query: { 'api-version': '2024-10-21' },
      });
    case 'openai-responses':
      return new OpenAIResponsesProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        accountId: provider.accountId,
        headers: { ...connectionHeaders, ...accountHeaders },
        ...(requestAuthorizer ? { requestAuthorizer } : {}),
      });
    case 'gitlab-duo':
      return createGitLabDuoProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        connectionValues,
      });
    case 'sap-ai-core-orchestration':
    case 'sap-ai-core-foundation-models':
      return createSapAiCoreProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        connectionValues,
      }, protocol as Extract<LlmProviderProtocol, 'SapAiCoreOrchestration' | 'SapAiCoreFoundationModels'>);
    default:
      throw new Error(`Provider adapter "${adapterId}" is not available in the agent runtime provider path.`);
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
    let credentialLease: ReturnType<typeof providerRuntimeCredentialService.get>;
    try {
      credentialLease = providerRuntimeCredentialService.get(options.credentialHandle, decoded.providerId);
    } catch (error) {
      return missingProviderStream(error instanceof Error ? error : new Error(String(error)));
    }
    if (!credentialLease || !options.credentialHandle) {
      return missingProviderStream(new Error(
        `A frozen runtime credential handle is required for ${decoded.providerId}.`,
      ));
    }
    const provider = credentialLease.provider;
    const protocol = requestPlan.route.protocol;
    const effectiveModelId = requestPlan.effectiveModelId;
    const runtimeModel: Model = {
      ...model,
      id: effectiveModelId,
      name: effectiveModelId,
      provider: decoded.providerId,
      api: toRuntimeApi(protocol),
    };

    const createAttempt = (): EventStream<AssistantMessageEvent, AssistantMessage> => {
      let activeLease;
      try {
        activeLease = providerRuntimeCredentialService.get(options.credentialHandle, decoded.providerId);
      } catch (error) {
        return missingProviderStream(error instanceof Error ? error : new Error(String(error)));
      }
      if (!activeLease) return missingProviderStream(new Error(`Provider ${decoded.providerId} credential lease was released.`));
      const latest = activeLease.provider;
      const latestBaseUrl = protocol === 'OllamaOpenAICompatibleChatCompletions'
        ? normalizeLocalBaseUrl(requestPlan.route.baseUrl ?? latest.baseUrl)
        : requestPlan.route.baseUrl ?? latest.baseUrl;
      const connectionValues = activeLease.connectionValues;
      const createWithApiKey = (
        apiKey: string,
        requestAuthorizer?: ProviderRequestAuthorizer,
      ): EventStream<AssistantMessageEvent, AssistantMessage> => {
        const strategy = createProviderStrategy(
          { ...latest, apiKey, baseUrl: latestBaseUrl },
          requestPlan.adapterId,
          protocol,
          requestAuthorizer,
          connectionValues,
          activeLease.connectionHeaders,
        );
        return strategy.stream(runtimeModel, context, {
          ...options,
          apiKey,
          baseUrl: latestBaseUrl,
          requestPlan,
        });
      };
      try {
        if (decoded.providerId === 'amazon-bedrock' && !latest.apiKey) {
          if (!activeLease.awsBedrockCredentials) {
            return missingProviderStream(new Error('Frozen AWS Bedrock credentials are unavailable.'));
          }
          const requestAuthorizer = createAwsBedrockRequestAuthorizerFromCredentials(activeLease.awsBedrockCredentials);
          return createWithApiKey('', requestAuthorizer);
        }
        return createWithApiKey(latest.apiKey);
      } catch (error) {
        return missingProviderStream(error instanceof Error ? error : new Error(String(error)));
      }
    };

    if (provider.authMode !== 'account') return createAttempt();
    return streamWithUnauthorizedRefresh({
      createAttempt,
      refresh: async () => {
        await providerAccountAuthService.forceRefreshRuntimeCredentials(decoded.providerId);
        await providerRuntimeCredentialService.refresh(options.credentialHandle!, decoded.providerId);
      },
    });
  }
}

export const configuredRuntimeProvider = new ConfiguredRuntimeProvider();
