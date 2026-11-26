import { z, type ZodType } from 'zod';
import { AppError } from '@shared/errors/appError';
import {
  appendThinkingText,
  createThinkingContent,
  getThinkingText,
  mergeThinkingContent,
  type ThinkingContentInput,
} from '../../reasoning/ReasoningArtifacts';
import { ProviderEmptyStreamError } from './http';
import type { EventStream } from '../../core/EventStream';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  ProviderOutputRef,
  ProviderStateRef,
  StopReason,
  TextContent,
  ThinkingContent,
  ToolCallContent,
  Usage,
} from '../../core/types';

type BlockKind = 'text' | 'thinking' | 'tool_call';

type Block =
  | { kind: 'text'; ref: ProviderOutputRef; text: string; phase?: TextContent['phase']; closed: boolean }
  | { kind: 'thinking'; ref: ProviderOutputRef; thinking: ThinkingContent; closed: boolean }
  | {
      kind: 'tool_call';
      ref: ProviderOutputRef;
      id: string;
      name: string;
      argsBuffer: string;
      closed: boolean;
    };

export type ProviderStreamDiagnosticCode =
  | 'PROVIDER_STREAM_CHANNEL_COLLISION'
  | 'PROVIDER_STREAM_DELTA_BEFORE_START'
  | 'PROVIDER_STREAM_DUPLICATE_BLOCK_START'
  | 'PROVIDER_STREAM_BLOCK_CLOSED'
  | 'PROVIDER_STREAM_EVENT_AFTER_TERMINAL'
  | 'PROVIDER_STREAM_TRUNCATED'
  | 'PROVIDER_STREAM_MALFORMED_FRAME';

export class ProviderStreamProtocolError extends AppError {
  declare readonly code: ProviderStreamDiagnosticCode;
  readonly outputRef: ProviderOutputRef;

  constructor(code: ProviderStreamDiagnosticCode, ref: ProviderOutputRef, message: string) {
    super(code, message);
    this.name = 'ProviderStreamProtocolError';
    this.outputRef = { ...ref };
  }
}

const EMPTY_USAGE: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

const TERMINAL_REF = Object.freeze({ protocol: 'provider-terminal', providerBlockKey: 'done', contentIndex: 0 });

/**
 * Parses one wire frame against the adapter's frame schema. A frame that is not JSON, or not a frame of the
 * adapter's protocol, is a protocol violation, never a frame to skip.
 */
export function parseProviderFrame<T>(data: string, providerApi: string, schema: ZodType<T>): T {
  const ref = { protocol: providerApi, providerBlockKey: 'frame', contentIndex: 0 };
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new ProviderStreamProtocolError(
      'PROVIDER_STREAM_MALFORMED_FRAME',
      ref,
      `${providerApi} sent a stream frame that is not valid JSON.`,
    );
  }
  const frame = schema.safeParse(value);
  if (!frame.success) {
    throw new ProviderStreamProtocolError(
      'PROVIDER_STREAM_MALFORMED_FRAME',
      ref,
      `${providerApi} sent a stream frame that does not match its protocol: ${z.prettifyError(frame.error)}`,
    );
  }
  return frame.data;
}

/**
 * The frame of an event type an adapter does not handle. Such frames are ignored, as the adapter's switch always
 * did; a frame of a handled type that does not match its schema is still a protocol violation.
 */
export function unhandledProviderEvent(handledTypes: readonly string[]) {
  return z
    .object({ type: z.string().refine((type) => !handledTypes.includes(type)) })
    .transform(() => ({ type: 'unhandled' as const }));
}

export function createProviderOutputRef(input: ProviderOutputRef): ProviderOutputRef {
  if (!input.protocol.trim() || !input.providerBlockKey.trim()) {
    throw new Error('ProviderOutputRef requires protocol and providerBlockKey.');
  }
  if (!Number.isInteger(input.contentIndex) || input.contentIndex < 0) {
    throw new Error('ProviderOutputRef contentIndex must be a non-negative integer.');
  }
  return Object.freeze({ ...input });
}

function outputRefKey(ref: ProviderOutputRef): string {
  return [ref.protocol, ref.responseId ?? '', ref.providerBlockKey, ref.sourceIndex ?? '', ref.itemId ?? ''].join(
    '\u0000',
  );
}

export class AssistantStreamBuilder {
  private readonly stream: EventStream<AssistantMessageEvent, AssistantMessage>;
  private readonly blocks = new Map<string, Block>();
  private readonly orderedBlockKeys: string[] = [];
  private readonly contentIndexOwners = new Map<number, string>();
  private readonly modelId: string;
  private readonly providerId: string;
  private usage: Usage = { ...EMPTY_USAGE };
  private providerState: ProviderStateRef | undefined;
  private execution: AssistantMessage['execution'];
  private started = false;
  private finished = false;
  private terminalReason: StopReason | null = null;

