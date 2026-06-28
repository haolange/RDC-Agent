import type {
  AgentRouteCapability,
  ReasoningDelivery,
  ReasoningVisibility,
  ToolCallingMode,
} from '@shared/types/agentRuntime';
import type {
  LlmProviderCapability,
  LlmProviderEntry,
  LlmProviderId,
  LlmProviderProtocol,
} from '@shared/types/settings';

const NATIVE_TOOL_PROTOCOLS = new Set<LlmProviderProtocol>([
  'AnthropicMessages',
  'OpenAIResponses',
  'OpenAICompatibleChatCompletions',
  'OpenRouterChatCompletions',
  'GoogleGemini',
  'OllamaOpenAICompatibleChatCompletions',
]);

const STREAMING_PROTOCOLS = new Set<LlmProviderProtocol>([
  'AnthropicMessages',
  'OpenAIResponses',
  'OpenAICompatibleChatCompletions',
  'OpenRouterChatCompletions',
  'GoogleGemini',
  'OllamaOpenAICompatibleChatCompletions',
]);

/** 各 wire protocol 默认 reasoning 交付语义（无 reasoning capability 时仍为 none）。 */
const PROTOCOL_REASONING_DELIVERY: Partial<Record<LlmProviderProtocol, ReasoningDelivery>> = {
  OpenAIResponses: 'summary-only',
  AnthropicMessages: 'summary-only',
  GoogleGemini: 'stream-full',
  OllamaOpenAICompatibleChatCompletions: 'stream-full',
  OpenAICompatibleChatCompletions: 'stream-full',
  OpenRouterChatCompletions: 'stream-full',
};

function readProviderProtocol(provider: LlmProviderEntry | undefined): LlmProviderProtocol | null {
  if (!provider) {
    return null;
  }
  return provider.protocol ?? null;
}

function hasCapability(
  provider: LlmProviderEntry | undefined,
  capability: LlmProviderCapability,
): boolean {
  return Boolean(provider?.capabilities?.includes(capability));
}

export function resolveReasoningDelivery(
  provider: LlmProviderEntry | undefined,
  protocol: LlmProviderProtocol | null,
): ReasoningDelivery {
  if (!provider || !protocol || !hasCapability(provider, 'reasoning')) {
    return 'none';
  }
  return PROTOCOL_REASONING_DELIVERY[protocol] ?? 'stream-full';
}

/** 将产品层 reasoningDelivery 映射为 provider StreamOptions 使用的 visibility。 */
export function reasoningDeliveryToStreamVisibility(delivery: ReasoningDelivery): ReasoningVisibility {
  if (delivery === 'summary-only') return 'summary-events';
  if (delivery === 'hidden') return 'hidden';
  return 'none';
}

function disabledCapability(providerId: LlmProviderId, modelId: string): AgentRouteCapability {
  return {
    providerId,
    modelId,
    toolCallingMode: 'disabled',
    reasoningVisibility: 'none',
    reasoningDelivery: 'none',
    supportsStreaming: false,
    supportsToolResults: false,
  };
}

export function resolveAgentRouteCapability(
  provider: LlmProviderEntry | undefined,
  modelId: string,
): AgentRouteCapability {
  const providerId = provider?.id ?? '';
  if (!provider || !provider.enabled || !provider.isConfigured || provider.status !== 'verified') {
    return disabledCapability(providerId, modelId);
  }

  if (!hasCapability(provider, 'chat')) {
    return disabledCapability(provider.id, modelId);
  }

  const protocol = readProviderProtocol(provider);
  if (!protocol) {
    return disabledCapability(provider.id, modelId);
  }

  const supportsStreaming = STREAMING_PROTOCOLS.has(protocol);
  const runtimeHasNativeTools = NATIVE_TOOL_PROTOCOLS.has(protocol);
  let toolCallingMode: ToolCallingMode = 'text-only';
  if (hasCapability(provider, 'tool-calling') && runtimeHasNativeTools) {
    toolCallingMode = 'native-structured';
  } else if (!supportsStreaming) {
    toolCallingMode = 'disabled';
  }

  const reasoningDelivery = resolveReasoningDelivery(provider, protocol);
  const reasoningVisibility = reasoningDeliveryToStreamVisibility(reasoningDelivery);

  return {
    providerId: provider.id,
    modelId,
    toolCallingMode,
    reasoningVisibility,
    reasoningDelivery,
    supportsStreaming,
    supportsToolResults: toolCallingMode === 'native-structured',
  };
}

export function describeRouteCapabilityDiagnostic(
  capability: AgentRouteCapability,
  availableToolCount: number,
): string | null {
  if (availableToolCount <= 0 || capability.toolCallingMode === 'native-structured') {
    return null;
  }

  if (capability.toolCallingMode === 'disabled') {
    return `Current route ${capability.providerId}/${capability.modelId} is not available for structured agent tools. Tools were not registered and no textual tool calls will be executed.`;
  }

  return `Current route ${capability.providerId}/${capability.modelId} is text-only for agent tools. Tools were not registered and textual tool calls will not be executed.`;
}
