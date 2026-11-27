import { generateEventId } from '@shared/utils/id';
import { configuredRuntimeProvider, encodeAgentModel } from '../providers/ConfiguredRuntimeProvider';
import { promptCacheCompiler } from './PromptCacheCompiler';
import { requestEnvelopeBuilder } from './RequestEnvelopeBuilder';
import { requestSnapshotStore } from './RequestSnapshotStore';
import type { RequestPlan } from '@shared/types/providerCapability';
import type { PromptPlan } from '@shared/types/rdcRuntime';
import type { ProviderReasoningContract } from '@shared/types/rdcRuntime';
import type { AssistantMessage, ToolDefinition } from '../core/types';

/** What asked for the request; it names the request's turn id and its snapshot control flag. */
export type AuxiliaryRequestPurpose = 'capability-probe' | 'compaction-handoff' | 'permission-review';

export interface AuxiliaryRequest {
  purpose: AuxiliaryRequestPurpose;
  /** Session the request snapshot belongs to; a capability probe has none. */
  sessionId?: string;
  plan: RequestPlan;
  /** Model id the provider is asked for; normally the plan's selected model. */
  modelId: string;
  credentialHandle: string;
  promptPlan: PromptPlan;
  userContent: string;
  /**
   * Tools offered to the model. Compaction and permission review offer none; a capability probe offers
   * one no-op tool, because every real turn carries tools and the probe checks the route as a turn uses it.
   */
  tools: readonly ToolDefinition[];
  maxTokens: number;
  reasoning: ProviderReasoningContract;
  /**
   * Compaction does not write the prompt cache, so it never evicts the conversation's prefix. A capability probe
   * compiles the route's real cache behaviour because that is what it checks. A permission review caches its own
   * stable prefix under its own affinity scope, apart from the conversation's.
   */
  writesPromptCache: boolean;
  /** The cache affinity of a request that writes the cache on a route keyed by session; never the conversation's. */
  cacheAffinityScopeId?: string;
  /** Extra snapshot controls beyond the purpose flag, reasoning selection and output limit. */
  controls?: Record<string, unknown>;
  signal?: AbortSignal;
}

/**
 * One request without conversation history or tool execution, through the same snapshot, route, credential
 * and cache rules as a normal turn. Capability probes, compaction hand-offs and permission reviews all go
 * through here; the caller judges the returned message, tool calls included.
 */
export async function executeAuxiliaryRequest(request: AuxiliaryRequest): Promise<AssistantMessage> {
  request.signal?.throwIfAborted();
  const { plan, promptPlan } = request;
  const turnId = generateEventId(request.purpose);
  const messages = [{ role: 'user' as const, content: request.userContent, timestamp: Date.now() }];
  const tools = [...request.tools];
  const compiledCache = promptCacheCompiler.compile({
    promptPlan,
    requestPlan: plan,
    tools,
    ...(request.cacheAffinityScopeId ? { affinityScopeId: request.cacheAffinityScopeId } : {}),
  });
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
    tools,
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
    { systemPrompt: promptPlan.systemPrompt, systemPromptSegments: promptPlan.segments, messages, tools },
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

const PURPOSE_CONTROL: Record<AuxiliaryRequestPurpose, string> = {
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
