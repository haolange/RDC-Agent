import type { AgentRouteCapability, ReasoningDelivery, ReasoningVisibility, ToolCallingMode } from '@shared/types/agentRuntime';
import type { ConversationDiagnosticSeverity } from '@shared/types/conversation';
import type { ProviderReasoningContract } from '@shared/types/rdxRuntime';
import type { LlmProviderEntry, LlmProviderId, LlmProviderProtocol } from '@shared/types/settings';
import type { EffectiveModel, RequestPlan } from '@shared/types/providerCapability';

const NATIVE_TOOL_PROTOCOLS = new Set<LlmProviderProtocol>(['AnthropicMessages', 'OpenAIResponses', 'OpenAICompatibleChatCompletions', 'OpenRouterChatCompletions', 'GoogleGemini', 'GitLabDuo', 'SapAiCoreOrchestration', 'SapAiCoreFoundationModels', 'OllamaOpenAICompatibleChatCompletions']);
const STREAMING_PROTOCOLS = new Set<LlmProviderProtocol>(['AnthropicMessages', 'OpenAIResponses', 'OpenAICompatibleChatCompletions', 'OpenRouterChatCompletions', 'GoogleGemini', 'GitLabDuo', 'SapAiCoreOrchestration', 'SapAiCoreFoundationModels', 'OllamaOpenAICompatibleChatCompletions']);

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

export function resolveProviderReasoningContract(
  provider: LlmProviderEntry | undefined,
  model: EffectiveModel | null | undefined,
  requestPlan?: RequestPlan,
): ProviderReasoningContract {
  if (!provider || !model || model.controls.reasoning.kind === 'none') {
    return { semantic: 'none', source: 'effective-model', displayLabel: 'None' };
  }
  const route = requestPlan?.route ?? model.route;
  return route.reasoningContract ?? {
    semantic: 'unknown',
    source: 'provider-catalog:unverified-route-semantics',
    displayLabel: 'Provider reasoning',
  };
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
  requestPlan?: RequestPlan,
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
  const activeRoute = requestPlan?.route ?? effectiveModel.route;
  const supportsStreaming = STREAMING_PROTOCOLS.has(activeRoute.protocol);
  let toolCallingMode: ToolCallingMode = 'text-only';
  const toolState = effectiveModel.toolCalling.state;
  if (toolState !== 'unsupported' && NATIVE_TOOL_PROTOCOLS.has(activeRoute.protocol)) toolCallingMode = 'native-structured';
  else if (!supportsStreaming) toolCallingMode = 'disabled';
  const reasoningContract = resolveProviderReasoningContract(provider, effectiveModel, requestPlan);
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
