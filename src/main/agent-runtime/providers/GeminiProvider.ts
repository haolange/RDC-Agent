/**
 * Google Gemini Provider —— 适配 `generativelanguage.googleapis.com` 的
 * `streamGenerateContent` 端点。
 *
 * 协议要点：
 * - 端点：`POST {baseUrl}/v1beta/models/{model}:streamGenerateContent?alt=sse&key=...`
 * - 默认响应是数组式 JSON 流，启用 `alt=sse` 后改为 SSE，便于行级解析。
 * - API key 通过 query param `key=` 传递，不放 header。
 * - system 指令走顶层 `systemInstruction` 字段。
 * - 工具结果以 `functionResponse` part 形式作为 user 消息回传。
 * - functionCall 不做增量流式，每个 chunk 中的 functionCall 都是完整对象。
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
import { applyGeminiReasoning } from './reasoningWire';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const PROVIDER_API = 'google-gemini';

interface GeminiTextPart {
  text: string;
  thought?: boolean;
}

interface GeminiFunctionCallPart {
  functionCall: {
    name: string;
    args?: Record<string, unknown>;
  };
}

interface GeminiInlineDataPart {
  inlineData: { mimeType: string; data: string };
}

type GeminiPart = GeminiTextPart | GeminiFunctionCallPart | GeminiInlineDataPart | Record<string, unknown>;

interface GeminiCandidate {
  content?: { parts?: GeminiPart[]; role?: string };
  finishReason?: string;
  index?: number;
}

interface GeminiStreamChunk {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}

export interface GeminiProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  capabilities?: Partial<ProviderCapabilities>;
}

export class GeminiProvider implements ProviderStrategy {
  readonly api = PROVIDER_API;
  private readonly defaultBaseUrl: string;
  private readonly defaultApiKey: string | undefined;
  private readonly defaultHeaders: Record<string, string>;
  private readonly capabilities: ProviderCapabilities;

  constructor(options: GeminiProviderOptions = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.defaultApiKey = options.apiKey;
    this.defaultHeaders = { ...(options.headers ?? {}) };
    this.capabilities = {
      streaming: true,
      nativeToolCalling: true,
      structuredOutput: true,
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
    const composed = composeAbortSignals(options.signal, stream.signal, { providerApi: PROVIDER_API, ...options });

    try {
      builder.start();

      if (!apiKey) {
        throw new ProviderHttpError(PROVIDER_API, 401, 'missing apiKey for Gemini provider');
      }

      const body = this.buildRequestBody(context, options);
      const versionedBase = baseUrl.includes('/v1beta') || baseUrl.includes('/v1')
        ? baseUrl
        : `${baseUrl}/v1beta`;
      const url = `${versionedBase}/models/${encodeURIComponent(model.id)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.defaultHeaders,
        },
        body: JSON.stringify(body),
        signal: composed.signal,
      });

      await ensureOk(response, PROVIDER_API);

      const TEXT_INDEX = 0;
      const THINKING_INDEX = 1;
      let toolCallCounter = 0;
      let finishReason: string | null = null;
      let sawOutput = false;

      for await (const data of parseSSE(response, composed.signal, { providerApi: PROVIDER_API, ...options })) {
        if (composed.signal.aborted) break;
        let chunk: GeminiStreamChunk;
        try {
          chunk = JSON.parse(data) as GeminiStreamChunk;
        } catch {
          continue;
        }

        if (chunk.usageMetadata) {
          builder.setUsage({
            inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
            outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
            totalTokens:
              chunk.usageMetadata.totalTokenCount
              ?? (chunk.usageMetadata.promptTokenCount ?? 0)
                + (chunk.usageMetadata.candidatesTokenCount ?? 0),
          });
        }

        const candidate = chunk.candidates?.[0];
        if (!candidate) continue;

        const parts = candidate.content?.parts ?? [];
        for (const part of parts) {
          if ('text' in part && typeof (part as GeminiTextPart).text === 'string') {
            const textPart = part as GeminiTextPart;
            if (textPart.thought) {
              sawOutput = true;
              builder.appendThinking(THINKING_INDEX, textPart.text, {
                kind: 'raw',
                source: 'gemini-raw',
                visibility: 'raw-collapsed',
                replayPolicy: 'none',
              });
            } else {
              sawOutput = true;
              builder.appendText(TEXT_INDEX, textPart.text);
            }
            continue;
          }
          if ('functionCall' in part) {
            const fc = (part as GeminiFunctionCallPart).functionCall;
            const slot = 2 + toolCallCounter;
            toolCallCounter += 1;
            const callId = `gemini-call-${Date.now()}-${slot}`;
            sawOutput = true;
            builder.ensureToolCall(slot, callId, fc.name);
            const args = JSON.stringify(fc.args ?? {});
            builder.appendToolCallArgs(slot, args);
            builder.endToolCall(slot);
          }
          // inlineData / 其它 part 暂不处理。
        }

        if (candidate.finishReason) {
          finishReason = candidate.finishReason;
        }
      }

      if (!sawOutput) {
        throw new ProviderHttpError(PROVIDER_API, 502, 'Provider stream ended without assistant output or structured tool call.');
      }
      builder.done(mapFinishReason(finishReason, toolCallCounter > 0));
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
    context: Context,
    options: StreamOptions,
  ): Record<string, unknown> {
    const { systemInstruction, contents } = toGeminiContents(context);
    const body: Record<string, unknown> = { contents };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const generationConfig: Record<string, unknown> = {};
    if (typeof options.temperature === 'number') generationConfig.temperature = options.temperature;
    if (typeof options.topP === 'number') generationConfig.topP = options.topP;
    if (typeof options.maxTokens === 'number') generationConfig.maxOutputTokens = options.maxTokens;
    applyGeminiReasoning(generationConfig, options.reasoning);
    if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

    if (context.tools && context.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: context.tools.map(toGeminiTool),
        },
      ];
    }
    return body;
  }
}

// =====================================================================
// 转换辅助
// =====================================================================

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<Record<string, unknown>>;
}

function toGeminiContents(context: Context): {
  systemInstruction?: string;
  contents: GeminiContent[];
} {
  const contents: GeminiContent[] = [];
  for (const message of context.messages) {
    contents.push(...convertMessage(message));
  }
  return {
    systemInstruction:
      context.systemPrompt && context.systemPrompt.trim() ? context.systemPrompt : undefined,
    contents,
  };
}

function convertMessage(message: Message): GeminiContent[] {
  if (message.role === 'user') {
    if (typeof message.content === 'string') {
      return [{ role: 'user', parts: [{ text: message.content }] }];
    }
    const parts: Array<Record<string, unknown>> = [];
    for (const block of message.content) {
      if (block.type === 'text') {
        parts.push({ text: block.text });
      } else if (block.type === 'image') {
        parts.push({
          inlineData: { mimeType: block.mimeType, data: block.data },
        });
      }
    }
    return [{ role: 'user', parts }];
  }

  if (message.role === 'assistant') {
    const parts: Array<Record<string, unknown>> = [];
    for (const block of message.content) {
      if (block.type === 'text') {
        parts.push({ text: block.text });
      } else if (block.type === 'toolCall') {
        parts.push({
          functionCall: { name: block.name, args: block.arguments ?? {} },
        });
      }
    }
    return [{ role: 'model', parts }];
  }

  // toolResult -> functionResponse
  const textBlocks: string[] = [];
  for (const block of message.content) {
    if (block.type === 'text') textBlocks.push(block.text);
  }
  return [
    {
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: message.toolName,
            response: { content: textBlocks.join('\n'), isError: message.isError || undefined },
          },
        },
      ],
    },
  ];
}

function toGeminiTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

function mapFinishReason(reason: string | null | undefined, hadToolCall: boolean): StopReason {
  if (hadToolCall && (!reason || reason === 'STOP')) return 'toolUse';
  switch (reason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
      return 'refusal';
    default:
      return 'stop';
  }
}

export const __testing = { mapFinishReason, toGeminiContents };
