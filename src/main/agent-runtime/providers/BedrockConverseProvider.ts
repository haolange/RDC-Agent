/**
 * AWS Bedrock Converse Stream Provider —— 适配 Bedrock Converse API 协议。
 *
 * Bedrock Converse uses a DIFFERENT wire format from OpenAI/Anthropic:
 * - Request: { system, messages, toolConfig, inferenceConfig, additionalModelRequestFields }
 * - Response streaming: messageStart, contentBlockStart, contentBlockDelta, contentBlockStop, messageStop events
 * - Cache: cachePoint: { type: 'default' } placed in system/messages
 * - SigV4 signing via ProviderRequestAuthorizer
 * - Endpoint: https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/converse-stream
 *
 * 使用原生 fetch + 自实现 SSE 解析，不引入第三方 SDK。
 */

import { EventStream } from '../core/EventStream';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Message,
  Model,
  StopReason,
  StreamOptions,
  ToolDefinition,
} from '../core/types';
import { applyRequestPlanBody, requestPlanHeaders } from './requestPlanWire';
import { partitionSystemPrompt } from './promptCacheWire';
import { recordQuotaFromResponse } from '../../settings/ProviderQuota';
import { AssistantStreamBuilder } from './internal/AssistantStreamBuilder';
import { StreamChannelRefs } from './internal/streamChannelRefs';
import {
  composeAbortSignals,
  ensureOk,
  normalizeError,
  ProviderHttpError,
  type ProviderStreamReadOptions,
  resolveProviderTimeouts,
  DEFAULT_PROVIDER_MAX_BUFFER_BYTES,
  ProviderStreamBufferError,
} from './internal/http';
import { finalizeProviderUsage } from './internal/normalizeCacheUsage';
import type { ProviderRequestAuthorizer } from '../../settings/AwsBedrockCredentials';

const PROVIDER_API = 'bedrock-converse-stream';

export interface BedrockConverseProviderOptions {
  /** AWS region for endpoint construction. */
  region?: string;
  /** Full base URL override; takes precedence over region-based construction. */
  baseUrl?: string;
  /** Body-aware SigV4 authorization. */
  requestAuthorizer?: ProviderRequestAuthorizer;
  headers?: Record<string, string>;
}

// =====================================================================
// Bedrock Converse wire types
// =====================================================================

interface BedrockSystemBlock {
  text?: string;
  cachePoint?: { type: 'default' };
}

interface BedrockContentBlock {
  text?: string;
  image?: { format: string; source: { bytes: string } };
  toolUse?: { toolUseId: string; name: string; input: unknown };
  toolResult?: { toolUseId: string; content: Array<{ text?: string; json?: unknown }>; status?: 'success' | 'error' };
  reasoningContent?: { reasoningText?: { text?: string; signature?: string } };
  cachePoint?: { type: 'default' };
}

interface BedrockMessage {
  role: 'user' | 'assistant';
  content: BedrockContentBlock[];
}

interface BedrockToolConfig {
  tools: Array<{
    toolSpec: {
      name: string;
      description: string;
      inputSchema: { json: unknown };
    };
  }>;
  toolChoice?: { auto: Record<string, never> } | { any: Record<string, never> };
}

interface BedrockInferenceConfig {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
}

interface BedrockConverseRequest {
  system?: BedrockSystemBlock[];
  messages: BedrockMessage[];
  toolConfig?: BedrockToolConfig;
  inferenceConfig?: BedrockInferenceConfig;
  additionalModelRequestFields?: Record<string, unknown>;
}

// Stream event types
interface BedrockMessageStartEvent {
  role?: string;
}

interface BedrockContentBlockStartEvent {
  contentBlockIndex?: number;
  start?: {
    toolUse?: { toolUseId?: string; name?: string };
  };
}

interface BedrockContentBlockDeltaEvent {
  contentBlockIndex?: number;
  delta?: {
    text?: string;
    toolUse?: { input?: string };
    reasoningContent?: { text?: string };
  };
}

interface BedrockContentBlockStopEvent {
  contentBlockIndex?: number;
}

interface BedrockMessageStopEvent {
  stopReason?: string;
}

interface BedrockMetadataEvent {
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cacheReadInputTokens?: number;
    cacheWriteInputTokens?: number;
  };
}

interface BedrockStreamEvent {
  messageStart?: BedrockMessageStartEvent;
  contentBlockStart?: BedrockContentBlockStartEvent;
  contentBlockDelta?: BedrockContentBlockDeltaEvent;
  contentBlockStop?: BedrockContentBlockStopEvent;
  messageStop?: BedrockMessageStopEvent;
  metadata?: BedrockMetadataEvent;
}