  constructor(stream: EventStream<AssistantMessageEvent, AssistantMessage>, modelId: string, providerId: string) {
    this.stream = stream;
    this.modelId = modelId;
    this.providerId = providerId;
  }

  start(): void {
    if (this.finished) {
      throw new Error('Cannot start a provider stream after its terminal event.');
    }
    if (this.started) return;
    this.started = true;
    this.stream.push({ type: 'start', partial: this.snapshot('stop') });
  }

  startText(ref: ProviderOutputRef, phase?: TextContent['phase']): void {
    this.claim(ref, 'text', {
      kind: 'text',
      ref,
      text: '',
      phase,
      closed: false,
    });
    this.stream.push({
      type: 'text_start',
      contentIndex: ref.contentIndex,
      providerOutputRef: { ...ref },
      partial: this.snapshot('stop'),
    });
  }

  appendText(ref: ProviderOutputRef, delta: string): void {
    if (!delta) return;
    const block = this.requireOpenBlock(ref, 'text', 'delta');
    block.text += delta;
    this.stream.push({
      type: 'text_delta',
      contentIndex: ref.contentIndex,
      delta,
      phase: block.phase,
      providerOutputRef: { ...ref },
      partial: this.snapshot('stop'),
    });
  }

  endText(ref: ProviderOutputRef): void {
    const block = this.requireOpenBlock(ref, 'text', 'end');
    this.closeBlock(block);
  }

  updateTextPhase(ref: ProviderOutputRef, phase: NonNullable<TextContent['phase']>): void {
    const block = this.requireOpenBlock(ref, 'text', 'update');
    if (block.phase && block.phase !== phase)
      throw new Error(`Provider changed text phase for ${ref.providerBlockKey}.`);
    block.phase = phase;
  }

  startThinking(ref: ProviderOutputRef, input: ThinkingContentInput = {}): void {
    const thinking: ThinkingContent = {
      ...createThinkingContent(input),
      providerOutputRef: { ...ref },
    };
    this.claim(ref, 'thinking', {
      kind: 'thinking',
      ref,
      thinking,
      closed: false,
    });
    this.stream.push({
      type: 'thinking_start',
      contentIndex: ref.contentIndex,
      providerOutputRef: { ...ref },
      thinking,
      partial: this.snapshot('stop'),
    });
  }

  appendThinking(ref: ProviderOutputRef, delta: string, input: ThinkingContentInput = {}): void {
    if (!delta) return;
    const block = this.requireOpenBlock(ref, 'thinking', 'delta');
    if (Object.keys(input).length > 0) {
      block.thinking = mergeThinkingContent(block.thinking, input);
    }
    block.thinking = appendThinkingText(block.thinking, delta);
    this.stream.push({
      type: 'thinking_delta',
      contentIndex: ref.contentIndex,
      delta,
      providerOutputRef: { ...ref },
      thinking: block.thinking,
      partial: this.snapshot('stop'),
    });
  }

  updateThinking(ref: ProviderOutputRef, input: ThinkingContentInput): void {
    const block = this.requireOpenBlock(ref, 'thinking', 'update');
    block.thinking = mergeThinkingContent(block.thinking, input);
  }

  endThinking(ref: ProviderOutputRef, input: ThinkingContentInput = {}): void {
    const block = this.requireOpenBlock(ref, 'thinking', 'end');
    if (Object.keys(input).length > 0) {
      block.thinking = mergeThinkingContent(block.thinking, input);
    }
    this.closeBlock(block);
  }

  startToolCall(ref: ProviderOutputRef, id: string, name: string): void {
    this.claim(ref, 'tool_call', {
      kind: 'tool_call',
      ref,
      id: id || `call_${ref.contentIndex}`,
      name: name || '',
      argsBuffer: '',
      closed: false,
    });
    this.stream.push({
      type: 'toolcall_start',
      contentIndex: ref.contentIndex,
      providerOutputRef: { ...ref },
      partial: this.snapshot('stop'),
    });
  }

  updateToolCall(ref: ProviderOutputRef, id: string, name: string): void {
    const block = this.requireOpenBlock(ref, 'tool_call', 'update');
    if (id && block.id.startsWith('call_')) block.id = id;
    if (name && !block.name) block.name = name;
  }

  appendToolCallArgs(ref: ProviderOutputRef, delta: string): void {
    if (!delta) return;
    const block = this.requireOpenBlock(ref, 'tool_call', 'delta');
    block.argsBuffer += delta;
    this.stream.push({
      type: 'toolcall_delta',
      contentIndex: ref.contentIndex,
      delta,
      providerOutputRef: { ...ref },
      partial: this.snapshot('stop'),
    });
  }

