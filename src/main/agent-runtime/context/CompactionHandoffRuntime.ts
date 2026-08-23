import type { AssistantMessage } from '../core/types';
import { encodeAgentModel, configuredRuntimeProvider } from '../providers/ConfiguredRuntimeProvider';
import { requestEnvelopeBuilder, requestSnapshotStore } from '../prompt';
import { promptCacheCompiler } from '../prompt/PromptCacheCompiler';
import type { EffectiveModel, RequestPlan } from '@shared/types/providerCapability';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { PromptPlan } from '@shared/types/rdxRuntime';
import { generateEventId } from '@shared/utils/id';
import { charsToTokens } from '@shared/utils/tokens';
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';
import { resolveAgentRouteCapability } from '../capabilities/RouteCapabilityResolver';
import { COMPACTION_HANDOFF_SYSTEM_PROMPT } from './StructuredHandoffBuilder';

const COMPACTION_MAX_OUTPUT_TOKENS = 4096;

export interface CompactionHandoffExecution {
  sessionId: string;
  provider: LlmProviderEntry;
  model: EffectiveModel;
  plan: RequestPlan;
  credentialHandle: string;
  transcript: string;
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
  const promptPlan = buildCompactionPromptPlan(input.transcript);
  const turnId = generateEventId('compaction-handoff');
  const messages = [{
    role: 'user' as const,
    content: `Transcript to compact:\n\n${input.transcript}`,
    timestamp: Date.now(),
  }];
  const callIndex = requestSnapshotStore.nextCallIndex(input.sessionId, turnId);
  const reasoning = resolveAgentRouteCapability(
    input.provider,
    input.model.modelId,
    input.model,
    input.plan,
  ).reasoningContract;
  const compiledCache = promptCacheCompiler.compile({
    promptPlan,
    requestPlan: input.plan,
    tools: [],
  });
  const promptCache = {
    ...compiledCache,
    enabled: false,
    reason: 'compaction-handoff-no-cache-write',
  };
  const snapshot = requestEnvelopeBuilder.build({
    promptPlan,
    sessionId: input.sessionId,
    turnId,
    callIndex,
    route: {
      providerId: input.plan.providerId,
      modelId: input.plan.effectiveModelId,
      protocol: input.plan.route.protocol,
    },
    requestPlan: input.plan,
    messages,
    tools: [],
    controls: {
      compactionHandoff: true,
      reasoningSelection: input.plan.reasoningWire.selection,
      maxTokens: COMPACTION_MAX_OUTPUT_TOKENS,
    },
    reasoning,
    cache: promptCache,
  });
  requestSnapshotStore.write(snapshot);

  const stream = configuredRuntimeProvider.stream(
    encodeAgentModel(input.plan.providerId, input.model.modelId, {
      contextWindow: input.plan.contextWindowTokens,
      maxOutputTokens: input.plan.maxOutputTokens || COMPACTION_MAX_OUTPUT_TOKENS,
    }),
    {
      systemPrompt: promptPlan.systemPrompt,
      systemPromptSegments: promptPlan.segments,
      messages,
      tools: [],
    },
    {
      requestPlan: input.plan,
      promptCache,
      credentialHandle: input.credentialHandle,
      reasoning: input.plan.reasoningWire,
      temperature: input.plan.temperature,
      maxTokens: COMPACTION_MAX_OUTPUT_TOKENS,
    },
  );
  for await (const _event of stream) {
    // Drain the stream so terminal errors settle before result().
  }
  const message = await stream.result();
  requestSnapshotStore.complete(snapshot.id, input.sessionId, turnId, {
    inputTokens: message.usage.inputTokens,
    outputTokens: message.usage.outputTokens,
    cacheReadTokens: message.usage.cacheReadTokens,
    cacheWriteTokens: message.usage.cacheWriteTokens,
    cacheHitTokens: message.usage.cacheHitTokens,
    cacheMissTokens: message.usage.cacheMissTokens,
    reasoningTokens: message.usage.reasoningTokens,
  });
  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
  if (!text) {
    throw new Error('COMPACTION_HANDOFF_EMPTY: the compaction model returned no text.');
  }
  return message;
}

export function assistantMessageText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}
