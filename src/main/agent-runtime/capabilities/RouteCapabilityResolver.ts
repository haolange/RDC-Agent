import type { AgentRouteCapability, ReasoningDelivery, ReasoningVisibility, ToolCallingMode } from '@shared/types/agentRuntime';
import type { ProviderReasoningContract } from '@shared/types/rdxRuntime';
import type { LlmProviderCapability, LlmProviderEntry, LlmProviderId, LlmProviderProtocol } from '@shared/types/settings';

const NATIVE_TOOL_PROTOCOLS = new Set<LlmProviderProtocol>(['AnthropicMessages', 'OpenAIResponses', 'OpenAICompatibleChatCompletions', 'OpenRouterChatCompletions', 'GoogleGemini', 'OllamaOpenAICompatibleChatCompletions']);
const STREAMING_PROTOCOLS = new Set<LlmProviderProtocol>(['AnthropicMessages', 'OpenAIResponses', 'OpenAICompatibleChatCompletions', 'OpenRouterChatCompletions', 'GoogleGemini', 'OllamaOpenAICompatibleChatCompletions']);
const OPENAI_NATIVE_IDS = new Set(['openai', 'openai-eu', 'openai-us', 'chatgpt-account']);
const ANTHROPIC_NATIVE_IDS = new Set(['anthropic', 'claude-account']);

const hasCapability = (provider: LlmProviderEntry | undefined, capability: LlmProviderCapability): boolean => Boolean(provider?.capabilities?.includes(capability));

export function resolveProviderReasoningContract(provider: LlmProviderEntry | undefined, modelId: string): ProviderReasoningContract {
  if (!provider || !hasCapability(provider, 'reasoning')) return { semantic: 'none', source: 'provider-capability', displayLabel: 'None' };
  if (provider.protocol === 'OpenAIResponses' && OPENAI_NATIVE_IDS.has(provider.id)) {
    return { semantic: 'summary', source: 'openai-responses-summary', evidence: 'https://platform.openai.com/docs/api-reference/responses-streaming/response/reasoning_summary_part/added', displayLabel: 'Reasoning summary' };
  }
  if (provider.protocol === 'AnthropicMessages' && ANTHROPIC_NATIVE_IDS.has(provider.id)) {
    return { semantic: 'summary', source: 'anthropic-thinking-display-summarized', evidence: 'https://platform.claude.com/docs/en/build-with-claude/extended-thinking', displayLabel: 'Reasoning summary' };
  }
  if (provider.id === 'deepseek' && provider.protocol === 'OpenAICompatibleChatCompletions') {
    return { semantic: 'raw', source: 'deepseek-reasoning-content', evidence: 'https://api-docs.deepseek.com/guides/thinking_mode', displayLabel: 'Raw reasoning' };
  }
  return { semantic: 'unknown', source: `${provider.id}/${modelId}:unverified-provider-semantics`, displayLabel: 'Provider reasoning' };
}

export function reasoningContractToDelivery(contract: ProviderReasoningContract): ReasoningDelivery {
  if (contract.semantic === 'summary') return 'summary-only';
  if (contract.semantic === 'opaque') return 'hidden';
  if (contract.semantic === 'raw' || contract.semantic === 'unknown') return 'stream-full';
  return 'none';
}

export function reasoningDeliveryToStreamVisibility(delivery: ReasoningDelivery): ReasoningVisibility {
  if (delivery === 'summary-only') return 'summary-events';
  if (delivery === 'hidden') return 'hidden';
  return 'none';
}

export function reasoningContractToStreamVisibility(contract: ProviderReasoningContract): ReasoningVisibility {
  if (contract.semantic === 'summary') return 'summary-events';
  if (contract.semantic === 'unknown') return 'unknown-events';
  if (contract.semantic === 'opaque') return 'hidden';
  return 'none';
}

const disabledCapability = (providerId: LlmProviderId, modelId: string): AgentRouteCapability => ({ providerId, modelId, toolCallingMode: 'disabled', reasoningVisibility: 'none', reasoningDelivery: 'none', reasoningContract: { semantic: 'none', source: 'route-disabled', displayLabel: 'None' }, supportsStreaming: false, supportsToolResults: false });

export function resolveAgentRouteCapability(provider: LlmProviderEntry | undefined, modelId: string): AgentRouteCapability {
  const providerId = provider?.id ?? '';
  if (!provider || !provider.enabled || !provider.isConfigured || provider.status !== 'verified' || !hasCapability(provider, 'chat') || !provider.protocol) return disabledCapability(providerId, modelId);
  const supportsStreaming = STREAMING_PROTOCOLS.has(provider.protocol);
  let toolCallingMode: ToolCallingMode = 'text-only';
  if (hasCapability(provider, 'tool-calling') && NATIVE_TOOL_PROTOCOLS.has(provider.protocol)) toolCallingMode = 'native-structured';
  else if (!supportsStreaming) toolCallingMode = 'disabled';
  const reasoningContract = resolveProviderReasoningContract(provider, modelId);
  const reasoningDelivery = reasoningContractToDelivery(reasoningContract);
  return { providerId: provider.id, modelId, toolCallingMode, reasoningVisibility: reasoningContractToStreamVisibility(reasoningContract), reasoningDelivery, reasoningContract, supportsStreaming, supportsToolResults: toolCallingMode === 'native-structured' };
}

export function describeRouteCapabilityDiagnostic(capability: AgentRouteCapability, availableToolCount: number): string | null {
  if (availableToolCount <= 0 || capability.toolCallingMode === 'native-structured') return null;
  if (capability.toolCallingMode === 'disabled') return `Current route ${capability.providerId}/${capability.modelId} is not available for structured agent tools. Tools were not registered and no textual tool calls will be executed.`;
  return `Current route ${capability.providerId}/${capability.modelId} is text-only for agent tools. Tools were not registered and textual tool calls will not be executed.`;
}