export class BedrockConverseProvider implements ProviderStrategy {
  readonly api = PROVIDER_API;
  private readonly region: string | undefined;
  private readonly baseUrl: string | undefined;
  private readonly requestAuthorizer: ProviderRequestAuthorizer | undefined;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: BedrockConverseProviderOptions = {}) {
    this.region = options.region;
    this.baseUrl = options.baseUrl?.replace(/\/+$/, '');
    this.requestAuthorizer = options.requestAuthorizer;
    this.defaultHeaders = { ...(options.headers ?? {}) };
  }

  stream(
    model: Model,
    context: Context,
    options: StreamOptions,
  ): EventStream<AssistantMessageEvent, AssistantMessage> {
    const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
      (event) => event.type === 'done',
      (event) => (event as Extract<AssistantMessageEvent, { type: 'done' }>).message,
    );
    const builder = new AssistantStreamBuilder(stream, model.id, model.provider);

    void this.run(stream, builder, model, context, options);
    return stream;
  }

  private async run(
    stream: EventStream<AssistantMessageEvent, AssistantMessage>,
    builder: AssistantStreamBuilder,
    model: Model,
    context: Context,
    options: StreamOptions,
  ): Promise<void> {
    const composed = composeAbortSignals(options.signal, stream.signal, { providerApi: PROVIDER_API, ...options });

    try {
      builder.start();

      if (!this.requestAuthorizer) {
        throw new ProviderHttpError(PROVIDER_API, 401, 'missing requestAuthorizer for Bedrock Converse provider');
      }

      const url = this.buildEndpointUrl(model.id, options.baseUrl);
      const body = applyRequestPlanBody(this.buildRequestBody(model, context, options) as unknown as Record<string, unknown>, options.requestPlan);
      const bodyText = JSON.stringify(body);
      const unsignedHeaders = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...this.defaultHeaders,
        ...requestPlanHeaders(options.requestPlan),
      };
      const headers = await this.requestAuthorizer({ url, method: 'POST', headers: unsignedHeaders, body: bodyText });

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: bodyText,
        signal: composed.signal,
      });

      recordQuotaFromResponse(options.requestPlan, response);
      await ensureOk(response, PROVIDER_API);

      const channels = new StreamChannelRefs(PROVIDER_API);
      const textRefs = new Map<number, ReturnType<StreamChannelRefs['ref']>>();
      const thinkingRefs = new Map<number, ReturnType<StreamChannelRefs['ref']>>();
      const toolRefs = new Map<number, ReturnType<StreamChannelRefs['ref']>>();
      const toolNames = new Map<number, string>();
      const toolIds = new Map<number, string>();
      let sawOutput = false;
      let finishReason: StopReason = 'stop';
      const thinkingMeta = {
        kind: 'raw' as const,
        source: 'unknown' as const,
        visibility: 'raw-collapsed' as const,
      };

      for await (const event of parseBedrockSSE(response, composed.signal, { providerApi: PROVIDER_API, ...options })) {
        if (composed.signal.aborted) break;

        if (event.messageStart) {
          // Message started; role is typically 'assistant'
          continue;
        }

        if (event.contentBlockStart) {
          const blockIndex = event.contentBlockStart.contentBlockIndex ?? 0;
          const start = event.contentBlockStart.start;
          if (start?.toolUse) {
            const toolId = start.toolUse.toolUseId ?? '';
            const toolName = start.toolUse.name ?? '';
            toolIds.set(blockIndex, toolId);
            toolNames.set(blockIndex, toolName);
            const toolRef = channels.ref({
              providerBlockKey: `virtual:tool:${blockIndex}`,
              sourceIndex: blockIndex,
            });
            toolRefs.set(blockIndex, toolRef);
            sawOutput = true;
            builder.startToolCall(toolRef, toolId, toolName);
          }
          continue;
        }

        if (event.contentBlockDelta) {
          const blockIndex = event.contentBlockDelta.contentBlockIndex ?? 0;
          const delta = event.contentBlockDelta.delta;

          if (delta?.text) {
            sawOutput = true;
            let textRef = textRefs.get(blockIndex);
            if (!textRef) {
              textRef = channels.ref({
                providerBlockKey: `output:text:${blockIndex}`,
                sourceIndex: blockIndex,
              });
              textRefs.set(blockIndex, textRef);
              builder.startText(textRef);
            }
            builder.appendText(textRef, delta.text);
          }

          if (delta?.reasoningContent?.text) {
            sawOutput = true;
            let thinkingRef = thinkingRefs.get(blockIndex);
            if (!thinkingRef) {
              thinkingRef = channels.ref({
                providerBlockKey: `output:thinking:${blockIndex}`,
                sourceIndex: blockIndex,
              });
              thinkingRefs.set(blockIndex, thinkingRef);
              builder.startThinking(thinkingRef, thinkingMeta);
            }
            builder.appendThinking(thinkingRef, delta.reasoningContent.text, thinkingMeta);
          }

          if (delta?.toolUse?.input) {
            const toolRef = toolRefs.get(blockIndex);
            if (toolRef) {
              sawOutput = true;
              builder.appendToolCallArgs(toolRef, delta.toolUse.input);
            }
          }
          continue;
        }

        if (event.contentBlockStop) {
          const blockIndex = event.contentBlockStop.contentBlockIndex ?? 0;
          const toolRef = toolRefs.get(blockIndex);
          if (toolRef) {
            builder.endToolCall(toolRef);
            toolRefs.delete(blockIndex);
          }
          const textRef = textRefs.get(blockIndex);
          if (textRef) {
            builder.endText(textRef);
            textRefs.delete(blockIndex);
          }
          const thinkingRef = thinkingRefs.get(blockIndex);
          if (thinkingRef) {
            builder.endThinking(thinkingRef, thinkingMeta);
            thinkingRefs.delete(blockIndex);
          }
          continue;
        }

        if (event.messageStop) {
          finishReason = mapBedrockStopReason(event.messageStop.stopReason);
          continue;
        }

        if (event.metadata?.usage) {
          const usage = event.metadata.usage;
          builder.setUsage(finalizeProviderUsage({
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
            ...(typeof usage.cacheReadInputTokens === 'number' ? { cacheReadTokens: usage.cacheReadInputTokens } : {}),
            ...(typeof usage.cacheWriteInputTokens === 'number' ? { cacheWriteTokens: usage.cacheWriteInputTokens } : {}),
          }));
          continue;
        }
      }

      if (!sawOutput) {
        throw new ProviderHttpError(PROVIDER_API, 502, 'Provider stream ended without assistant output or structured tool call.');
      }
      builder.done(finishReason);
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

  private buildEndpointUrl(modelId: string, baseUrlOverride?: string): string {
    if (baseUrlOverride) {
      const trimmed = baseUrlOverride.replace(/\/+$/u, '');
      return trimmed.endsWith('/converse-stream') ? trimmed : `${trimmed}/converse-stream`;
    }
    if (this.baseUrl) {
      const trimmed = this.baseUrl.replace(/\/+$/u, '');
      return trimmed.endsWith('/converse-stream') ? trimmed : `${trimmed}/converse-stream`;
    }
    const region = this.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
    const encodedModelId = encodeURIComponent(modelId);
    return `https://bedrock-runtime.${region}.amazonaws.com/model/${encodedModelId}/converse-stream`;
  }

  private buildRequestBody(
    model: Model,
    context: Context,
    options: StreamOptions,
  ): BedrockConverseRequest {
    const prompt = partitionSystemPrompt(context);
    const system: BedrockSystemBlock[] = [];
    if (prompt.stableText) {
      system.push({ text: prompt.stableText, cachePoint: { type: 'default' } });
    }
    if (prompt.volatileText) {
      system.push({ text: prompt.volatileText });
    } else if (!prompt.stableText && prompt.combinedText) {
      system.push({ text: prompt.combinedText });
    }

    const messages = toBedrockMessages(context);

    const request: BedrockConverseRequest = {
      messages,
    };
    if (system.length > 0) {
      request.system = system;
    }

    const inferenceConfig: BedrockInferenceConfig = {};
    const maxTokens = options.maxTokens ?? model.maxTokens;
    if (typeof maxTokens === 'number' && maxTokens > 0) {
      inferenceConfig.maxTokens = maxTokens;
    }
    if (typeof options.temperature === 'number') {
      inferenceConfig.temperature = options.temperature;
    }
    if (typeof options.topP === 'number') {
      inferenceConfig.topP = options.topP;
    }
    if (Object.keys(inferenceConfig).length > 0) {
      request.inferenceConfig = inferenceConfig;
    }

    if (context.tools && context.tools.length > 0) {
      request.toolConfig = {
        tools: context.tools.map(toBedrockTool),
        toolChoice: { auto: {} },
      };
    }

    return request;
  }
}

