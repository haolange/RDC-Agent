import type { AssistantMessage } from '../core/types';
import type { ProviderReasoningContract } from '@shared/types/rdcRuntime';
import type { PromptPlan } from '@shared/types/rdcRuntime';
import type { RequestPlan } from '@shared/types/providerCapability';
import { generateEventId } from '@shared/utils/id';
import { configuredRuntimeProvider, encodeAgentModel } from '../providers/ConfiguredRuntimeProvider';
import { promptCacheCompiler } from './PromptCacheCompiler';
import { requestEnvelopeBuilder } from './RequestEnvelopeBuilder';
import { requestSnapshotStore } from './RequestSnapshotStore';

/** What asked for the request; it names the request's turn id and its snapshot control flag. */
export type ToolFreeRequestPurpose = 'capability-probe' | 'compaction-handoff' | 'permission-review';

export interface ToolFreeRequest {
  purpose: ToolFreeRequestPurpose;
  /** Session the request snapshot belongs to; a capability probe has none. */
  sessionId?: string;
  plan: RequestPlan;
  /** Model id the provider is asked for; normally the plan's selected model. */
  modelId: string;
  credentialHandle: string;
  promptPlan: PromptPlan;
  userContent: string;
  maxTokens: number;
  reasoning: ProviderReasoningContract;
  /**
   * Auxiliary requests do not write the prompt cache, so they never evict the conversation's prefix.
   * A capability probe compiles the route's real cache behaviour because that is what it checks.
   */
  writesPromptCache: boolean;
  /** Extra snapshot controls beyond the purpose flag, reasoning selection and output limit. */
  controls?: Record<string, unknown>;
  signal?: AbortSignal;
}

/**
 * One request with no tools and no conversation history, through the same snapshot, route, credential and
 * cache rules as a normal turn. Capability probes, compaction hand-offs and permission reviews all go
 * through here; the caller judges the returned message.
 */
export async function executeToolFreeRequest(request: ToolFreeRequest): Promise<AssistantMessage> {
  request.signal?.throwIfAborted();
  const { plan, promptPlan } = request;
  const turnId = generateEventId(request.purpose);
  const messages = [{ role: 'user' as const, content: request.userContent, timestamp: Date.now() }];
  const compiledCache = promptCacheCompiler.compile({ promptPlan, requestPlan: plan, tools: [] });
  const promptCache = request.writesPromptCache
    ? compiledCache
    : { ...compiledCache, enabled: false, reason: `${request.purpose}-no-cache-write` };
  const snapshot = requestEnvelopeBuilder.build({
    promptPlan,
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    turnId,
    callIndex: requestSnapshotStore.nextCallIndex(request.sessionId, turnId),
    route: { providerId: plan.providerId, modelId: plan.effectiveModelId, protocol: plan.route.protocol },
    requestPlan: plan,
    messages,
    tools: [],
    controls: {
      [PURPOSE_CONTROL[request.purpose]]: true,
      ...request.controls,
      reasoningSelection: plan.reasoningWire.selection,
      maxTokens: request.maxTokens,
    },
    reasoning: request.reasoning,
    cache: promptCache,
  });
  requestSnapshotStore.write(snapshot);

  const stream = configuredRuntimeProvider.stream(
    encodeAgentModel(plan.providerId, request.modelId, {
      contextWindow: plan.contextWindowTokens,
      maxOutputTokens: plan.maxOutputTokens || request.maxTokens,
    }),
    { systemPrompt: promptPlan.systemPrompt, systemPromptSegments: promptPlan.segments, messages, tools: [] },
    {
      requestPlan: plan,
      promptCache,
      credentialHandle: request.credentialHandle,
      reasoning: plan.reasoningWire,
      temperature: plan.temperature,
      maxTokens: request.maxTokens,
      ...(request.purpose === 'capability-probe' ? { capabilityProbe: true } : {}),
      signal: request.signal,
    },
  );
  for await (const _event of stream) {
    // Drain the canonical stream so provider parsing and terminal errors settle before result().
  }
  const message = await stream.result();
  // A request cancelled while it streamed records nothing, even if the provider finished.
  request.signal?.throwIfAborted();
  const usage = message.usage;
  requestSnapshotStore.complete(snapshot.id, request.sessionId, turnId, {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cacheHitTokens: usage.cacheHitTokens,
    cacheMissTokens: usage.cacheMissTokens,
    reasoningTokens: usage.reasoningTokens,
  });
  return message;
}

const PURPOSE_CONTROL: Record<ToolFreeRequestPurpose, string> = {
  'capability-probe': 'capabilityProbe',
  'compaction-handoff': 'compactionHandoff',
  'permission-review': 'permissionReview',
};

/** The text of a message's text blocks, in order. */
export function assistantMessageText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}
