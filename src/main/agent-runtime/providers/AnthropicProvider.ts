import { z } from 'zod';
import { AppError } from '@shared/errors/appError';
import { createContinuationArtifact } from '../reasoning/ContinuationArtifacts';
import { decideContinuationReplay } from '../reasoning/ContinuationReplayPolicy';
import { applyRequestPlanBody, requestPlanHeaders } from './requestPlanWire';
import { partitionSystemPrompt } from './promptCacheWire';
import { unhandledProviderEvent } from './internal/AssistantStreamBuilder';
import { StreamChannelRefs } from './internal/streamChannelRefs';
import { ProviderHttpError } from './internal/http';
import {
  readProviderFrames,
  sendProviderRequest,
  startProviderStream,
  type ProviderFrameStream,
  type ProviderStreamRun,
} from './internal/providerStreamDriver';
import { normalizeUsage, type UsageFieldMap } from './internal/usageNormalizer';
import { applyReasoningToAnthropicLikeBody, reasoningVisibilityRequest } from './reasoningWire';
import { reasoningProjectionSource } from './reasoningProjection';
import type { AssistantStreamBuilder } from './internal/AssistantStreamBuilder';
import type { ThinkingContentInput } from '../reasoning/ReasoningArtifacts';
import type { ReasoningVisibility } from '@shared/types/agentRuntime';
import type { EventStream } from '../core/EventStream';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Message,
  Model,
  ProviderContinuationArtifact,
  ProviderOutputRef,
  StopReason,
  StreamOptions,
  ThinkingArtifactKind,
  ThinkingArtifactSource,
  ThinkingArtifactVisibility,
  ToolDefinition,
} from '../core/types';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import type { RequestPlan } from '@shared/types/providerCapability';

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';
const PROVIDER_API = 'anthropic-messages';

const AnthropicUsageSchema = z
  .object({
    input_tokens: z.number().nullish(),
    output_tokens: z.number().nullish(),
    cache_read_input_tokens: z.number().nullish(),
    cache_creation_input_tokens: z.number().nullish(),
    speed: z.string().nullish(),
  })
  .passthrough();

const AnthropicContentBlockSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string().optional() }).passthrough(),
  z
    .object({ type: z.literal('thinking'), thinking: z.string().optional(), signature: z.string().optional() })
    .passthrough(),
  z.object({ type: z.literal('redacted_thinking'), data: z.string() }).passthrough(),
  z
    .object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.unknown().optional() })
    .passthrough(),
  unhandledProviderEvent(['text', 'thinking', 'redacted_thinking', 'tool_use']),
]);

const AnthropicDeltaSchema = z.union([
  z.object({ type: z.literal('text_delta'), text: z.string() }).passthrough(),
  z.object({ type: z.literal('thinking_delta'), thinking: z.string() }).passthrough(),
  z.object({ type: z.literal('signature_delta'), signature: z.string() }).passthrough(),
  z.object({ type: z.literal('input_json_delta'), partial_json: z.string() }).passthrough(),
  unhandledProviderEvent(['text_delta', 'thinking_delta', 'signature_delta', 'input_json_delta']),
]);

/** One Messages stream event; event types this adapter does not handle (ping, ...) are ignored. */
const AnthropicEventSchema = z.union([
  z
    .object({
      type: z.literal('message_start'),
      message: z
        .object({ model: z.string().nullish(), id: z.string().nullish(), usage: AnthropicUsageSchema.nullish() })
        .passthrough(),
    })
    .passthrough(),
  z
    .object({ type: z.literal('content_block_start'), index: z.number(), content_block: AnthropicContentBlockSchema })
    .passthrough(),
  z.object({ type: z.literal('content_block_delta'), index: z.number(), delta: AnthropicDeltaSchema }).passthrough(),
  z.object({ type: z.literal('content_block_stop'), index: z.number() }).passthrough(),
  z
    .object({
      type: z.literal('message_delta'),
      delta: z.object({ stop_reason: z.string().nullish() }).passthrough(),
      usage: AnthropicUsageSchema.nullish(),
    })
    .passthrough(),
  z.object({ type: z.literal('message_stop') }).passthrough(),
  z
    .object({ type: z.literal('error'), error: z.object({ type: z.string(), message: z.string() }).passthrough() })
    .passthrough(),
  unhandledProviderEvent([
    'message_start',
    'content_block_start',
    'content_block_delta',
    'content_block_stop',
    'message_delta',
    'message_stop',
    'error',
  ]),
]);
type AnthropicEvent = z.infer<typeof AnthropicEventSchema>;
type AnthropicUsage = z.infer<typeof AnthropicUsageSchema>;

