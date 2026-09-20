import type { AgentRouteCapability, ReasoningDelivery, ReasoningVisibility, ToolCallingMode } from '@shared/types/agentRuntime';
import type { ConversationDiagnosticSeverity } from '@shared/types/conversation';
import type { ProviderReasoningContract } from '@shared/types/rdcRuntime';
import type { LlmProviderEntry, LlmProviderId, LlmProviderProtocol } from '@shared/types/settings';
import type { EffectiveModel, RequestPlan } from '@shared/types/providerCapability';
import { createFailClosedProviderContracts, createNoneReasoningContract } from '@shared/provider-catalog/providerContracts';
import {
  hasImplementedStructuredToolAdapter,
  toolCallingEvidenceOf,
} from '@shared/utils/agentToolCapability';
import { classifyProviderError } from '../providers/internal/errorClassifier';
import { ProviderHttpError } from '../providers/internal/http';

export interface RouteCapabilityDiagnostic {
  code:
    | 'route_tool_calling_unknown'
    | 'route_tool_calling_unsupported'
    | 'route_tool_calling_disabled';
  severity: ConversationDiagnosticSeverity;
  message: string;
  surface: 'runtime-log' | 'work-process';
}

export interface StructuredToolCallingEvidenceGate {
  recorded: boolean;
  sawStructuredToolCall?: boolean;
}

const EXPLICIT_TOOL_REJECTION_PATTERNS = [
  /\btools?\b.{0,40}\b(?:not|n't|never)\b.{0,20}\bsupport/i,
  /\b(?:does not|doesn't|do not|don't)\b.{0,40}\b(?:support|accept|allow)\b.{0,40}\b(?:tools?|function calling|tool calls?|tool_choice)\b/i,
  /\bfunction calling\b.{0,40}\b(?:not|n't|disabled|unavailable|unsupported)\b/i,
  /\bunknown (?:parameter|field|argument|request argument)\b.{0,20}\btools?\b/i,
  /\bunrecognized (?:request argument|field|parameter)\b.{0,20}\btools?\b/i,
  /\bmodel\b.{0,40}\bcannot use tools\b/i,
  /\btool[_ ]choice\b.{0,40}\binvalid\b/i,
  /\b(?:client[- ]side )?tools?\b.{0,80}\brequire(?:s)?\b.{0,40}\b(?:beta|special access)\b/i,
];

const TRANSIENT_PROVIDER_ERROR_CODES = new Set([
  'rate_limit',
  'network',
  'timeout',
  'quota_exceeded',
  'aborted',
]);

export function resolveProviderReasoningContract(
  provider: LlmProviderEntry | undefined,
  model: EffectiveModel | null | undefined,
  requestPlan?: RequestPlan,
): ProviderReasoningContract {
  if (!provider || !model || model.controls.reasoning.kind === 'none') {
    return createNoneReasoningContract('effective-model');
  }
  const route = requestPlan?.route ?? model.route;
  return requestPlan?.contracts?.reasoning
    ?? route.contracts?.reasoning
    ?? createFailClosedProviderContracts(route.protocol).reasoning;
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

const disabledCapability = (providerId: LlmProviderId, modelId: string): AgentRouteCapability => ({
  providerId,
  modelId,
  toolCallingMode: 'disabled',
  reasoningVisibility: 'none',
  reasoningDelivery: 'none',
  reasoningContract: createNoneReasoningContract('route-disabled'),
  supportsStreaming: false,
  supportsToolResults: false,
  toolCallingEvidence: 'unknown',
  toolCallingUnverified: false,
  visionInputMode: 'disabled',
  structuredOutputMode: 'prompt-fallback',
});

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
  const activeContracts = requestPlan?.contracts
    ?? activeRoute.contracts
    ?? createFailClosedProviderContracts(activeRoute.protocol);
  const supportsStreaming = activeContracts.streaming.transport !== 'unknown';
  const toolCallingEvidence = toolCallingEvidenceOf(effectiveModel.toolCalling.state);
  let toolCallingMode: ToolCallingMode = 'text-only';
  const protocol: LlmProviderProtocol = activeRoute.protocol;
  const isNativeProtocol = hasImplementedStructuredToolAdapter(protocol);
  // Unknown and unsupported stay text-only. Manifest/protocol hints never authorize
  // native tool schemas until EffectiveModel states explicit support.
  if (toolCallingEvidence === 'supported' && isNativeProtocol) {
    toolCallingMode = 'native-structured';
  } else if (!supportsStreaming) {
    toolCallingMode = 'disabled';
  }
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
    toolCallingEvidence,
    toolCallingUnverified: false,
    visionInputMode: effectiveModel.visionInput.state === 'supported' ? 'native' : 'disabled',
    structuredOutputMode: effectiveModel.structuredOutput.state === 'supported' ? 'native' : 'prompt-fallback',
  };
}

export function describeRouteCapabilityDiagnostic(
  capability: AgentRouteCapability,
  availableToolCount: number,
): RouteCapabilityDiagnostic | null {
  if (availableToolCount <= 0 || capability.toolCallingMode === 'native-structured') return null;
  if (capability.toolCallingMode === 'disabled') {
    return {
      code: 'route_tool_calling_disabled',
      severity: 'error',
      message: `Current route ${capability.providerId}/${capability.modelId} is unavailable for structured agent tools. Tools were not registered and textual tool calls will not be executed.`,
      surface: 'work-process',
    };
  }
  if (capability.toolCallingEvidence === 'unknown') {
    return {
      code: 'route_tool_calling_unknown',
      severity: 'warning',
      message: `Current route ${capability.providerId}/${capability.modelId} has not confirmed native tool calling, so it is not an Agent-executable model. Tools were not registered and textual tool calls will not be executed.`,
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
  if (capability.toolCallingMode !== 'native-structured') return false;
  if (eventType === 'toolcall_end') {
    gate.sawStructuredToolCall = true;
    return false;
  }
  if (eventType !== 'tool_execution_end' || gate.recorded || !gate.sawStructuredToolCall) {
    return false;
  }
  gate.recorded = true;
  return true;
}

export function isExplicitStructuredToolCallingRejection(error: unknown): boolean {
  const status = error instanceof ProviderHttpError ? error.status : undefined;
  if (status === 429 || status === 402 || (status !== undefined && status >= 500)) {
    return false;
  }
  const classified = classifyProviderError(error, status);
  if (classified.retryable || TRANSIENT_PROVIDER_ERROR_CODES.has(classified.code)) {
    return false;
  }
  const bodyText = error instanceof ProviderHttpError ? error.bodyText ?? '' : '';
  const haystack = `${classified.message}\n${bodyText}`;
  return EXPLICIT_TOOL_REJECTION_PATTERNS.some((pattern) => pattern.test(haystack));
}
