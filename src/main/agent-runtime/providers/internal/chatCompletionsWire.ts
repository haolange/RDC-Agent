import { z } from 'zod';
import { createContinuationArtifact } from '../../reasoning/ContinuationArtifacts';
import { decideContinuationReplay } from '../../reasoning/ContinuationReplayPolicy';
import { reasoningProjectionSource } from '../reasoningProjection';
import { AlternatingTextThinkingChannels, StreamChannelRefs } from './streamChannelRefs';
import { readProviderFrames, type ProviderStreamRun } from './providerStreamDriver';
import { ToolCallAccumulator } from './toolCallAccumulator';
import { normalizeUsage, type UsageFieldMap } from './usageNormalizer';
import type { AssistantStreamBuilder } from './AssistantStreamBuilder';
import type { RequestPlan } from '@shared/types/providerCapability';
import type { Message, ProviderOutputRef, StopReason, StreamOptions, ThinkingArtifactSource, ToolDefinition } from '../../core/types';

/**
 * One Chat Completions stream chunk, as OpenAI-compatible and Mistral surfaces send it. Every field the adapters read
 * is validated; compatible servers send absent fields as `null` and add their own fields, which pass through.
 */
const ChatCompletionsChoiceSchema = z.object({
  index: z.number().nullish(),
  delta: z.object({
    role: z.string().nullish(),
    // Text deltas are strings; some servers stream structured content chunks, which the adapters do not read.
    content: z.union([z.string(), z.array(z.unknown())]).nullish(),
    reasoning: z.string().nullish(),
    reasoning_content: z.string().nullish(),
    tool_calls: z.array(z.object({
      index: z.number().nullish(),
      id: z.string().nullish(),
      type: z.string().nullish(),
      function: z.object({ name: z.string().nullish(), arguments: z.string().nullish() }).passthrough().nullish(),
    }).passthrough()).nullish(),
  }).passthrough().nullish(),
  finish_reason: z.string().nullish(),
}).passthrough();

const ChatCompletionsUsageSchema = z.object({
  prompt_tokens: z.number().nullish(),
  completion_tokens: z.number().nullish(),
  total_tokens: z.number().nullish(),
  prompt_cache_hit_tokens: z.number().nullish(),
  prompt_cache_miss_tokens: z.number().nullish(),
  prompt_tokens_details: z.object({ cached_tokens: z.number().nullish(), cache_write_tokens: z.number().nullish() }).passthrough().nullish(),
  completion_tokens_details: z.object({ reasoning_tokens: z.number().nullish() }).passthrough().nullish(),
}).passthrough();

const ChatCompletionsChunkSchema = z.object({
  id: z.string().nullish(),
  model: z.string().nullish(),
  service_tier: z.string().nullish(),
  choices: z.array(ChatCompletionsChoiceSchema).nullish(),
  usage: ChatCompletionsUsageSchema.nullish(),
}).passthrough();

export type ChatCompletionsChoice = z.infer<typeof ChatCompletionsChoiceSchema>;
export type ChatCompletionsUsage = z.infer<typeof ChatCompletionsUsageSchema>;
type ChatCompletionsChunk = z.infer<typeof ChatCompletionsChunkSchema>;

/** Every usage figure a Chat Completions surface may report, including DeepSeek's native prompt-cache counts. */
export const CHAT_COMPLETIONS_USAGE_FIELDS: UsageFieldMap<ChatCompletionsUsage> = {
  inputTokens: (usage) => usage.prompt_tokens,
  outputTokens: (usage) => usage.completion_tokens,
  totalTokens: (usage) => usage.total_tokens,
  cacheReadTokens: (usage) => usage.prompt_tokens_details?.cached_tokens,
  cacheWriteTokens: (usage) => usage.prompt_tokens_details?.cache_write_tokens,
  reasoningTokens: (usage) => usage.completion_tokens_details?.reasoning_tokens,
  promptCacheHitTokens: (usage) => usage.prompt_cache_hit_tokens,
  promptCacheMissTokens: (usage) => usage.prompt_cache_miss_tokens,
};

/** What one Chat Completions surface does differently while its stream is read. */
export interface ChatCompletionsDialect {
  providerApi: string;
  /**
   * The choice a chunk contributes, if any. It throws when the chunk breaks the surface's choice rules, given whether
   * a finish_reason already arrived and the stream's terminal ref.
   */
  selectChoice: (
    choices: ChatCompletionsChoice[],
    finishReasonSeen: boolean,
    terminalRef: ProviderOutputRef,
  ) => ChatCompletionsChoice | undefined;
  usageFields: UsageFieldMap<ChatCompletionsUsage>;
  /** Whether chunks report the serving model and service tier as the message's execution. */
  recordsExecution: boolean;
}

/** Reads a Chat Completions stream into the builder; the stream ends on finish_reason or the `[DONE]` sentinel. */
export async function consumeChatCompletionsStream(
  response: Response,
  run: ProviderStreamRun,
  options: StreamOptions,
  dialect: ChatCompletionsDialect,
): Promise<{ sawOutput: boolean }> {
  const state = new ChatCompletionsStreamState(run.builder, options.requestPlan, dialect);
  const frames = { providerApi: dialect.providerApi, framing: 'sse', frameSchema: ChatCompletionsChunkSchema } as const;
  for await (const chunk of readProviderFrames(response, run.signal, options, frames, () => state.markDone())) {
    state.handle(chunk);
  }
  return { sawOutput: state.sawOutput };
}

/**
 * Chat Completions has no block ids: text and reasoning alternate as segments, and tool calls are keyed by their
 * index within the choice.
 */