const ANTHROPIC_FRAMES: ProviderFrameStream<AnthropicEvent> = {
  providerApi: PROVIDER_API,
  framing: 'sse',
  frameSchema: AnthropicEventSchema,
};

/** Usage figures as Anthropic reports them, merged across message_start and message_delta. */
interface AnthropicUsageTotals {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  speed?: 'standard' | 'fast';
}

const ANTHROPIC_USAGE_FIELDS: UsageFieldMap<AnthropicUsageTotals> = {
  // Anthropic 的 input_tokens 不含 prompt cache 命中/写入部分；
  // agent-runtime Usage.inputTokens 归一为完整 prompt 占用（与 OpenAI prompt_tokens 口径一致）。
  inputTokens: (usage) =>
    (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
  outputTokens: (usage) => usage.output_tokens,
  cacheReadTokens: (usage) => usage.cache_read_input_tokens,
  cacheWriteTokens: (usage) => usage.cache_creation_input_tokens,
  speed: (usage) => usage.speed,
};

/** message_start reports every figure; message_delta refines output, cache and speed but never input. */
function mergeAnthropicUsage(
  totals: AnthropicUsageTotals,
  reported: AnthropicUsage | null | undefined,
  source: 'message_start' | 'message_delta',
): AnthropicUsageTotals {
  return {
    input_tokens: source === 'message_start' ? (reported?.input_tokens ?? totals.input_tokens) : totals.input_tokens,
    output_tokens: reported?.output_tokens ?? totals.output_tokens,
    cache_read_input_tokens: reported?.cache_read_input_tokens ?? totals.cache_read_input_tokens,
    cache_creation_input_tokens: reported?.cache_creation_input_tokens ?? totals.cache_creation_input_tokens,
    speed: reported?.speed === 'standard' || reported?.speed === 'fast' ? reported.speed : totals.speed,
  };
}

export interface AnthropicProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  anthropicVersion?: string;
  headers?: Record<string, string>;
  surface?: 'anthropic' | 'vertex';
}

export class AnthropicProvider implements ProviderStrategy {
  readonly api = PROVIDER_API;
  private readonly defaultBaseUrl: string;
  private readonly defaultApiKey: string | undefined;
  private readonly anthropicVersion: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly surface: 'anthropic' | 'vertex';

  constructor(options: AnthropicProviderOptions = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.defaultApiKey = options.apiKey;
    this.anthropicVersion = options.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION;
    this.defaultHeaders = { ...(options.headers ?? {}) };
    this.surface = options.surface ?? 'anthropic';
  }

  stream(model: Model, context: Context, options: StreamOptions): EventStream<AssistantMessageEvent, AssistantMessage> {
    return startProviderStream({ providerApi: PROVIDER_API, model, options }, async (run) => {
      const response = await this.send(model, context, options, run.signal);
      return consumeAnthropicStream(response, run, options);
    });
  }

  private async send(model: Model, context: Context, options: StreamOptions, signal: AbortSignal): Promise<Response> {
    const baseUrl = (options.baseUrl ?? this.defaultBaseUrl).replace(/\/+$/, '');
    const apiKey = options.apiKey ?? this.defaultApiKey;
    if (!apiKey) {
      throw new ProviderHttpError(PROVIDER_API, 401, 'missing apiKey for Anthropic provider');
    }
    const body = applyRequestPlanBody(this.buildRequestBody(model, context, options), options.requestPlan);
    if (this.surface === 'vertex') {
      delete body.model;
      body.anthropic_version = 'vertex-2023-10-16';
    }
    const url = buildAnthropicMessagesUrl(baseUrl, model.id, this.surface);
    const plannedHeaders = mergeAnthropicRequestHeaders(this.defaultHeaders, requestPlanHeaders(options.requestPlan));
    return sendProviderRequest(PROVIDER_API, options.requestPlan, signal, {
      url,
      headers: {
        'Content-Type': 'application/json',
        ...(this.surface === 'vertex'
          ? { Authorization: `Bearer ${apiKey}` }
          : { 'x-api-key': apiKey, 'anthropic-version': this.anthropicVersion }),
        ...plannedHeaders,
      },
      body,
    });
  }

