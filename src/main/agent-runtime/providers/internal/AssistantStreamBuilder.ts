/**
 * Provider 内部共用：流式 AssistantMessage 状态机。
 *
 * 多个 Provider 在解析 SSE/NDJSON 时，需要按 contentIndex 维护
 * 「文本 / 思考 / 工具调用」三种内容块的逐步累积状态。把这部分逻辑集中到
 * 一个小型状态机里，避免每个 Provider 重复实现。
 */

import type {
  AssistantMessage,
  AssistantMessageEvent,
  StopReason,
  TextContent,
  ThinkingContent,
  ToolCall,
  Usage,
} from '../../core/types';
import type { EventStream } from '../../core/EventStream';

type Block =
  | { kind: 'text'; index: number; text: string; closed: boolean }
  | { kind: 'thinking'; index: number; text: string; closed: boolean }
  | {
      kind: 'tool';
      index: number;
      id: string;
      name: string;
      argsBuffer: string;
      closed: boolean;
    };

const EMPTY_USAGE: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

/**
 * 累积助手消息流式事件，并维护 `partial` 快照。
 *
 * 用法：
 * 1. 在 Provider 收到第一个事件前调用 `start()`；
 * 2. 收到增量时调用对应的 `text/thinking/toolCall` 方法，会自动 push 事件到 stream；
 * 3. 流结束时调用 `done(stopReason)` 完成 stream。
 */
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

  /** 推送 `start` 事件并初始化 partial。 */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.stream.push({ type: 'start', partial: this.snapshot('stop') });
  }

  /** 累积一段文本到指定 contentIndex；首次出现会自动发 `text_start`。 */
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

  /** 显式结束某个文本块，发 `text_end` 事件。 */
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

  /** 累积一段 thinking。 */
  appendThinking(index: number, delta: string): void {
    if (!delta) return;
    let block = this.blocks[index] as Block | undefined;
    if (!block || block.kind !== 'thinking') {
      block = { kind: 'thinking', index, text: '', closed: false };
      this.blocks[index] = block;
      this.stream.push({
        type: 'thinking_start',
        contentIndex: index,
        partial: this.snapshot('stop'),
      });
    }
    block.text += delta;
    this.stream.push({
      type: 'thinking_delta',
      contentIndex: index,
      delta,
      partial: this.snapshot('stop'),
    });
  }

  endThinking(index: number): void {
    const block = this.blocks[index];
    if (!block || block.kind !== 'thinking' || block.closed) return;
    block.closed = true;
    this.stream.push({
      type: 'thinking_end',
      contentIndex: index,
      content: block.text,
      partial: this.snapshot('stop'),
    });
  }

  /** 初始化或更新一个 tool_call 块（不发 delta）。 */
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
      if (id && !block.id.startsWith('call_')) {
        // 保留首个真实 id；否则覆盖为新提供的 id。
      } else if (id) {
        block.id = id;
      }
      if (name && !block.name) {
        block.name = name;
      }
    }
  }

  /** 累积一段 tool_call 参数（原始 JSON 字符串增量）。 */
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

  /** 结束 tool_call，解析 args，发 `toolcall_end`。 */
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

  /** 设置或合并 usage 信息。 */
  setUsage(partial: Partial<Usage>): void {
    this.usage = {
      inputTokens: partial.inputTokens ?? this.usage.inputTokens,
      outputTokens: partial.outputTokens ?? this.usage.outputTokens,
      totalTokens:
        partial.totalTokens
        ?? (partial.inputTokens ?? this.usage.inputTokens)
          + (partial.outputTokens ?? this.usage.outputTokens),
      cost: partial.cost ?? this.usage.cost,
    };
  }

  /** 完成流：关闭所有未关闭块，推 `done` 事件并 complete。 */
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

  /** 标记错误：推 `error` 事件，并以错误结束 stream。 */
  fail(error: Error, reason: StopReason = 'error'): void {
    if (this.finished) return;
    this.finished = true;
    const message = this.snapshot(reason);
    this.stream.push({ type: 'error', error, message });
    this.stream.error(error);
  }

  /** 是否已经结束。 */
  get isFinished(): boolean {
    return this.finished;
  }

  // -----------------------------------------------------------------
  // 内部
  // -----------------------------------------------------------------

  private snapshot(reason: StopReason): AssistantMessage {
    const content: AssistantMessage['content'] = [];
    for (const block of this.blocks) {
      if (!block) continue;
      if (block.kind === 'text') {
        const item: TextContent = { type: 'text', text: block.text };
        content.push(item);
      } else if (block.kind === 'thinking') {
        const item: ThinkingContent = { type: 'thinking', thinking: block.text };
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
    // 流式过程中 args 可能尚未拼成合法 JSON，对 partial 快照来说返回原始串即可。
    return { _raw: raw };
  }
}
