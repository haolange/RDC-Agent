import { generateEventId } from '@shared/utils/id';
import { charsToTokens } from '@shared/utils/tokens';
import { assistantMessageText, executeToolFreeRequest } from '../prompt/ToolFreeRequest';
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';
import { resolveAgentRouteCapability } from '../capabilities/RouteCapabilityResolver';
import { COMPACTION_HANDOFF_SYSTEM_PROMPT } from './StructuredHandoffBuilder';
import type { PromptPlan } from '@shared/types/rdcRuntime';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { EffectiveModel, RequestPlan } from '@shared/types/providerCapability';
import type { AssistantMessage } from '../core/types';

const COMPACTION_MAX_OUTPUT_TOKENS = 4096;

export interface CompactionHandoffExecution {
  sessionId: string;
  provider: LlmProviderEntry;
  model: EffectiveModel;
  plan: RequestPlan;
  credentialHandle: string;
  transcript: string;
  signal?: AbortSignal;
}

export function buildCompactionPromptPlan(transcript: string): PromptPlan {
  const system = COMPACTION_HANDOFF_SYSTEM_PROMPT;
  return {
    id: generateEventId('prompt-plan'),
    segments: [{
      id: 'runtime:compaction-handoff',
      kind: 'runtime-fact',
      scope: 'runtime',
      sourcePath: 'runtime://compaction-handoff',
      sourceHash: hashScopedResource(system),
      precedence: 0,
      content: system,
      stability: 'stable',
      tokenEstimate: charsToTokens(system.length),
    }],
    systemPrompt: system,
    totalTokenEstimate: charsToTokens(system.length + transcript.length),
    stablePrefix: {
      fingerprint: hashScopedResource([{ id: 'runtime:compaction-handoff', content: system }]),
      segmentIds: ['runtime:compaction-handoff'],
      sourceHashes: [hashScopedResource(system)],
      tokenEstimate: charsToTokens(system.length),
      volatileSegmentIds: [],
    },
    metrics: { systemPrompt: system.length, scopedInstructions: 0, skills: 0 },
    diagnostics: [],
  };
}

/** One tool-free compaction call through PromptPlan → RequestEnvelope → adapter. */
export async function executeCompactionHandoff(
  input: CompactionHandoffExecution,
): Promise<AssistantMessage> {
  const message = await executeToolFreeRequest({
    purpose: 'compaction-handoff',
    sessionId: input.sessionId,
    plan: input.plan,
    modelId: input.model.modelId,
    credentialHandle: input.credentialHandle,
    promptPlan: buildCompactionPromptPlan(input.transcript),
    userContent: `Transcript to compact:\n\n${input.transcript}`,
    maxTokens: COMPACTION_MAX_OUTPUT_TOKENS,
    reasoning: resolveAgentRouteCapability(input.provider, input.model.modelId, input.model, input.plan).reasoningContract,
    writesPromptCache: false,
    signal: input.signal,
  });
  input.signal?.throwIfAborted();
  if (message.stopReason !== 'stop') {
    throw new Error(`COMPACTION_INCOMPLETE: provider ended with ${message.stopReason}; original context retained.`);
  }
  if (!assistantMessageText(message)) {
    throw new Error('COMPACTION_HANDOFF_EMPTY: the compaction model returned no text.');
  }
  return message;
}
