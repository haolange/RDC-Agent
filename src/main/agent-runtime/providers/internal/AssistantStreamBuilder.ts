import type { EventStream } from '../../core/EventStream';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  StopReason,
  TextContent,
  ThinkingContent,
  ToolCall,
  Usage,
} from '../../core/types';
import {
  appendThinkingText,
  createThinkingContent,
  getThinkingText,
  mergeThinkingContent,
  type ThinkingContentInput,
} from '../../reasoning/ReasoningArtifacts';

type Block =
  | { kind: 'text'; index: number; text: string; closed: boolean }
  | { kind: 'thinking'; index: number; thinking: ThinkingContent; closed: boolean }
  | {
      kind: 'tool';
      index: number;
      id: string;
      name: string;
      argsBuffer: string;
      closed: boolean;
    };

const EMPTY_USAGE: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

export class AssistantStreamBuilder {
  private readonly stream: EventStream<AssistantMessageEvent, AssistantMessage>;
  private readonly blocks: Block[] = [];
  private readonly modelId: string;
  private readonly providerId: string;
  private usage: Usage = { ...EMPTY_USAGE };
  private started = false;
  private finished = false;

  constructor(
    stream: EventStream<AssistantMessageEvent, AssistantMessage>,
    modelId: string,
    providerId: string,
  ) {
    this.stream = stream;
    this.modelId = modelId;
    this.providerId = providerId;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stream.push({ type: 'start', partial: this.snapshot('stop') });
  }

  appendText(index: number, delta: string): void {
    if (!delta) return;
    let block = this.blocks[index] as Block | undefined;
    if (!block || block.kind !== 'text') {
      block = { kind: 'text', index, text: '', closed: false };
      this.blocks[index] = block;
      this.stream.push({
        type: 'text_start',
        contentIndex: index,
        partial: this.snapshot('stop'),
      });
    }
    block.text += delta;
    this.stream.push({
      type: 'text_delta',
      contentIndex: index,
      delta,
      partial: this.snapshot('stop'),
    });
  }

  endText(index: number): void {
    const block = this.blocks[index];
    if (!block || block.kind !== 'text' || block.closed) return;
    block.closed = true;
    this.stream.push({
      type: 'text_end',
      contentIndex: index,
      content: block.text,
      partial: this.snapshot('stop'),
    });
  }

  ensureThinking(index: number, input: ThinkingContentInput = {}): ThinkingContent {
    let block = this.blocks[index] as Block | undefined;
    if (!block || block.kind !== 'thinking') {
      const thinking = createThinkingContent(input);
      block = { kind: 'thinking', index, thinking, closed: false };
      this.blocks[index] = block;
      this.stream.push({
        type: 'thinking_start',
        contentIndex: index,
        thinking,
        partial: this.snapshot('stop'),
      });
      return thinking;
    }
    if (Object.keys(input).length > 0) {
      block.thinking = mergeThinkingContent(block.thinking, input);
    }
    return block.thinking;
  }

  appendThinking(index: number, delta: string, input: ThinkingContentInput = {}): void {
    if (!delta) return;
    let thinking = this.ensureThinking(index, input);
    const block = this.blocks[index];
    if (!block || block.kind !== 'thinking') return;
    thinking = appendThinkingText(thinking, delta);
    block.thinking = thinking;
    this.stream.push({
      type: 'thinking_delta',
      contentIndex: index,
      delta,
      thinking,
      partial: this.snapshot('stop'),
    });
  }

  updateThinking(index: number, input: ThinkingContentInput): void {
    this.ensureThinking(index, input);
  }

  endThinking(index: number, input: ThinkingContentInput = {}): void {
    const block = this.blocks[index];
    if (!block || block.kind !== 'thinking' || block.closed) return;
    if (Object.keys(input).length > 0) {
      block.thinking = mergeThinkingContent(block.thinking, input);
    }
    block.closed = true;
    this.stream.push({
      type: 'thinking_end',
      contentIndex: index,
      content: getThinkingText(block.thinking),
      thinking: block.thinking,
      partial: this.snapshot('stop'),
    });
  }

  ensureToolCall(index: number, id: string, name: string): void {
    let block = this.blocks[index] as Block | undefined;
    if (!block || block.kind !== 'tool') {
      block = {
        kind: 'tool',
        index,
        id: id || `call_${index}`,
        name: name || '',
        argsBuffer: '',
        closed: false,
      };
      this.blocks[index] = block;
      this.stream.push({
        type: 'toolcall_start',
        contentIndex: index,
        partial: this.snapshot('stop'),
      });
    } else {
      if (id && block.id.startsWith('call_')) {
        block.id = id;
      }
      if (name && !block.name) {
        block.name = name;
      }
    }
  }

  appendToolCallArgs(index: number, delta: string): void {
    if (!delta) return;
    const block = this.blocks[index];
    if (!block || block.kind !== 'tool') return;
    block.argsBuffer += delta;
    this.stream.push({
      type: 'toolcall_delta',
      contentIndex: index,
      delta,
      partial: this.snapshot('stop'),
    });
  }

  endToolCall(index: number): void {
    const block = this.blocks[index];
    if (!block || block.kind !== 'tool' || block.closed) return;
    block.closed = true;
    const toolCall: ToolCall = {
      type: 'toolCall',
      id: block.id,
      name: block.name,
      arguments: parseJsonSafely(block.argsBuffer),
    };
    this.stream.push({
      type: 'toolcall_end',
      contentIndex: index,
      toolCall,
      partial: this.snapshot('stop'),
    });
  }

  setUsage(partial: Partial<Usage>): void {
    this.usage = {
      inputTokens: partial.inputTokens ?? this.usage.inputTokens,
      outputTokens: partial.outputTokens ?? this.usage.outputTokens,
      totalTokens:
        partial.totalTokens
        ?? (partial.inputTokens ?? this.usage.inputTokens)
          + (partial.outputTokens ?? this.usage.outputTokens),
      cost: partial.cost ?? this.usage.cost,
      cacheReadTokens: partial.cacheReadTokens ?? this.usage.cacheReadTokens,
      cacheWriteTokens: partial.cacheWriteTokens ?? this.usage.cacheWriteTokens,
      reasoningTokens: partial.reasoningTokens ?? this.usage.reasoningTokens,
    };
  }

  done(reason: StopReason): void {
    if (this.finished) return;
    this.finished = true;
    for (let i = 0; i < this.blocks.length; i += 1) {
      const block = this.blocks[i];
      if (!block || block.closed) continue;
      if (block.kind === 'text') this.endText(i);
      else if (block.kind === 'thinking') this.endThinking(i);
      else this.endToolCall(i);
    }
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

  private snapshot(reason: StopReason): AssistantMessage {
    const content: AssistantMessage['content'] = [];
    for (const block of this.blocks) {
      if (!block) continue;
      if (block.kind === 'text') {
        const item: TextContent = { type: 'text', text: block.text };
        content.push(item);
      } else if (block.kind === 'thinking') {
        const item: ThinkingContent = block.thinking;
        content.push(item);
      } else {
        const item: ToolCall = {
          type: 'toolCall',
          id: block.id,
          name: block.name,
          arguments: parseJsonSafely(block.argsBuffer),
        };
        content.push(item);
      }
    }
    return {
      role: 'assistant',
      content,
      model: this.modelId,
      provider: this.providerId,
      usage: { ...this.usage },
      stopReason: reason,
      timestamp: Date.now(),
    };
  }
}

function parseJsonSafely(raw: string): Record<string, unknown> {
  if (!raw || !raw.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { _raw: raw };
  }
}