  private buildRequestBody(model: Model, context: Context, options: StreamOptions): Record<string, unknown> {
    const { system, messages } = toAnthropicMessages(context, options.requestPlan, options.promptCache, this.surface);
    const body: Record<string, unknown> = {
      model: model.id,
      messages,
      stream: true,
      max_tokens: options.maxTokens ?? model.maxTokens,
    };
    if (system) body.system = system;
    if (
      this.surface === 'anthropic' &&
      options.promptCache?.enabled &&
      options.promptCache.breakpointCarrier === 'anthropic-cache-control' &&
      (options.promptCache.breakpoint === 'automatic' || options.promptCache.breakpoint === 'automatic-and-explicit')
    ) {
      body.cache_control = anthropicCacheControl(options.promptCache.ttl);
    }
    if (typeof options.temperature === 'number') body.temperature = options.temperature;
    if (typeof options.topP === 'number') body.top_p = options.topP;
    applyReasoningToAnthropicLikeBody(body, options.reasoning, reasoningVisibilityRequest(options));
    if (context.tools && context.tools.length > 0) {
      body.tools = context.tools.map(toAnthropicTool);
    }
    return body;
  }
}

export function buildAnthropicMessagesUrl(
  baseUrl: string,
  modelId: string,
  surface: 'anthropic' | 'vertex' = 'anthropic',
): string {
  const trimmed = baseUrl.replace(/\/+$/u, '');
  if (surface === 'vertex') {
    return `${trimmed}/models/${encodeURIComponent(modelId)}:streamRawPredict`;
  }
  if (trimmed.endsWith('/messages')) return trimmed;
  return /\/v\d+(?:\/|$)/u.test(new URL(trimmed).pathname) ? `${trimmed}/messages` : `${trimmed}/v1/messages`;
}

/** Reads a Messages stream: content blocks are addressed by index, and message_stop is the terminal signal. */
async function consumeAnthropicStream(
  response: Response,
  run: ProviderStreamRun,
  options: StreamOptions,
): Promise<{ sawOutput: boolean }> {
  const state = new AnthropicStreamState(run.builder, options);
  for await (const event of readProviderFrames(response, run.signal, options, ANTHROPIC_FRAMES)) state.handle(event);
  return { sawOutput: state.sawOutput };
}

type AnthropicBlockKind = 'text' | 'thinking' | 'tool_call';

class AnthropicStreamState {
  sawOutput = false;
  private responseId: string | undefined;
  private stopReason: string | null = null;
  private usage: AnthropicUsageTotals = {};
  private readonly channels = new StreamChannelRefs(PROVIDER_API);
  private readonly blockKinds = new Map<number, AnthropicBlockKind>();
  private readonly thinkingArtifactsByIndex = new Map<number, ProviderContinuationArtifact | undefined>();
  private readonly requestPlan: RequestPlan;
  private readonly thinkingKind: ThinkingArtifactKind;
  private readonly thinkingVisibility: ThinkingArtifactVisibility;
  private readonly thinkingSource: ThinkingArtifactSource;
  private readonly redactedThinkingSource: ThinkingArtifactSource;

  constructor(
    private readonly builder: AssistantStreamBuilder,
    options: StreamOptions,
  ) {
    this.requestPlan = options.requestPlan;
    this.thinkingKind = resolveAnthropicThinkingKind(options.reasoningVisibility);
    this.thinkingVisibility = resolveAnthropicThinkingVisibility(options.reasoningVisibility);
    this.thinkingSource = reasoningProjectionSource(options.requestPlan, 'raw');
    this.redactedThinkingSource = reasoningProjectionSource(options.requestPlan, 'opaque');
  }

