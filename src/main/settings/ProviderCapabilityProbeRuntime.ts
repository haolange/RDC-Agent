import type { AssistantMessage } from '../agent-runtime/core/types';
import { encodeAgentModel, configuredRuntimeProvider } from '../agent-runtime/providers/ConfiguredRuntimeProvider';
import { requestEnvelopeBuilder, requestSnapshotStore } from '../agent-runtime/prompt';
import type { EffectiveModel, RequestPlan } from '@shared/types/providerCapability';
import type { LlmModelCapabilityProbeRequest, LlmProviderEntry } from '@shared/types/settings';
import type { PromptPlan } from '@shared/types/rdxRuntime';
import { generateEventId } from '@shared/utils/id';
import { charsToTokens } from '@shared/utils/tokens';
import { hashScopedResource } from '../runtime/ScopedResourceResolver';
import { resolveAgentRouteCapability } from '../agent-runtime/capabilities/RouteCapabilityResolver';
const PROBE_MAX_OUTPUT_TOKENS = 64;


export interface CapabilityProbeExecution {
  request: LlmModelCapabilityProbeRequest;
  provider: LlmProviderEntry;
  model: EffectiveModel;
  plan: RequestPlan;
  credentialHandle: string;
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
      tokenEstimate: charsToTokens(content.length),
    }],
    systemPrompt: content,
    totalTokenEstimate: charsToTokens(content.length),
    metrics: { systemPrompt: content.length, scopedInstructions: 0, skills: 0 },
    diagnostics: [],
  };
}

/** Executes one explicit, minimal, tool-free probe through the canonical request pipeline. */
export async function executeCapabilityProbe(input: CapabilityProbeExecution): Promise<AssistantMessage> {
  const promptPlan = buildProbePromptPlan();
  const turnId = generateEventId('capability-probe');
  const messages = [{ role: 'user' as const, content: 'OK', timestamp: Date.now() }];
  const callIndex = requestSnapshotStore.nextCallIndex(undefined, turnId);
  const reasoning = resolveAgentRouteCapability(input.provider, input.model.modelId, input.model).reasoningContract;
  const snapshot = requestEnvelopeBuilder.build({
    promptPlan,
    turnId,
    callIndex,
    route: {
      providerId: input.request.providerId,
      modelId: input.plan.effectiveModelId,
      protocol: input.plan.route.protocol,
    },
    requestPlan: input.plan,
    messages,
    tools: [],
    controls: {
      capabilityProbeMode: input.request.mode,
      reasoningSelection: input.plan.reasoningWire.selection,
      maxTokens: PROBE_MAX_OUTPUT_TOKENS,
    },
    reasoning,
  });
  requestSnapshotStore.write(snapshot);

  const stream = configuredRuntimeProvider.stream(
    encodeAgentModel(input.request.providerId, input.model.modelId, {
      contextWindow: input.plan.contextBudgetTokens,
    }),
    { systemPrompt: promptPlan.systemPrompt, messages, tools: [] },
    {
      requestPlan: input.plan,
      credentialHandle: input.credentialHandle,
      reasoning: input.plan.reasoningWire,
      temperature: input.plan.temperature,
      maxTokens: PROBE_MAX_OUTPUT_TOKENS,
    },
  );
  for await (const _event of stream) {
    // Consume the canonical stream so provider parsing and terminal errors fully settle.
  }
  const message = await stream.result();
  requestSnapshotStore.complete(snapshot.id, undefined, turnId, {
    inputTokens: message.usage.inputTokens,
    outputTokens: message.usage.outputTokens,
    cacheReadTokens: message.usage.cacheReadTokens,
    cacheWriteTokens: message.usage.cacheWriteTokens,
    reasoningTokens: message.usage.reasoningTokens,
  });
  return message;
}