// =====================================================================
// Bedrock SSE parser (handles event: + data: format)
// =====================================================================

async function* parseBedrockSSE(
  response: Response,
  signal: AbortSignal | undefined,
  options: ProviderStreamReadOptions,
): AsyncGenerator<BedrockStreamEvent> {
  if (!response.body) {
    throw new Error('parseBedrockSSE: response.body is null');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const timeouts = resolveProviderTimeouts(options);
  const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_PROVIDER_MAX_BUFFER_BYTES;
  let buffer = '';
  let hasReadChunk = false;

  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await readWithTimeout(
        reader,
        signal,
        options.providerApi,
        hasReadChunk ? 'idle' : 'first-byte',
        hasReadChunk ? timeouts.streamIdleTimeoutMs : timeouts.firstChunkTimeoutMs,
      );
      hasReadChunk = true;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      if (Buffer.byteLength(buffer, 'utf8') > maxBufferBytes) {
        const error = new ProviderStreamBufferError(options.providerApi, maxBufferBytes);
        void reader.cancel(error).catch(() => undefined);
        throw error;
      }

      // Bedrock SSE format: events separated by double newlines
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const eventBlock of events) {
        const lines = eventBlock.split('\n');
        let data = '';
        for (const line of lines) {
          const trimmed = line.replace(/\r$/, '');
          if (trimmed.startsWith('data:')) {
            data = trimmed.slice(5).trimStart();
          }
        }
        if (!data || data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data) as BedrockStreamEvent;
          yield parsed;
        } catch {
          // Skip malformed events
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore: stream already closed or cancelled
    }
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortErrorFromSignal(signal);
  }
}