  handle(event: AnthropicEvent): void {
    switch (event.type) {
      case 'message_start':
        this.responseId = event.message.id?.trim() || this.responseId;
        if (typeof event.message.model === 'string') this.builder.setExecution({ modelId: event.message.model });
        this.usage = mergeAnthropicUsage(this.usage, event.message.usage, 'message_start');
        this.builder.setUsage(normalizeUsage(this.usage, ANTHROPIC_USAGE_FIELDS));
        break;
      case 'content_block_start':
        this.startBlock(event.index, event.content_block);
        break;
      case 'content_block_delta':
        this.appendDelta(event.index, event.delta);
        break;
      case 'content_block_stop':
        this.stopBlock(event.index);
        break;
      case 'message_delta':
        if (event.delta.stop_reason) this.stopReason = event.delta.stop_reason;
        if (event.usage) {
          this.usage = mergeAnthropicUsage(this.usage, event.usage, 'message_delta');
          this.builder.setUsage(normalizeUsage(this.usage, ANTHROPIC_USAGE_FIELDS));
        }
        break;
      case 'message_stop':
        this.builder.markTerminal(mapStopReason(this.stopReason));
        break;
      case 'error':
        throw new Error(`anthropic ${event.error.type}: ${event.error.message}`);
      default:
        break;
    }
  }

  private refFor(index: number): ProviderOutputRef {
    return this.channels.ref({
      providerBlockKey: `content:${index}`,
      sourceIndex: index,
      responseId: this.responseId,
      contentIndex: index,
    });
  }

  private thinkingInput(continuation: ProviderContinuationArtifact | undefined): ThinkingContentInput {
    return {
      kind: this.thinkingKind,
      source: this.thinkingSource,
      visibility: this.thinkingVisibility,
      continuation,
    };
  }

  private startBlock(
    index: number,
    block: Extract<AnthropicEvent, { type: 'content_block_start' }>['content_block'],
  ): void {
    const blockRef = this.refFor(index);
    if (block.type === 'text') {
      this.builder.startText(blockRef);
      this.blockKinds.set(index, 'text');
      if (block.text) {
        this.sawOutput = true;
        this.builder.appendText(blockRef, block.text);
      }
    } else if (block.type === 'thinking') {
      const artifact = createAnthropicThinkingArtifact(this.requestPlan, block.signature);
      this.thinkingArtifactsByIndex.set(index, artifact);
      this.builder.startThinking(blockRef, this.thinkingInput(artifact));
      this.blockKinds.set(index, 'thinking');
      if (block.thinking) {
        this.sawOutput = true;
        this.builder.appendThinking(blockRef, block.thinking, this.thinkingInput(artifact));
      }
    } else if (block.type === 'redacted_thinking') {
      const artifact = createAnthropicRedactedArtifact(this.requestPlan, block.data);
      this.thinkingArtifactsByIndex.set(index, artifact);
      this.sawOutput = true;
      this.builder.startThinking(blockRef, {
        kind: 'opaque',
        source: this.redactedThinkingSource,
        visibility: 'hidden',
        continuation: artifact,
      });
      this.blockKinds.set(index, 'thinking');
    } else if (block.type === 'tool_use') {
      this.sawOutput = true;
      this.builder.startToolCall(blockRef, block.id, block.name);
      this.blockKinds.set(index, 'tool_call');
      if (
        block.input &&
        typeof block.input === 'object' &&
        Object.keys(block.input as Record<string, unknown>).length > 0
      ) {
        this.builder.appendToolCallArgs(blockRef, JSON.stringify(block.input));
      }
    }
  }

  private appendDelta(index: number, delta: Extract<AnthropicEvent, { type: 'content_block_delta' }>['delta']): void {
    if (delta.type === 'text_delta') {
      this.sawOutput = true;
      this.builder.appendText(this.refFor(index), delta.text);
    } else if (delta.type === 'thinking_delta') {
      this.sawOutput = true;
      this.builder.appendThinking(
        this.refFor(index),
        delta.thinking,
        this.thinkingInput(
          this.thinkingArtifactsByIndex.get(index) ?? createAnthropicThinkingArtifact(this.requestPlan),
        ),
      );
    } else if (delta.type === 'signature_delta') {
      const artifact = mergeAnthropicSignature(
        this.requestPlan,
        this.thinkingArtifactsByIndex.get(index) ?? createAnthropicThinkingArtifact(this.requestPlan),
        delta.signature,
      );
      this.thinkingArtifactsByIndex.set(index, artifact);
      this.builder.updateThinking(this.refFor(index), this.thinkingInput(artifact));
    } else if (delta.type === 'input_json_delta') {
      this.sawOutput = true;
      this.builder.appendToolCallArgs(this.refFor(index), delta.partial_json);
    }
  }