  endToolCall(ref: ProviderOutputRef): void {
    const block = this.requireOpenBlock(ref, 'tool_call', 'end');
    this.closeBlock(block);
  }

  setProviderState(state: ProviderStateRef): void {
    this.assertSemanticEvent({
      protocol: 'provider-state',
      providerBlockKey: state.carrier,
      contentIndex: 0,
    });
    this.providerState = {
      ...state,
      origin: { ...state.origin, bindingIds: [...state.origin.bindingIds] },
    };
  }

  setExecution(execution: NonNullable<AssistantMessage['execution']>): void {
    this.execution = { ...this.execution, ...execution };
  }

  setUsage(partial: Partial<Usage>): void {
    this.assertSemanticEvent({
      protocol: 'provider-usage',
      providerBlockKey: 'usage',
      contentIndex: 0,
    });
    this.usage = {
      inputTokens: partial.inputTokens ?? this.usage.inputTokens,
      outputTokens: partial.outputTokens ?? this.usage.outputTokens,
      totalTokens:
        partial.totalTokens ??
        (partial.inputTokens ?? this.usage.inputTokens) + (partial.outputTokens ?? this.usage.outputTokens),
      cost: partial.cost ?? this.usage.cost,
      cacheReadTokens: partial.cacheReadTokens ?? this.usage.cacheReadTokens,
      cacheWriteTokens: partial.cacheWriteTokens ?? this.usage.cacheWriteTokens,
      cacheWriteLongTokens: partial.cacheWriteLongTokens ?? this.usage.cacheWriteLongTokens,
      cacheHitTokens: partial.cacheHitTokens ?? this.usage.cacheHitTokens,
      cacheMissTokens: partial.cacheMissTokens ?? this.usage.cacheMissTokens,
      reasoningTokens: partial.reasoningTokens ?? this.usage.reasoningTokens,
      speed: partial.speed ?? this.usage.speed,
    };
  }

  /** Records the provider's own end-of-message signal and the stop reason it carried. */
  markTerminal(reason: StopReason): void {
    this.terminalReason = reason;
  }

  /**
   * Ends a stream whose transport has closed. Only a stream that delivered output and its terminal signal completes;
   * an aborted read reports the abort, a silent one is empty, and output without a terminal signal is truncated.
   */
  finish(context: { signal: AbortSignal; sawOutput: boolean; providerApi: string }): void {
    if (context.signal.aborted) throw new DOMException('The provider stream was aborted.', 'AbortError');
    if (!context.sawOutput) throw new ProviderEmptyStreamError(context.providerApi);
    if (this.terminalReason === null) {
      throw new ProviderStreamProtocolError(
        'PROVIDER_STREAM_TRUNCATED',
        TERMINAL_REF,
        `${context.providerApi} stream ended without its terminal event.`,
      );
    }
    this.complete(this.terminalReason);
  }

  private complete(reason: StopReason): void {
    this.assertSemanticEvent(TERMINAL_REF);
    for (const key of this.orderedBlockKeys) {
      const block = this.blocks.get(key);
      if (block && !block.closed) this.closeBlock(block);
    }
    this.finished = true;
    const message = this.snapshot(reason);
    this.stream.push({ type: 'done', reason, message });
  }

  fail(error: Error, reason: StopReason = 'error'): void {
    if (this.finished) return;
    this.finished = true;
    const message = this.snapshot(reason);
    this.stream.push({ type: 'error', error, message });
    this.stream.error(error);
  }

  get isFinished(): boolean {
    return this.finished;
  }

  private assertSemanticEvent(ref: ProviderOutputRef): void {
    if (this.finished) {
      throw new ProviderStreamProtocolError(
        'PROVIDER_STREAM_EVENT_AFTER_TERMINAL',
        ref,
        `Provider emitted a semantic event after terminal for ${ref.providerBlockKey}.`,
      );
    }
    if (!this.started) {
      throw new Error('Provider stream blocks cannot be emitted before stream start.');
    }
  }

  private claim<T extends Block>(ref: ProviderOutputRef, kind: BlockKind, block: T): T {
    this.assertSemanticEvent(ref);
    const key = outputRefKey(ref);
    const existing = this.blocks.get(key);
    if (existing) {
      if (existing.kind !== kind) {
        throw new ProviderStreamProtocolError(
          'PROVIDER_STREAM_CHANNEL_COLLISION',
          ref,
          `Provider output source ${ref.providerBlockKey} changed channel from ${existing.kind} to ${kind}.`,
        );
      }
      throw new ProviderStreamProtocolError(
        'PROVIDER_STREAM_DUPLICATE_BLOCK_START',
        ref,
        `Provider output source ${ref.providerBlockKey} started more than once.`,
      );
    }
    const contentIndexOwner = this.contentIndexOwners.get(ref.contentIndex);
    if (contentIndexOwner && contentIndexOwner !== key) {
      throw new ProviderStreamProtocolError(
        'PROVIDER_STREAM_CHANNEL_COLLISION',
        ref,
        `Provider content index ${ref.contentIndex} was claimed by more than one source.`,
      );
    }
    this.blocks.set(key, block);
    this.orderedBlockKeys.push(key);
    this.contentIndexOwners.set(ref.contentIndex, key);
    return block;
  }

