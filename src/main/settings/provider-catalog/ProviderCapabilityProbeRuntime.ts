import { generateEventId } from '@shared/utils/id';
import { charsToTokens } from '@shared/utils/tokens';
import { executeToolFreeRequest } from '../../agent-runtime/prompt/ToolFreeRequest';
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';
import { resolveAgentRouteCapability } from '../../agent-runtime/capabilities/RouteCapabilityResolver';
import type { AssistantMessage } from '../../agent-runtime/core/types';
import type { EffectiveModel, RequestPlan } from '@shared/types/providerCapability';
import type { LlmModelCapabilityProbeRequest, LlmProviderEntry } from '@shared/types/settings';
import type { PromptPlan } from '@shared/types/rdcRuntime';
const PROBE_MAX_OUTPUT_TOKENS = 64;


export interface CapabilityProbeExecution {
  request: LlmModelCapabilityProbeRequest;
  provider: LlmProviderEntry;
  model: EffectiveModel;
  plan: RequestPlan;
  credentialHandle: string;
  signal?: AbortSignal;
}

function buildProbePromptPlan(): PromptPlan {
  const content = 'This is a user-requested provider capability check. Reply with OK only. Do not call tools.';
  return {
    id: generateEventId('prompt-plan'),
    segments: [{
      id: 'runtime:provider-capability-probe',
      kind: 'runtime-fact',
      scope: 'runtime',
      sourcePath: 'runtime://provider-capability-probe',
      sourceHash: hashScopedResource(content),
      precedence: 0,
      content,
      stability: 'stable',
      tokenEstimate: charsToTokens(content.length),
    }],
    systemPrompt: content,
    totalTokenEstimate: charsToTokens(content.length),
    stablePrefix: {
      fingerprint: hashScopedResource([{ id: 'runtime:provider-capability-probe', content }]),
      segmentIds: ['runtime:provider-capability-probe'],
      sourceHashes: [hashScopedResource(content)],
      tokenEstimate: charsToTokens(content.length),
      volatileSegmentIds: [],
    },
    metrics: { systemPrompt: content.length, scopedInstructions: 0, skills: 0 },
    diagnostics: [],
  };
}

/** Executes one explicit, minimal, tool-free probe through the canonical request pipeline. */
export async function executeCapabilityProbe(input: CapabilityProbeExecution): Promise<AssistantMessage> {
  return executeToolFreeRequest({
    purpose: 'capability-probe',
    plan: input.plan,
    modelId: input.model.modelId,
    credentialHandle: input.credentialHandle,
    promptPlan: buildProbePromptPlan(),
    userContent: 'OK',
    maxTokens: PROBE_MAX_OUTPUT_TOKENS,
    reasoning: resolveAgentRouteCapability(input.provider, input.model.modelId, input.model, input.plan).reasoningContract,
    // The probe checks the route as a real turn would use it, cache behaviour included.
    writesPromptCache: true,
    controls: { capabilityProbeMode: input.request.mode },
    signal: input.signal,
  });
}