  private stopBlock(index: number): void {
    const ref = this.refFor(index);
    const kind = this.blockKinds.get(index);
    if (kind === 'text') this.builder.endText(ref);
    else if (kind === 'thinking') this.builder.endThinking(ref);
    else if (kind === 'tool_call') this.builder.endToolCall(ref);
    else this.builder.endText(ref);
  }
}

function resolveAnthropicThinkingKind(reasoningVisibility?: ReasoningVisibility): ThinkingArtifactKind {
  if (reasoningVisibility === 'unknown-events') return 'unknown';
  return reasoningVisibility === 'summary-events' ? 'summary' : 'raw';
}

function resolveAnthropicThinkingVisibility(reasoningVisibility?: ReasoningVisibility): ThinkingArtifactVisibility {
  return reasoningVisibility === 'summary-events' ? 'summary' : 'raw-collapsed';
}

interface AnthropicSystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral'; ttl: '5m' | '1h' };
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string };
    }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: Array<{ type: 'text'; text: string }>;
      is_error?: boolean;
    };

function toAnthropicMessages(
  context: Context,
  requestPlan: RequestPlan,
  promptCache?: StreamOptions['promptCache'],
  surface: 'anthropic' | 'vertex' = 'anthropic',
): {
  system?: string | AnthropicSystemBlock[];
  messages: AnthropicMessage[];
} {
  const messages: AnthropicMessage[] = [];
  for (let index = 0; index < context.messages.length; index += 1) {
    const message = context.messages[index];
    if (message.role === 'toolResult') {
      const toolResultBlocks: AnthropicContentBlock[] = [];
      while (index < context.messages.length && context.messages[index].role === 'toolResult') {
        const toolResultMessage = context.messages[index];
        if (toolResultMessage.role !== 'toolResult') break;
        toolResultBlocks.push(toAnthropicToolResultBlock(toolResultMessage));
        index += 1;
      }
      index -= 1;
      messages.push({ role: 'user', content: toolResultBlocks });
      continue;
    }
    messages.push(...convertMessage(message, requestPlan).filter((converted) => converted.content.length > 0));
  }

  const prompt = partitionSystemPrompt(context);
  const explicitBreakpoint =
    promptCache?.enabled === true &&
    promptCache.breakpointCarrier === 'anthropic-cache-control' &&
    (promptCache.breakpoint === 'explicit' || promptCache.breakpoint === 'automatic-and-explicit');
  if (explicitBreakpoint && surface !== 'anthropic') {
    throw new AppError(
      'PROMPT_CACHE_SURFACE_UNSUPPORTED',
      'explicit Anthropic cache blocks are not enabled for this surface manifest.',
    );
  }
  if (explicitBreakpoint) {
    if (!prompt.stableText) {
      throw new AppError(
        'PROMPT_CACHE_STABLE_PREFIX_UNAVAILABLE',
        'explicit Anthropic cache mode requires PromptPlan-owned stable segments.',
      );
    }
    const system: AnthropicSystemBlock[] = [
      {
        type: 'text',
        text: prompt.stableText,
        cache_control: anthropicCacheControl(promptCache.ttl),
      },
    ];
    if (prompt.volatileText) system.push({ type: 'text', text: prompt.volatileText });
    return { system, messages };
  }
  return {
    system: prompt.combinedText,
    messages,
  };
}

function convertMessage(message: Message, requestPlan: RequestPlan): AnthropicMessage[] {
  if (message.role === 'user') {
    if (typeof message.content === 'string') {
      const text = message.content.trim();
      return text ? [{ role: 'user', content: [{ type: 'text', text }] }] : [];
    }
    const blocks: AnthropicContentBlock[] = [];
    for (const block of message.content) {
      if (block.type === 'text' && block.text.trim()) {
        blocks.push({ type: 'text', text: block.text });
      } else if (block.type === 'image') {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: block.mimeType, data: block.data },
        });
      }
    }
    return [{ role: 'user', content: blocks }];
  }

  if (message.role === 'assistant') {
    const blocks: AnthropicContentBlock[] = [];
    for (const block of message.content) {
      if (block.type === 'text' && block.text.trim()) {
        blocks.push({ type: 'text', text: block.text });
      } else if (block.type === 'thinking') {
        const replayBlock = toAnthropicThinkingReplayBlock(
          block.text,
          block.continuation,
          requestPlan,
          message.content.some((candidate) => candidate.type === 'toolCall'),
        );
        if (replayBlock) blocks.push(replayBlock);
      } else if (block.type === 'toolCall') {
        blocks.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.arguments,
        });
      }
    }
    return [{ role: 'assistant', content: blocks }];
  }

  return [
    {
      role: 'user',
      content: [toAnthropicToolResultBlock(message)],
    },
  ];
}