  private requireOpenBlock<K extends BlockKind>(
    ref: ProviderOutputRef,
    kind: K,
    operation: 'delta' | 'update' | 'end',
  ): Extract<Block, { kind: K }> {
    this.assertSemanticEvent(ref);
    const block = this.blocks.get(outputRefKey(ref));
    if (!block) {
      throw new ProviderStreamProtocolError(
        'PROVIDER_STREAM_DELTA_BEFORE_START',
        ref,
        `Provider emitted ${operation} before starting ${ref.providerBlockKey}.`,
      );
    }
    if (block.kind !== kind) {
      throw new ProviderStreamProtocolError(
        'PROVIDER_STREAM_CHANNEL_COLLISION',
        ref,
        `Provider output source ${ref.providerBlockKey} was declared as ${block.kind}, not ${kind}.`,
      );
    }
    if (block.closed) {
      throw new ProviderStreamProtocolError(
        'PROVIDER_STREAM_BLOCK_CLOSED',
        ref,
        `Provider emitted ${operation} after closing ${ref.providerBlockKey}.`,
      );
    }
    return block as Extract<Block, { kind: K }>;
  }

  private closeBlock(block: Block): void {
    block.closed = true;
    if (block.kind === 'text') {
      this.stream.push({
        type: 'text_end',
        contentIndex: block.ref.contentIndex,
        content: block.text,
        phase: block.phase,
        providerOutputRef: { ...block.ref },
        partial: this.snapshot('stop'),
      });
      return;
    }
    if (block.kind === 'thinking') {
      this.stream.push({
        type: 'thinking_end',
        contentIndex: block.ref.contentIndex,
        providerOutputRef: { ...block.ref },
        content: getThinkingText(block.thinking),
        thinking: block.thinking,
        partial: this.snapshot('stop'),
      });
      return;
    }
    const toolCall: ToolCallContent = {
      type: 'toolCall',
      id: block.id,
      name: block.name,
      ...toolCallArguments(block.argsBuffer),
      providerOutputRef: { ...block.ref },
    };
    this.stream.push({
      type: 'toolcall_end',
      contentIndex: block.ref.contentIndex,
      providerOutputRef: { ...block.ref },
      toolCall,
      partial: this.snapshot('stop'),
    });
  }

  private snapshot(reason: StopReason): AssistantMessage {
    const content: AssistantMessage['content'] = [];
    for (const key of this.orderedBlockKeys) {
      const block = this.blocks.get(key);
      if (!block) continue;
      if (block.kind === 'text') {
        const item: TextContent = {
          type: 'text',
          text: block.text,
          ...(block.phase ? { phase: block.phase } : {}),
          providerOutputRef: { ...block.ref },
        };
        content.push(item);
      } else if (block.kind === 'thinking') {
        content.push({
          ...block.thinking,
          providerOutputRef: { ...block.ref },
        });
      } else {
        content.push({
          type: 'toolCall',
          id: block.id,
          name: block.name,
          ...toolCallArguments(block.argsBuffer),
          providerOutputRef: { ...block.ref },
        });
      }
    }
    return {
      role: 'assistant',
      content,
      model: this.modelId,
      provider: this.providerId,
      usage: { ...this.usage },
      ...(this.execution ? { execution: { ...this.execution } } : {}),
      stopReason: reason,
      ...(this.providerState
        ? {
            providerState: {
              ...this.providerState,
              origin: {
                ...this.providerState.origin,
                bindingIds: [...this.providerState.origin.bindingIds],
              },
            },
          }
        : {}),
      timestamp: Date.now(),
    };
  }
}

/**
 * Arguments the model streamed for a tool call. Text that is not a JSON object stays visible as `invalidArguments`
 * so the executor can tell the model exactly that, instead of validating a fabricated object.
 */
function toolCallArguments(raw: string): Pick<ToolCallContent, 'arguments' | 'invalidArguments'> {
  if (!raw.trim()) return { arguments: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { arguments: parsed as Record<string, unknown> };
    }
  } catch {
    // Falls through: the text is reported as invalid arguments below.
  }
  return { arguments: {}, invalidArguments: raw };
}