function abortErrorFromSignal(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }
  const abortErr = new Error('Provider request aborted');
  abortErr.name = 'AbortError';
  return abortErr;
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
  providerApi: string,
  phase: 'first-byte' | 'idle',
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return reader.read();
  }

  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      signal?.removeEventListener('abort', onAbort);
    };

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const onAbort = (): void => {
      finish(() => reject(abortErrorFromSignal(signal)));
    };

    if (signal?.aborted) {
      reject(abortErrorFromSignal(signal));
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });
    timeoutId = setTimeout(() => {
      const { ProviderTimeoutError } = require('./internal/http') as typeof import('./internal/http');
      const error = new ProviderTimeoutError(providerApi, phase, timeoutMs);
      void reader.cancel(error).catch(() => undefined);
      finish(() => reject(error));
    }, timeoutMs);

    reader.read()
      .then((result) => finish(() => resolve(result)))
      .catch((error) => finish(() => reject(error)));
  });
}

// =====================================================================
// 转换辅助
// =====================================================================

function toBedrockMessages(context: Context): BedrockMessage[] {
  const out: BedrockMessage[] = [];
  for (const message of context.messages) {
    const converted = convertMessage(message);
    if (converted) {
      out.push(converted);
    }
  }
  return out;
}

function convertMessage(message: Message): BedrockMessage | null {
  if (message.role === 'user') {
    const content: BedrockContentBlock[] = [];
    if (typeof message.content === 'string') {
      content.push({ text: message.content });
    } else {
      for (const block of message.content) {
        if (block.type === 'text') {
          content.push({ text: block.text });
        } else if (block.type === 'image') {
          content.push({
            image: {
              format: block.mimeType.split('/')[1] ?? 'png',
              source: { bytes: block.data },
            },
          });
        }
      }
    }
    return { role: 'user', content };
  }

  if (message.role === 'assistant') {
    const content: BedrockContentBlock[] = [];
    for (const block of message.content) {
      if (block.type === 'text') {
        content.push({ text: block.text });
      } else if (block.type === 'thinking') {
        // Bedrock reasoning content replay
        if (block.continuation?.carrier === 'reasoning-content' && block.continuation.reasoningContent) {
          content.push({
            reasoningContent: {
              reasoningText: { text: block.continuation.reasoningContent },
            },
          });
        }
      } else if (block.type === 'toolCall') {
        content.push({
          toolUse: {
            toolUseId: block.id,
            name: block.name,
            input: block.arguments,
          },
        });
      }
    }
    return { role: 'assistant', content };
  }

  // toolResult - Bedrock expects tool results as user messages
  const toolResultContent: Array<{ text?: string }> = [];
  for (const block of message.content) {
    if (block.type === 'text') {
      toolResultContent.push({ text: block.text });
    }
  }
  return {
    role: 'user',
    content: [{
      toolResult: {
        toolUseId: message.toolCallId,
        content: toolResultContent.length > 0 ? toolResultContent : [{ text: '' }],
        status: message.isError ? 'error' : 'success',
      },
    }],
  };
}

function toBedrockTool(tool: ToolDefinition): BedrockToolConfig['tools'][number] {
  return {
    toolSpec: {
      name: tool.name,
      description: tool.description,
      inputSchema: { json: tool.parameters },
    },
  };
}

function mapBedrockStopReason(reason: string | undefined): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'toolUse';
    case 'content_filtered':
      return 'refusal';
    default:
      return 'stop';
  }
}

export const __testing = { mapBedrockStopReason, toBedrockMessages };