function toAnthropicToolResultBlock(message: Extract<Message, { role: 'toolResult' }>): AnthropicContentBlock {
  const textBlocks: Array<{ type: 'text'; text: string }> = [];
  for (const block of message.content) {
    if (block.type === 'text' && block.text.trim()) textBlocks.push({ type: 'text', text: block.text });
  }
  return {
    type: 'tool_result',
    tool_use_id: message.toolCallId,
    content: textBlocks.length > 0 ? textBlocks : [{ type: 'text', text: 'Tool returned no text.' }],
    is_error: message.isError || undefined,
  };
}

function createAnthropicThinkingArtifact(
  requestPlan: RequestPlan,
  signature?: string,
): ProviderContinuationArtifact | undefined {
  return createContinuationArtifact(requestPlan, {
    type: 'thinking',
    signature: signature || undefined,
  });
}

function createAnthropicRedactedArtifact(
  requestPlan: RequestPlan,
  data: string,
): ProviderContinuationArtifact | undefined {
  return createContinuationArtifact(requestPlan, {
    type: 'redacted_thinking',
    redactedContent: data,
  });
}

function mergeAnthropicSignature(
  requestPlan: RequestPlan,
  artifact: ProviderContinuationArtifact | undefined,
  signatureDelta: string,
): ProviderContinuationArtifact | undefined {
  return createContinuationArtifact(requestPlan, {
    type: 'thinking',
    signature: (artifact?.signature ?? '') + signatureDelta,
  });
}

function toAnthropicThinkingReplayBlock(
  text: string | undefined,
  artifact: ProviderContinuationArtifact | undefined,
  requestPlan: RequestPlan,
  sameToolLoop: boolean,
): Extract<AnthropicContentBlock, { type: 'thinking' | 'redacted_thinking' }> | null {
  const decision = decideContinuationReplay(artifact, requestPlan, { sameToolLoop });
  if (decision.action !== 'replay' || !artifact || artifact.carrier !== 'signed-content-block') return null;
  if (artifact.type === 'redacted_thinking') {
    return artifact.redactedContent ? { type: 'redacted_thinking', data: artifact.redactedContent } : null;
  }
  if (artifact.type !== 'thinking' || !text || !artifact.signature) return null;
  return { type: 'thinking', thinking: text, signature: artifact.signature };
}

function anthropicCacheControl(ttl: NonNullable<StreamOptions['promptCache']>['ttl']): {
  type: 'ephemeral';
  ttl: '5m' | '1h';
} {
  return { type: 'ephemeral', ttl: ttl === 'one-hour' ? '1h' : '5m' };
}

function toAnthropicTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}

function mapStopReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'end_turn':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'toolUse';
    case 'refusal':
      return 'refusal';
    case 'stop_sequence':
      return 'stop';
    default:
      return 'stop';
  }
}

function mergeAnthropicRequestHeaders(
  defaultHeaders: Readonly<Record<string, string>>,
  planHeaders: Readonly<Record<string, string>>,
): Record<string, string> {
  const merged = { ...defaultHeaders, ...planHeaders };
  const betaValues: string[] = [];
  for (const headers of [defaultHeaders, planHeaders]) {
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() !== 'anthropic-beta') continue;
      for (const beta of value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)) {
        if (!betaValues.includes(beta)) betaValues.push(beta);
      }
    }
  }
  for (const name of Object.keys(merged)) {
    if (name.toLowerCase() === 'anthropic-beta') delete merged[name];
  }
  if (betaValues.length > 0) merged['anthropic-beta'] = betaValues.join(',');
  return merged;
}

export { mapStopReason, mergeAnthropicRequestHeaders, toAnthropicMessages };
