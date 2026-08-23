import {
  PROVIDER_ADAPTER_IMPLEMENTATIONS,
  PROVIDER_ADAPTER_IDS,
} from '../provider-catalog/implementationRegistry';
import type { CapabilityState, EffectiveAvailability } from '../types/providerCapability';
import type { LlmProviderProtocol } from '../types/settings';
import type { EffectiveModelPickerCandidate } from './effectiveModelPicker';
import { isEffectiveModelPickerSelectable } from './effectiveModelPicker';

export type AgentToolCallingEvidence = CapabilityState['state'];

export type AgentToolEligibility =
  | 'executable'
  | 'unknown'
  | 'unsupported'
  | 'unavailable'
  | 'disabled'
  | 'internal'
  | 'no-adapter';

export interface AgentToolEligibilityCandidate extends EffectiveModelPickerCandidate {
  toolCalling?: Pick<CapabilityState, 'state'> | null;
  route?: { protocol?: string | LlmProviderProtocol } | null;
}

export function hasImplementedStructuredToolAdapter(protocol: string | undefined): boolean {
  if (!protocol) return false;
  return PROVIDER_ADAPTER_IDS.some((adapterId) => (
    (PROVIDER_ADAPTER_IMPLEMENTATIONS[adapterId].protocols as readonly string[]).includes(protocol)
  ));
}

export function toolCallingEvidenceOf(
  state: CapabilityState['state'] | undefined,
): AgentToolCallingEvidence {
  if (state === 'supported' || state === 'unsupported') return state;
  return 'unknown';
}

export function classifyAgentToolEligibility(
  model: AgentToolEligibilityCandidate,
): AgentToolEligibility {
  if (model.enabled === false) return 'disabled';
  if (model.availability === 'unavailable') return 'unavailable';
  if (model.availability !== 'available') return 'unknown';
  if (model.selection?.pickerVisibility === 'internal') return 'internal';
  if (!hasImplementedStructuredToolAdapter(model.route?.protocol)) return 'no-adapter';
  if (model.toolCalling?.state === 'unsupported') return 'unsupported';
  if (model.toolCalling?.state !== 'supported') return 'unknown';
  return 'executable';
}

/**
 * Agent / Composer / session-override executable gate.
 * Settings catalog visibility stays on `isEffectiveModelPickerSelectable`.
 */
export function isAgentToolExecutableModel(model: AgentToolEligibilityCandidate): boolean {
  return isEffectiveModelPickerSelectable(model)
    && classifyAgentToolEligibility(model) === 'executable';
}

export function isCatalogVisibleAgentModel(model: EffectiveModelPickerCandidate): boolean {
  return isEffectiveModelPickerSelectable(model);
}

export function agentToolEligibilityAvailability(
  eligibility: AgentToolEligibility,
): EffectiveAvailability | 'internal' {
  if (eligibility === 'unavailable') return 'unavailable';
  if (eligibility === 'internal') return 'internal';
  return eligibility === 'executable' ? 'available' : 'unknown';
}

export function describeAgentToolIneligibility(
  eligibility: Exclude<AgentToolEligibility, 'executable'>,
  providerId: string,
  modelId: string,
): { technicalCode: string; userMessage: string; technicalMessage: string } {
  const route = `${providerId}/${modelId}`;
  if (eligibility === 'unsupported') {
    return {
      technicalCode: 'MODEL_TOOLS_UNSUPPORTED',
      userMessage: `当前模型 ${route} 明确不支持 native structured tools，因此不能作为 Agent 可执行模型。请改选同一 provider 下已验证支持工具的模型。`,
      technicalMessage: `MODEL_TOOLS_UNSUPPORTED: ${route} toolCalling.state is unsupported.`,
    };
  }
  if (eligibility === 'unknown') {
    return {
      technicalCode: 'MODEL_TOOLS_UNVERIFIED',
      userMessage: `当前模型 ${route} 的 provider route 尚未证实 native tool calling，因此未纳入 Agent 可执行模型。请改选同一 provider 下已验证支持工具的模型。`,
      technicalMessage: `MODEL_TOOLS_UNVERIFIED: ${route} toolCalling.state is unknown.`,
    };
  }
  if (eligibility === 'no-adapter') {
    return {
      technicalCode: 'MODEL_TOOLS_ADAPTER_MISSING',
      userMessage: `当前模型 ${route} 没有已实现的 native structured-tool adapter，因此不能作为 Agent 可执行模型。`,
      technicalMessage: `MODEL_TOOLS_ADAPTER_MISSING: ${route} has no implemented structured-tool adapter.`,
    };
  }
  if (eligibility === 'disabled') {
    return {
      technicalCode: 'MODEL_DISABLED',
      userMessage: `当前模型 ${route} 已禁用，因此不能作为 Agent 可执行模型。`,
      technicalMessage: `MODEL_DISABLED: ${route} is disabled.`,
    };
  }
  if (eligibility === 'internal') {
    return {
      technicalCode: 'MODEL_INTERNAL',
      userMessage: `当前模型 ${route} 是内部执行目标，不能作为 Agent 选择项。`,
      technicalMessage: `MODEL_INTERNAL: ${route} pickerVisibility is internal.`,
    };
  }
  return {
    technicalCode: 'MODEL_UNAVAILABLE',
    userMessage: `当前模型 ${route} 不可用，因此不能作为 Agent 可执行模型。`,
    technicalMessage: `MODEL_UNAVAILABLE: ${route} is unavailable.`,
  };
}
