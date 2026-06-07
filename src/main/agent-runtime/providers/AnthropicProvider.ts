/**
 * Anthropic Messages API Provider。
 *
 * 协议要点：
 * - 端点：`POST {baseUrl}/messages`，`anthropic-version` header 必填。
 * - SSE 事件类型：`message_start` / `content_block_start` / `content_block_delta`
 *   / `content_block_stop` / `message_delta` / `message_stop` / `ping` / `error`。
 * - system 消息走顶层 `system` 字段，不放在 messages 数组里。
 * - 工具结果以 `tool_result` content block 形式作为 user 消息回传。
 */

import { EventStream } from '../core/EventStream';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Message,
  Model,
  ProviderCapabilities,
  StopReason,
  StreamOptions,
  ToolDefinition,
} from '../core/types';
import { AssistantStreamBuilder } from './internal/AssistantStreamBuilder';
import {
  composeAbortSignals,
  ensureOk,
  normalizeError,
  parseSSE,
  ProviderHttpError,
} from './internal/http';

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';
const PROVIDER_API = 'anthropic-messages';

interface AnthropicEventBase {
  type: string;
}

interface AnthropicContentBlockStart extends AnthropicEventBase {
  type: 'content_block_start';
  index: number;
  content_block:
    | { type: 'text'; text?: string }
    | { type: 'thinking'; thinking?: string }
    | { type: 'tool_use'; id: string; name: string; input?: unknown };
}

interface AnthropicContentBlockDelta extends AnthropicEventBase {
  type: 'content_block_delta';
  index: number;
  delta:
    | { type: 'text_delta'; text: string }
    | { type: 'thinking_delta'; thinking: string }
    | { type: 'input_json_delta'; partial_json: string };
}

interface AnthropicContentBlockStop extends AnthropicEventBase {
  type: 'content_block_stop';
  index: number;
}

interface AnthropicMessageDelta extends AnthropicEventBase {
  type: 'message_delta';
  delta: { stop_reason?: string | null };
  usage?: { output_tokens?: number };
}

interface AnthropicMessageStart extends AnthropicEventBase {
  type: 'message_start';
  message: {
    usage?: { input_tokens?: number; output_tokens?: number };
  };
}

interface AnthropicErrorEvent extends AnthropicEventBase {
  type: 'error';
  error: { type: string; message: string };
}

export interface AnthropicProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  anthropicVersion?: string;
  headers?: Record<string, string>;
  capabilities?: Partial<ProviderCapabilities>;
}

export class AnthropicProvider implements ProviderStrategy {
  readonly api = PROVIDER_API;
  private readonly defaultBaseUrl: string;
  private readonly defaultApiKey: string | undefined;
  private readonly anthropicVersion: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly capabilities: ProviderCapabilities;

  constructor(options: AnthropicProviderOptions = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.defaultApiKey = options.apiKey;
    this.anthropicVersion = options.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION;
    this.defaultHeaders = { ...(options.headers ?? {}) };
    this.capabilities = {
      streaming: true,
      nativeToolCalling: true,
      structuredOutput: false,
      vision: true,
      reasoning: true,
      parallelToolCalls: true,
      ...(options.capabilities ?? {}),
    };
  }

  getCapabilities(): ProviderCapabilities {
    return { ...this.capabilities };
  }

  stream(
    model: Model,
    context: Context,
    options: StreamOptions = {},
  ): EventStream<AssistantMessageEvent, AssistantMessage> {
    const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
      (event) => event.type === 'done',
      (event) => (event as Extract<AssistantMessageEvent, { type: 'done' }>).message,
    );
    const builder = new AssistantStreamBuilder(stream, model.id, model.provider);

    const baseUrl = (options.baseUrl ?? this.defaultBaseUrl).replace(/\/+$/, '');
    const apiKey = options.apiKey ?? this.defaultApiKey;

