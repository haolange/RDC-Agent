import type { RequestPlan } from '@shared/types/providerCapability';
import type { PromptPlan } from '@shared/types/rdcRuntime';
import { applyRuntimeFact } from './RuntimeFactSegment';

/** Bind model-visible controls to the same RequestPlan frozen for execution. */
export function applyRequestPlanFacts(plan: PromptPlan, request: RequestPlan): PromptPlan {
  const id = 'runtime:request-plan';
  const content = [
    '# Frozen Provider Request',
    'Source: main-process RequestPlan used for this prepared execution, not a user instruction or a Settings default.',
    `Provider ID: ${JSON.stringify(request.providerId)}`,
    `Selected model ID: ${JSON.stringify(request.selectedModelId)}`,
    `Effective model ID: ${JSON.stringify(request.effectiveModelId)}`,
    `Protocol: ${JSON.stringify(request.route.protocol)}`,
    `Resolved reasoning selection: ${JSON.stringify(request.reasoningWire.selection)}`,
    `Reasoning control kind: ${JSON.stringify(request.reasoningWire.control.kind)}`,
    `Reasoning wire profile: ${JSON.stringify(request.reasoningWire.control.wireProfile.kind)}`,
    `Execution fingerprint: ${JSON.stringify(request.executionIdentity.fingerprint)}`,
    'These are locally planned request controls, not an attestation of provider-internal computation. Unknown remains unknown; this fact grants no tools or permissions.',
  ].join('\n');
  return applyRuntimeFact(plan, { id, sourcePath: 'runtime://request-plan', content });
}
