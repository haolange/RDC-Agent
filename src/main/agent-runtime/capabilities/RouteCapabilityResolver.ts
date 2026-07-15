import type { AgentRouteCapability, ReasoningDelivery, ReasoningVisibility, ToolCallingMode } from '@shared/types/agentRuntime';
import type { ConversationDiagnosticSeverity } from '@shared/types/conversation';
import type { ProviderReasoningContract } from '@shared/types/rdxRuntime';
import type { LlmProviderEntry, LlmProviderId, LlmProviderProtocol } from '@shared/types/settings';
import type { EffectiveModel } from '@shared/types/providerCapability';

const NATIVE_TOOL_PROTOCOLS = new Set<LlmProviderProtocol>(['AnthropicMessages', 'OpenAIResponses', 'OpenAICompatibleChatCompletions', 'OpenRouterChatCompletions', 'GoogleGemini', 'GitLabDuo', 'SapAiCoreOrchestration', 'SapAiCoreFoundationModels', 'OllamaOpenAICompatibleChatCompletions']);
const STREAMING_PROTOCOLS = new Set<LlmProviderProtocol>(['AnthropicMessages', 'OpenAIResponses', 'OpenAICompatibleChatCompletions', 'OpenRouterChatCompletions', 'GoogleGemini', 'GitLabDuo', 'SapAiCoreOrchestration', 'SapAiCoreFoundationModels', 'OllamaOpenAICompatibleChatCompletions']);
const OPENAI_NATIVE_IDS = new Set(['openai', 'openai-eu', 'openai-us', 'chatgpt-account']);
const ANTHROPIC_NATIVE_IDS = new Set(['anthropic', 'claude-account']);

export interface RouteCapabilityDiagnostic {
  code:
    | 'route_tool_calling_unverified'
    | 'route_tool_calling_unsupported'
    | 'route_tool_calling_disabled';
  severity: ConversationDiagnosticSeverity;
  message: string;
  surface: 'runtime-log' | 'work-process';
}

export interface StructuredToolCallingEvidenceGate {
  recorded: boolean;
}

/** App-managed vendors with documented readable CoT (not Anthropic summary). */
const RAW_REASONING_PROVIDER_IDS = new Set([
  'deepseek',
  'moonshot',
  'kimi-coding-plan',
  'glm-cn',
  'glm-global',
  'glm-cn-coding-plan',
  'glm-global-coding-plan',
  'minimax-cn',
  'minimax-global',
  'minimax-cn-coding-plan',
  'minimax-global-coding-plan',
  'xiaomi-mimo',
  'xiaomi-mimo-token-plan',
  'friendli',
]);

const RAW_REASONING_EVIDENCE: Record<string, string> = {
  deepseek: 'https://api-docs.deepseek.com/guides/thinking_mode',
  moonshot: 'https://platform.moonshot.cn/docs/',
  'kimi-coding-plan': 'https://www.kimi.com/code/docs/en/',
  'glm-cn': 'https://docs.bigmodel.cn/',
  'glm-global': 'https://docs.z.ai/',
  'glm-cn-coding-plan': 'https://docs.bigmodel.cn/',
  'glm-global-coding-plan': 'https://docs.z.ai/devpack/quick-start',
  'minimax-cn': 'https://platform.minimaxi.com/docs/api-reference/text-openai-api',
  'minimax-global': 'https://platform.minimax.io/docs/guides/text-generation',
  'minimax-cn-coding-plan': 'https://platform.minimaxi.com/docs/api-reference/text-openai-api',
  'minimax-global-coding-plan': 'https://platform.minimax.io/docs/token-plan/other-tools',
  'xiaomi-mimo': 'https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/deep-thinking',
  'xiaomi-mimo-token-plan': 'https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/deep-thinking',
  friendli: 'https://friendli.ai/docs/guides/serverless_endpoints/reasoning',
};

