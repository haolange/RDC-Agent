/**
 * OpenAI-compatible Provider —— 适配 OpenAI Chat Completions 协议族。
 *
 * 覆盖：
 * - OpenAI / Azure OpenAI
 * - OpenRouter
 * - DeepSeek、Qwen DashScope（兼容模式）
 * - 任何对外暴露同协议 `/chat/completions` 的服务
 *
 * 使用原生 fetch + 自实现 SSE 解析，不引入 `openai` SDK。
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
import { composeAbortSignals, ensureOk, normalizeError, parseSSE, ProviderHttpError } from './internal/http';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const PROVIDER_API = 'openai-compatible';

interface OpenAIToolCallChunk {
  index?: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface OpenAIDelta {
  role?: string;
  content?: string | null;
  tool_calls?: OpenAIToolCallChunk[];
  reasoning?: string | null;
  reasoning_content?: string | null;
}

interface OpenAIStreamChoice {
  index?: number;
  delta?: OpenAIDelta;
  finish_reason?: string | null;
}

interface OpenAIStreamChunk {
  id?: string;
  choices?: OpenAIStreamChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface OpenAICompatibleProviderOptions {
  /** 默认 baseUrl，可被 `StreamOptions.baseUrl` 覆盖。 */
  baseUrl?: string;
  /** 默认 API key，可被 `StreamOptions.apiKey` 覆盖。 */
  apiKey?: string;
  /** 附加请求头（例如 OpenRouter 的 HTTP-Referer / X-Title）。 */
  headers?: Record<string, string>;
  /** 用于覆盖能力矩阵；默认使用通用值。 */
  capabilities?: Partial<ProviderCapabilities>;
}

export class OpenAICompatibleProvider implements ProviderStrategy {
  readonly api = PROVIDER_API;
  private readonly defaultBaseUrl: string;
  private readonly defaultApiKey: string | undefined;
  private readonly defaultHeaders: Record<string, string>;
  private readonly capabilities: ProviderCapabilities;

  constructor(options: OpenAICompatibleProviderOptions = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.defaultApiKey = options.apiKey;
    this.defaultHeaders = { ...(options.headers ?? {}) };
    this.capabilities = {
      streaming: true,
      nativeToolCalling: true,
      structuredOutput: true,
      vision: true,
      reasoning: false,
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
    const externalSignal = options.signal;
    const internalSignal = stream.signal;
    const composed = composeAbortSignals(externalSignal, internalSignal, { providerApi: PROVIDER_API, ...options });

    try {
      builder.start();

      if (!apiKey) {
        throw new ProviderHttpError(PROVIDER_API, 401, 'missing apiKey for OpenAI-compatible provider');
      }

      const body = this.buildRequestBody(model, context, options);
      const url = `${baseUrl}/chat/completions`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...this.defaultHeaders,
        },
        body: JSON.stringify(body),
        signal: composed.signal,
      });

      await ensureOk(response, PROVIDER_API);

      let finishReason: string | null = null;
      // contentIndex 由插槽决定：text 用 0；tool_calls 按 OpenAI 提供的 index + 1。
      const TEXT_INDEX = 0;
      const THINKING_INDEX = 1;
      const TOOL_INDEX_BASE = 2;
      let sawOutput = false;

