/**
 * Ollama 本地 Provider —— 适配 `POST /api/chat` 端点。
 *
 * 协议要点：
 * - 默认 baseUrl：`http://localhost:11434`。
 * - 响应是 NDJSON（每行一个 JSON 对象），不是 SSE。
 * - 每个 chunk 形如：
 *   `{ model, message: { role: 'assistant', content, tool_calls? }, done, done_reason?, eval_count?, ... }`
 * - 工具调用支持依赖 Ollama 较新版本（>=0.3.x）；不支持时不会出现 `tool_calls`。
 * - 不需要 API key，但允许通过自定义 baseUrl 指向远端实例。
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
  parseJsonLines,
  ProviderHttpError,
} from './internal/http';

const DEFAULT_BASE_URL = 'http://localhost:11434';
const PROVIDER_API = 'ollama';

interface OllamaToolCall {
  function?: {
    name?: string;
    arguments?: Record<string, unknown> | string;
  };
}

interface OllamaChunk {
  model?: string;
  message?: {
    role?: string;
    content?: string;
    thinking?: string;
    tool_calls?: OllamaToolCall[];
  };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
}

export interface OllamaProviderOptions {
  baseUrl?: string;
  /** Ollama 默认无需 apiKey，但允许在反代场景下注入 Bearer。 */
  apiKey?: string;
  headers?: Record<string, string>;
  capabilities?: Partial<ProviderCapabilities>;
}

export class OllamaProvider implements ProviderStrategy {
  readonly api = PROVIDER_API;
  private readonly defaultBaseUrl: string;
  private readonly defaultApiKey: string | undefined;
  private readonly defaultHeaders: Record<string, string>;
  private readonly capabilities: ProviderCapabilities;

  constructor(options: OllamaProviderOptions = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.defaultApiKey = options.apiKey;
    this.defaultHeaders = { ...(options.headers ?? {}) };
    this.capabilities = {
      streaming: true,
      nativeToolCalling: true,
      structuredOutput: true,
      vision: false,
      reasoning: false,
      parallelToolCalls: false,
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
    const composed = composeAbortSignals(options.signal, stream.signal, { providerApi: PROVIDER_API, ...options });

    try {
      builder.start();

      const body = this.buildRequestBody(model, context, options);
      const url = `${baseUrl}/api/chat`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...this.defaultHeaders,
      };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: composed.signal,
      });

      await ensureOk(response, PROVIDER_API);

      const TEXT_INDEX = 0;
      const THINKING_INDEX = 1;
      let toolCallCounter = 0;
      let doneReason: string | null = null;
      let lastChunk: OllamaChunk | null = null;
      let sawOutput = false;

      for await (const line of parseJsonLines(response, composed.signal, { providerApi: PROVIDER_API, ...options })) {
        if (composed.signal.aborted) break;
        let chunk: OllamaChunk;
        try {
          chunk = JSON.parse(line) as OllamaChunk;
        } catch {
          continue;
        }
        lastChunk = chunk;

        const message = chunk.message;
        if (message) {
          if (typeof message.thinking === 'string' && message.thinking.length > 0) {
            sawOutput = true;
            builder.appendThinking(THINKING_INDEX, message.thinking, {
              kind: 'raw',
              source: 'ollama-raw',
              visibility: 'raw-collapsed',
              replayPolicy: 'none',
            });
          }
          if (typeof message.content === 'string' && message.content.length > 0) {
            sawOutput = true;
            builder.appendText(TEXT_INDEX, message.content);
          }
          if (Array.isArray(message.tool_calls)) {
            for (const tc of message.tool_calls) {
              const fn = tc.function;
              if (!fn || !fn.name) continue;
              const slot = 2 + toolCallCounter;
              toolCallCounter += 1;
              const callId = `ollama-call-${Date.now()}-${slot}`;
              sawOutput = true;
              builder.ensureToolCall(slot, callId, fn.name);
              const argsRaw =
                typeof fn.arguments === 'string'
                  ? fn.arguments
                  : JSON.stringify(fn.arguments ?? {});
              builder.appendToolCallArgs(slot, argsRaw);
              builder.endToolCall(slot);
            }
          }
        }

        if (chunk.done) {
          doneReason = chunk.done_reason ?? 'stop';
          if (typeof chunk.prompt_eval_count === 'number' || typeof chunk.eval_count === 'number') {
            builder.setUsage({
              inputTokens: chunk.prompt_eval_count ?? 0,
              outputTokens: chunk.eval_count ?? 0,
              totalTokens: (chunk.prompt_eval_count ?? 0) + (chunk.eval_count ?? 0),
            });
          }
          break;
        }
      }