class ChatCompletionsStreamState {
  sawOutput = false;
  private finishReason: string | null = null;
  private reasoningText = '';
  private readonly channels: StreamChannelRefs;
  private readonly alternating: AlternatingTextThinkingChannels;
  private readonly terminalRef: ProviderOutputRef;
  private readonly toolCalls: ToolCallAccumulator<number>;
  private readonly reasoningSource: ThinkingArtifactSource;

  constructor(
    private readonly builder: AssistantStreamBuilder,
    private readonly requestPlan: RequestPlan,
    private readonly dialect: ChatCompletionsDialect,
  ) {
    this.channels = new StreamChannelRefs(dialect.providerApi);
    this.alternating = new AlternatingTextThinkingChannels(this.channels);
    this.terminalRef = this.channels.ref({ providerBlockKey: 'response:terminal' });
    this.toolCalls = new ToolCallAccumulator(builder);
    this.reasoningSource = reasoningProjectionSource(requestPlan, 'raw');
  }

  markDone(): void {
    this.builder.markTerminal(mapChatCompletionsFinishReason(this.finishReason));
  }

  handle(chunk: ChatCompletionsChunk): void {
    if (this.dialect.recordsExecution) {
      this.builder.setExecution({
        ...(typeof chunk.model === 'string' ? { modelId: chunk.model } : {}),
        ...(typeof chunk.service_tier === 'string' ? { serviceTier: chunk.service_tier } : {}),
      });
    }
    if (chunk.usage) this.builder.setUsage(normalizeUsage(chunk.usage, this.dialect.usageFields));
    const choice = this.dialect.selectChoice(chunk.choices ?? [], this.finishReason !== null, this.terminalRef);
    if (!choice) return;

    const delta = choice.delta ?? {};
    this.appendReasoning(delta.reasoning_content ?? delta.reasoning);
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      this.sawOutput = true;
      this.alternating.appendText(this.builder, delta.content);
    }
    for (const toolCall of delta.tool_calls ?? []) {
      const callIndex = typeof toolCall.index === 'number' ? toolCall.index : 0;
      this.sawOutput = true;
      const ref = this.channels.ref({ providerBlockKey: `virtual:tool:${callIndex}`, sourceIndex: callIndex });
      this.toolCalls.open(callIndex, ref, toolCall.id ?? '', toolCall.function?.name ?? '');
      this.toolCalls.appendArguments(callIndex, ref, toolCall.function?.arguments ?? '');
    }
    if (choice.finish_reason) {
      this.finishReason = choice.finish_reason;
      this.builder.markTerminal(mapChatCompletionsFinishReason(this.finishReason));
    }
  }

  private appendReasoning(reasoningDelta: string | null | undefined): void {
    if (typeof reasoningDelta !== 'string' || reasoningDelta.length === 0) return;
    this.sawOutput = true;
    this.reasoningText += reasoningDelta;
    const continuation = createContinuationArtifact(this.requestPlan, {
      type: 'reasoning_content',
      reasoningContent: this.reasoningText,
    });
    this.alternating.appendThinking(this.builder, reasoningDelta, {
      kind: 'raw',
      source: this.reasoningSource,
      visibility: 'raw-collapsed',
      continuation,
    });
  }
}

function mapChatCompletionsFinishReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool_calls':
    case 'function_call':
      return 'toolUse';
    case 'content_filter':
      return 'refusal';
    default:
      return 'stop';
  }
}

// =====================================================================
// Request conversion
// =====================================================================

export interface ChatCompletionsMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  reasoning_content?: string;
}

/**
 * One conversation message as a Chat Completions message. Assistant reasoning is replayed as `reasoning_content`
 * when its continuation contract allows; `requireReasoningContent` sends an empty one on every other assistant turn.
 */
export function toChatCompletionsMessage(
  message: Message,
  requestPlan: RequestPlan,
  requireReasoningContent: boolean,
): ChatCompletionsMessage {
  if (message.role === 'user') {
    if (typeof message.content === 'string') {
      return { role: 'user', content: message.content };
    }
    const parts: Array<Record<string, unknown>> = [];
    for (const block of message.content) {
      if (block.type === 'text') {
        parts.push({ type: 'text', text: block.text });
      } else if (block.type === 'image') {
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${block.mimeType};base64,${block.data}` },
        });
      }
    }
    return { role: 'user', content: parts };
  }

  if (message.role === 'assistant') {
    const text: string[] = [];
    const reasoning: string[] = [];
    const toolCalls: Required<ChatCompletionsMessage>['tool_calls'] = [];
    for (const block of message.content) {
      if (block.type === 'text') text.push(block.text);
      else if (block.type === 'thinking') {
        const sameToolLoop = message.content.some((candidate) => candidate.type === 'toolCall');
        const decision = decideContinuationReplay(block.continuation, requestPlan, { sameToolLoop });
        if (
          decision.action === 'replay'
          && block.continuation?.carrier === 'reasoning-content'
          && block.continuation.reasoningContent
        ) reasoning.push(block.continuation.reasoningContent);
      } else if (block.type === 'toolCall') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.arguments ?? {}),
          },
        });
      }
    }
    const out: ChatCompletionsMessage = {
      role: 'assistant',
      content: text.length > 0 ? text.join('') : null,
    };
    if (toolCalls.length > 0) out.tool_calls = toolCalls;
    if (reasoning.length > 0) out.reasoning_content = reasoning.join('');
    else if (requireReasoningContent) out.reasoning_content = '';
    return out;
  }

  // toolResult: the tool role carries text only; image content is not sent.
  const textBlocks: string[] = [];
  for (const block of message.content) {
    if (block.type === 'text') textBlocks.push(block.text);
  }
  return {
    role: 'tool',
    tool_call_id: message.toolCallId,
    content: textBlocks.join('\n'),
  };
}

export function toChatCompletionsTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