      for await (const data of parseSSE(response, composed.signal, { providerApi: PROVIDER_API, ...options })) {
        if (composed.signal.aborted) break;
        let chunk: OpenAIStreamChunk;
        try {
          chunk = JSON.parse(data) as OpenAIStreamChunk;
        } catch {
          // 单条解析失败不应中断整个流。
          continue;
        }

        if (chunk.usage) {
          builder.setUsage({
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens:
              chunk.usage.total_tokens
              ?? (chunk.usage.prompt_tokens ?? 0) + (chunk.usage.completion_tokens ?? 0),
          });
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta ?? {};
        const reasoningDelta = delta.reasoning_content ?? delta.reasoning;
        if (typeof reasoningDelta === 'string' && reasoningDelta.length > 0) {
          sawOutput = true;
          builder.appendThinking(THINKING_INDEX, reasoningDelta, {
            kind: 'raw',
            source: isOpenRouterBaseUrl(baseUrl) ? 'openrouter-raw' : 'openai-compatible-raw',
            visibility: 'raw-collapsed',
            replayPolicy: 'none',
          });
        }
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          sawOutput = true;
          builder.appendText(TEXT_INDEX, delta.content);
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const callIndex = typeof tc.index === 'number' ? tc.index : 0;
            const slot = TOOL_INDEX_BASE + callIndex;
            sawOutput = true;
            builder.ensureToolCall(slot, tc.id ?? '', tc.function?.name ?? '');
            const args = tc.function?.arguments;
            if (typeof args === 'string' && args.length > 0) {
              builder.appendToolCallArgs(slot, args);
            }
          }
        }

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }

      if (!sawOutput) {
        throw new ProviderHttpError(PROVIDER_API, 502, 'Provider stream ended without assistant output or structured tool call.');
      }
      builder.done(mapFinishReason(finishReason));
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
    const messages = toOpenAIMessages(context);
    const body: Record<string, unknown> = {
      model: model.id,
      messages,
      stream: true,
    };
    if (typeof options.temperature === 'number') body.temperature = options.temperature;
    if (typeof options.topP === 'number') body.top_p = options.topP;
    if (options.reasoningBudget && options.reasoningBudget !== 'auto') {
      body.reasoning_effort = options.reasoningBudget;
    }
    const maxTokens = options.maxTokens ?? model.maxTokens;
    if (typeof maxTokens === 'number' && maxTokens > 0) body.max_tokens = maxTokens;
    if (context.tools && context.tools.length > 0) {
      body.tools = context.tools.map(toOpenAITool);
      body.tool_choice = 'auto';
    }
    // 请求 usage 统计（OpenAI 在 stream_options 中支持）
    body.stream_options = { include_usage: true };
    return body;
  }
}

// =====================================================================
// 转换辅助
// =====================================================================

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

function toOpenAIMessages(context: Context): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  if (context.systemPrompt && context.systemPrompt.trim()) {
    out.push({ role: 'system', content: context.systemPrompt });
  }
  for (const message of context.messages) {
    out.push(...convertMessage(message));
  }
  return out;
}

function convertMessage(message: Message): OpenAIMessage[] {
  if (message.role === 'user') {
    if (typeof message.content === 'string') {
      return [{ role: 'user', content: message.content }];
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
    return [{ role: 'user', content: parts }];
  }

  if (message.role === 'assistant') {
    const text: string[] = [];
    const toolCalls: Required<OpenAIMessage>['tool_calls'] = [];
    for (const block of message.content) {
      if (block.type === 'text') text.push(block.text);
      else if (block.type === 'toolCall') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.arguments ?? {}),
          },
        });
      }
      // thinking 内容不回放给 OpenAI（不属于该协议）。
    }
    const out: OpenAIMessage = {
      role: 'assistant',
      content: text.length > 0 ? text.join('') : null,
    };
    if (toolCalls.length > 0) out.tool_calls = toolCalls;
    return [out];
  }

  // toolResult
  const textBlocks: string[] = [];
  for (const block of message.content) {
    if (block.type === 'text') textBlocks.push(block.text);
    // image content 不在 OpenAI tool 角色中支持，忽略。
  }
  return [
    {
      role: 'tool',
      tool_call_id: message.toolCallId,
      content: textBlocks.join('\n'),
    },
  ];
}

function toOpenAITool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function isOpenRouterBaseUrl(baseUrl: string): boolean {
  return baseUrl.toLowerCase().includes('openrouter');
}

function mapFinishReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool_calls':
    case 'function_call':
      return 'toolUse';
    case 'content_filter':
      return 'error';
    default:
      return 'stop';
  }
}

export const __testing = { mapFinishReason, toOpenAIMessages };