export function resolveProviderReasoningContract(
  provider: LlmProviderEntry | undefined,
  model: EffectiveModel | null | undefined,
): ProviderReasoningContract {
  if (!provider || !model || model.controls.reasoning.kind === 'none') {
    return { semantic: 'none', source: 'effective-model', displayLabel: 'None' };
  }
  if (model.route.protocol === 'OpenAIResponses' && OPENAI_NATIVE_IDS.has(provider.id)) {
    return { semantic: 'summary', source: 'openai-responses-summary', evidence: 'https://platform.openai.com/docs/api-reference/responses-streaming/response/reasoning_summary_part/added', displayLabel: 'Reasoning summary' };
  }
  if (model.route.protocol === 'AnthropicMessages' && ANTHROPIC_NATIVE_IDS.has(provider.id)) {
    return { semantic: 'summary', source: 'anthropic-thinking-display-summarized', evidence: 'https://platform.claude.com/docs/en/build-with-claude/extended-thinking', displayLabel: 'Reasoning summary' };
  }
  // Compatible Anthropic routes must never inherit native Anthropic summary semantics.
  if (RAW_REASONING_PROVIDER_IDS.has(provider.id)) {
    return {
      semantic: 'raw',
      source: `${provider.id}-documented-raw-reasoning`,
      evidence: RAW_REASONING_EVIDENCE[provider.id],
      displayLabel: 'Raw reasoning',
    };
  }
  return { semantic: 'unknown', source: `${provider.id}/${model.modelId}:unverified-provider-semantics`, displayLabel: 'Provider reasoning' };
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

const disabledCapability = (providerId: LlmProviderId, modelId: string): AgentRouteCapability => ({ providerId, modelId, toolCallingMode: 'disabled', reasoningVisibility: 'none', reasoningDelivery: 'none', reasoningContract: { semantic: 'none', source: 'route-disabled', displayLabel: 'None' }, supportsStreaming: false, supportsToolResults: false, toolCallingUnverified: false, visionInputMode: 'disabled', structuredOutputMode: 'prompt-fallback' });

export function resolveAgentRouteCapability(
  provider: LlmProviderEntry | undefined,
  modelId: string,
  effectiveModel?: EffectiveModel | null,
): AgentRouteCapability {
  const providerId = provider?.id ?? '';
  if (
    !provider
    || !provider.enabled
    || !provider.isConfigured
    || provider.status !== 'verified'
    || !effectiveModel?.enabled
    || effectiveModel.availability === 'unavailable'
  ) return disabledCapability(providerId, modelId);
  const supportsStreaming = STREAMING_PROTOCOLS.has(effectiveModel.route.protocol);
  let toolCallingMode: ToolCallingMode = 'text-only';
  const toolState = effectiveModel.toolCalling.state;
  if (toolState !== 'unsupported' && NATIVE_TOOL_PROTOCOLS.has(effectiveModel.route.protocol)) toolCallingMode = 'native-structured';
  else if (!supportsStreaming) toolCallingMode = 'disabled';
  const reasoningContract = resolveProviderReasoningContract(provider, effectiveModel);
  const reasoningDelivery = reasoningContractToDelivery(reasoningContract);
  return {
    providerId: provider.id,
    modelId,
    toolCallingMode,
    reasoningVisibility: reasoningContractToStreamVisibility(reasoningContract),
    reasoningDelivery,
    reasoningContract,
    supportsStreaming,
    supportsToolResults: toolCallingMode === 'native-structured',
    toolCallingUnverified: toolCallingMode === 'native-structured' && toolState === 'unknown',
    visionInputMode: effectiveModel.visionInput.state === 'supported' ? 'native' : 'disabled',
    structuredOutputMode: effectiveModel.structuredOutput.state === 'supported' ? 'native' : 'prompt-fallback',
  };
}

export function describeRouteCapabilityDiagnostic(
  capability: AgentRouteCapability,
  availableToolCount: number,
): RouteCapabilityDiagnostic | null {
  if (availableToolCount > 0 && capability.toolCallingUnverified) {
    return {
      code: 'route_tool_calling_unverified',
      severity: 'info',
      message: `Current route ${capability.providerId}/${capability.modelId} has unverified native tool calling support. Tools remain enabled until structured runtime evidence confirms support.`,
      surface: 'runtime-log',
    };
  }
  if (availableToolCount <= 0 || capability.toolCallingMode === 'native-structured') return null;
  if (capability.toolCallingMode === 'disabled') {
    return {
      code: 'route_tool_calling_disabled',
      severity: 'error',
      message: `Current route ${capability.providerId}/${capability.modelId} is unavailable for structured agent tools. Tools were not registered and textual tool calls will not be executed.`,
      surface: 'work-process',
    };
  }
  return {
    code: 'route_tool_calling_unsupported',
    severity: 'warning',
    message: `Current route ${capability.providerId}/${capability.modelId} explicitly does not support structured agent tools. Tools were not registered and textual tool calls will not be executed.`,
    surface: 'work-process',
  };
}

export function claimStructuredToolCallingEvidence(
  eventType: string,
  capability: AgentRouteCapability,
  gate: StructuredToolCallingEvidenceGate,
): boolean {
  if (eventType !== 'toolcall_end' || !capability.toolCallingUnverified || gate.recorded) {
    return false;
  }
  gate.recorded = true;
  return true;
}