    void this.run(stream, builder, model, context, options, baseUrl, apiKey);
    return stream;
  }

  private async run(
    stream: EventStream<AssistantMessageEvent, AssistantMessage>,
    builder: AssistantStreamBuilder,
    model: Model,
    context: Context,
    options: StreamOptions,
    baseUrl: string,
    apiKey: string | undefined,
  ): Promise<void> {
    const composed = composeAbortSignals(options.signal, stream.signal);

    try {
      builder.start();

      if (!apiKey) {
        throw new ProviderHttpError(PROVIDER_API, 401, 'missing apiKey for Anthropic provider');
      }

      const body = this.buildRequestBody(model, context, options);
      const url = `${baseUrl}/messages`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': this.anthropicVersion,
          ...this.defaultHeaders,
        },
        body: JSON.stringify(body),
        signal: composed.signal,
      });

      await ensureOk(response, PROVIDER_API);

      // Anthropic SSE 每个事件含 `event:` 与 `data:` 两行，parseSSE 只 yield data 行。
      // 我们额外通过 type 字段识别事件类型。
      let stopReason: string | null = null;
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const data of parseSSE(response, composed.signal)) {
        if (composed.signal.aborted) break;
        let event: AnthropicEventBase;
        try {
          event = JSON.parse(data) as AnthropicEventBase;
        } catch {
          continue;
        }

        switch (event.type) {
          case 'message_start': {
            const evt = event as AnthropicMessageStart;
            inputTokens = evt.message.usage?.input_tokens ?? inputTokens;
            outputTokens = evt.message.usage?.output_tokens ?? outputTokens;
            builder.setUsage({ inputTokens, outputTokens });
            break;
          }
          case 'content_block_start': {
            const evt = event as AnthropicContentBlockStart;
            const block = evt.content_block;
            if (block.type === 'text') {
              if (block.text) builder.appendText(evt.index, block.text);
              // 空 text 块在后续 delta 到达时会自动创建。
            } else if (block.type === 'thinking') {
              if (block.thinking) builder.appendThinking(evt.index, block.thinking);
            } else if (block.type === 'tool_use') {
              builder.ensureToolCall(evt.index, block.id, block.name);
              if (block.input && typeof block.input === 'object' && Object.keys(block.input as Record<string, unknown>).length > 0) {
                builder.appendToolCallArgs(evt.index, JSON.stringify(block.input));
              }
            }
            break;
          }
          case 'content_block_delta': {
            const evt = event as AnthropicContentBlockDelta;
            if (evt.delta.type === 'text_delta') {
              builder.appendText(evt.index, evt.delta.text);
            } else if (evt.delta.type === 'thinking_delta') {
              builder.appendThinking(evt.index, evt.delta.thinking);
            } else if (evt.delta.type === 'input_json_delta') {
              builder.appendToolCallArgs(evt.index, evt.delta.partial_json);
            }
            break;
          }
          case 'content_block_stop': {
            const evt = event as AnthropicContentBlockStop;
            // builder 会在 done() 时关闭未关闭的块；这里依赖 type 维度自我标记。
            // 但若同一 index 有多个 content block 类型，需主动 end 当前。
            builder.endText(evt.index);
            builder.endThinking(evt.index);
            builder.endToolCall(evt.index);
            break;
          }
          case 'message_delta': {
            const evt = event as AnthropicMessageDelta;
            if (evt.delta.stop_reason) stopReason = evt.delta.stop_reason;
            if (typeof evt.usage?.output_tokens === 'number') {
              outputTokens = evt.usage.output_tokens;
              builder.setUsage({ inputTokens, outputTokens });
            }
            break;
          }
          case 'message_stop': {
            // 流结束在循环外统一处理。
            break;
          }
          case 'error': {
            const evt = event as AnthropicErrorEvent;
            throw new Error(`anthropic ${evt.error.type}: ${evt.error.message}`);
          }
          default:
            // ping 等其它事件忽略。
            break;
        }
      }

      builder.done(mapStopReason(stopReason));
    } catch (err) {
      const error = normalizeError(err);
      builder.fail(error, error.name === 'AbortError' ? 'aborted' : 'error');
    } finally {
      composed.dispose();
    }
  }

  private buildRequestBody(
    model: Model,
    context: Context,
    options: StreamOptions,
  ): Record<string, unknown> {
    const { system, messages } = toAnthropicMessages(context);
    const body: Record<string, unknown> = {
      model: model.id,
      messages,
      stream: true,
      max_tokens: options.maxTokens ?? model.maxTokens ?? 4096,
    };
    if (system) body.system = system;
    if (typeof options.temperature === 'number') body.temperature = options.temperature;
    if (typeof options.topP === 'number') body.top_p = options.topP;
    if (context.tools && context.tools.length > 0) {
      body.tools = context.tools.map(toAnthropicTool);
    }
    return body;
  }
}

// =====================================================================
// 转换辅助
// =====================================================================

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
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

function toAnthropicMessages(context: Context): {
  system?: string;
  messages: AnthropicMessage[];
} {
  const messages: AnthropicMessage[] = [];
  for (const message of context.messages) {
    messages.push(...convertMessage(message));
  }
  return {
    system: context.systemPrompt && context.systemPrompt.trim() ? context.systemPrompt : undefined,
    messages,
  };
}

function convertMessage(message: Message): AnthropicMessage[] {
  if (message.role === 'user') {
    if (typeof message.content === 'string') {
      return [{ role: 'user', content: [{ type: 'text', text: message.content }] }];
    }
    const blocks: AnthropicContentBlock[] = [];
    for (const block of message.content) {
      if (block.type === 'text') {
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
      if (block.type === 'text') {
        blocks.push({ type: 'text', text: block.text });
      } else if (block.type === 'toolCall') {
        blocks.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.arguments ?? {},
        });
      }
      // thinking 块不回放给 Anthropic（属于内部状态）。
    }
    return [{ role: 'assistant', content: blocks }];
  }

  // toolResult -> 作为 user 消息中的 tool_result 块
  const textBlocks: Array<{ type: 'text'; text: string }> = [];
  for (const block of message.content) {
    if (block.type === 'text') textBlocks.push({ type: 'text', text: block.text });
  }
  return [
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: message.toolCallId,
          content: textBlocks,
          is_error: message.isError || undefined,
        },
      ],
    },
  ];
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
    case 'stop_sequence':
      return 'stop';
    default:
      return 'stop';
  }
}

export const __testing = { mapStopReason, toAnthropicMessages };