      // 防止上层未发 done：以最后一条 chunk 推断状态。
      if (!doneReason && lastChunk?.done_reason) {
        doneReason = lastChunk.done_reason;
      }

      if (!sawOutput) {
        throw new ProviderHttpError(PROVIDER_API, 502, 'Provider stream ended without assistant output or structured tool call.');
      }
      builder.done(mapDoneReason(doneReason, toolCallCounter > 0));
    } catch (err) {
      const thrown = normalizeError(err);
      const error = thrown.name === 'AbortError' && composed.signal.reason instanceof Error
        ? composed.signal.reason
        : thrown;
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
    const messages = toOllamaMessages(context);
    const body: Record<string, unknown> = {
      model: model.id,
      messages,
      stream: true,
    };

    const optionsBlock: Record<string, unknown> = {};
    if (typeof options.temperature === 'number') optionsBlock.temperature = options.temperature;
    if (typeof options.topP === 'number') optionsBlock.top_p = options.topP;
    if (typeof options.maxTokens === 'number') optionsBlock.num_predict = options.maxTokens;
    if (Object.keys(optionsBlock).length > 0) body.options = optionsBlock;

    if (context.tools && context.tools.length > 0) {
      body.tools = context.tools.map(toOllamaTool);
    }
    return body;
  }
}

// =====================================================================
// 转换辅助
// =====================================================================

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
  tool_calls?: Array<{
    function: { name: string; arguments: Record<string, unknown> };
  }>;
  tool_name?: string;
}

function toOllamaMessages(context: Context): OllamaMessage[] {
  const out: OllamaMessage[] = [];
  if (context.systemPrompt && context.systemPrompt.trim()) {
    out.push({ role: 'system', content: context.systemPrompt });
  }
  for (const message of context.messages) {
    out.push(...convertMessage(message));
  }
  return out;
}

function convertMessage(message: Message): OllamaMessage[] {
  if (message.role === 'user') {
    if (typeof message.content === 'string') {
      return [{ role: 'user', content: message.content }];
    }
    const texts: string[] = [];
    const images: string[] = [];
    for (const block of message.content) {
      if (block.type === 'text') texts.push(block.text);
      else if (block.type === 'image') images.push(block.data);
    }
    const out: OllamaMessage = { role: 'user', content: texts.join('\n') };
    if (images.length > 0) out.images = images;
    return [out];
  }

  if (message.role === 'assistant') {
    const texts: string[] = [];
    const toolCalls: Required<OllamaMessage>['tool_calls'] = [];
    for (const block of message.content) {
      if (block.type === 'text') texts.push(block.text);
      else if (block.type === 'toolCall') {
        toolCalls.push({
          function: { name: block.name, arguments: block.arguments ?? {} },
        });
      }
    }
    const out: OllamaMessage = { role: 'assistant', content: texts.join('') };
    if (toolCalls.length > 0) out.tool_calls = toolCalls;
    return [out];
  }

  // toolResult
  const textBlocks: string[] = [];
  for (const block of message.content) {
    if (block.type === 'text') textBlocks.push(block.text);
  }
  return [
    {
      role: 'tool',
      content: textBlocks.join('\n'),
      tool_name: message.toolName,
    },
  ];
}

function toOllamaTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function mapDoneReason(reason: string | null | undefined, hadToolCall: boolean): StopReason {
  if (hadToolCall && (!reason || reason === 'stop')) return 'toolUse';
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'load':
    case null:
    case undefined:
      return 'stop';
    default:
      return 'stop';
  }
}

export const __testing = { mapDoneReason, toOllamaMessages };
