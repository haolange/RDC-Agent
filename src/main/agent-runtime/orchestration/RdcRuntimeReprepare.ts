import type { PromptPlan } from '@shared/types/rdcRuntime';
import type { RdcContextLease } from '../../rdc/RdcRuntimeContextRegistry';
import { bindRdcTurn, freezeRdcTurnBinding, rdcBindingFingerprint, type RdcTurnBinding } from '../../rdc/RdcTurnBindings';
import { operationFingerprint } from '../../rdc/RdcOperationCatalog';
import { rebuildEffectiveRuntimePlan, type EffectiveRuntimePlan } from '../EffectiveRuntimePlan';
import { refreshPromptPlanRuntimeIdentity } from '../prompt/PromptPlanRuntimeIdentity';

/** Compile the next identity from frozen authority; installation is a separate host transaction. */
export function prepareRdcRuntimeEpoch(input: {
  sessionId: string; projectId: string; permissionRevision: number | null;
  previousPlan: EffectiveRuntimePlan; previousPrompt: PromptPlan; previousBinding: RdcTurnBinding;
  lease: RdcContextLease | null; catalog: readonly Record<string, unknown>[];
}): { plan: EffectiveRuntimePlan; prompt: PromptPlan; binding: RdcTurnBinding } {
  const { previousPlan, previousPrompt, previousBinding, lease } = input;
  if (previousPlan.projectId !== input.projectId || previousPlan.rdcBindingFingerprint !== rdcBindingFingerprint(previousBinding)
    || rebuildEffectiveRuntimePlan(previousPlan, { rdcBindingFingerprint: rdcBindingFingerprint(previousBinding),
      systemPrompt: previousPrompt.systemPrompt }).fingerprint !== previousPlan.fingerprint) {
    throw new Error('RDC_REPREPARE_FROZEN_PLAN_CHANGED: the prior plan, prompt and binding no longer agree.');
  }
  if (lease && (lease.ownerSessionId !== input.sessionId || lease.ownerProjectId !== input.projectId || lease.delegatedFrom
    || lease.quarantineReason || !lease.runtimeContext.captureFileId || !lease.runtimeContext.replaySessionId)) {
    throw new Error('RDC_REPREPARE_OWNER_INVALID: a complete owning replay is required.');
  }
  if (previousBinding.identity && operationFingerprint(input.catalog) !== previousBinding.definitionsFingerprint) {
    throw new Error('RDC_REPREPARE_CATALOG_CHANGED: the native operation contract differs from the frozen turn.');
  }
  const binding = freezeRdcTurnBinding(previousBinding.cli, input.catalog, lease);
  const prompt = refreshPromptPlanRuntimeIdentity(previousPrompt, input.sessionId, input.permissionRevision, lease);
  const plan = rebuildEffectiveRuntimePlan(previousPlan, { rdcBindingFingerprint: rdcBindingFingerprint(binding), systemPrompt: prompt.systemPrompt });
  bindRdcTurn(plan, binding);
  return { plan, prompt, binding };
}
