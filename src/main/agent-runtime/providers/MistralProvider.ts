/**
 * Mistral Conversations Provider —— 适配 Mistral AI Chat Completions 协议。
 *
 * Mistral's API is OpenAI-compatible at the wire level (Chat Completions format).
 * Key differences from generic OpenAI-compatible:
 * - Default base URL: https://api.mistral.ai/v1
 * - Mistral-specific headers (User-Agent)
 * - thinking_format support for reasoning models
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
import { AssistantStreamBuilder, ProviderStreamProtocolError } from './internal/AssistantStreamBuilder';
import {
  AlternatingTextThinkingChannels,
  StreamChannelRefs,
  closeSwitchedChannel,
} from './internal/streamChannelRefs';
import { composeAbortSignals, ensureOk, normalizeError, parseSSE, ProviderEmptyStreamError, ProviderHttpError } from './internal/http';
import { finalizeProviderUsage } from './internal/normalizeCacheUsage';
import { applyOpenAiCompatibleReasoning } from './reasoningWire';
import { reasoningProjectionSource } from './reasoningProjection';
import type { RequestPlan } from '@shared/types/providerCapability';
import { createContinuationArtifact } from '../reasoning/ContinuationArtifacts';
import { decideContinuationReplay } from '../reasoning/ContinuationReplayPolicy';

const DEFAULT_BASE_URL = 'https://api.mistral.ai/v1';
const PROVIDER_API = 'mistral-conversations';

interface MistralToolCallChunk {
  index?: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface MistralDelta {
  role?: string;
  content?: string | null;
  tool_calls?: MistralToolCallChunk[];
  reasoning?: string | null;
  reasoning_content?: string | null;
}

interface MistralStreamChoice {
  index?: number;
  delta?: MistralDelta;
  finish_reason?: string | null;
}

interface MistralStreamChunk {
  id?: string;
  choices?: MistralStreamChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

export interface MistralProviderOptions {
  /** 默认 baseUrl，可被 `StreamOptions.baseUrl` 覆盖。 */
  baseUrl?: string;
  /** 默认 API key，可被 `StreamOptions.apiKey` 覆盖。 */
  apiKey?: string;
  /** 附加请求头。 */
  headers?: Record<string, string>;
}

export class MistralProvider implements ProviderStrategy {
  readonly api = PROVIDER_API;
  private readonly defaultBaseUrl: string;
  private readonly defaultApiKey: string | undefined;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: MistralProviderOptions = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.defaultApiKey = options.apiKey;
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
        throw new ProviderHttpError(PROVIDER_API, 401, 'missing apiKey for Mistral provider');
      }

      const body = applyRequestPlanBody(this.buildRequestBody(model, context, options), options.requestPlan);
      const url = buildMistralChatCompletionsUrl(baseUrl);
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'RDC-Agent',
        ...this.defaultHeaders,
        ...requestPlanHeaders(options.requestPlan),
      };

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: composed.signal,
      });

      recordQuotaFromResponse(options.requestPlan, response);
      await ensureOk(response, PROVIDER_API);

      let finishReason: string | null = null;
      const channels = new StreamChannelRefs(PROVIDER_API);
      const alternating = new AlternatingTextThinkingChannels(channels);
      const terminalRef = channels.ref({ providerBlockKey: 'response:terminal' });
      const toolRefs = new Map<number, ReturnType<StreamChannelRefs['ref']>>();
      let reasoningBuffer = '';
      const reasoningSource = reasoningProjectionSource(options.requestPlan, 'raw');
      let sawOutput = false;

      for await (const data of parseSSE(response, composed.signal, { providerApi: PROVIDER_API, ...options })) {
        if (composed.signal.aborted) break;
        let chunk: MistralStreamChunk;
        try {
          chunk = JSON.parse(data) as MistralStreamChunk;
        } catch {
          continue;
        }

        if (chunk.usage) {
          const cacheReadTokens = chunk.usage.prompt_tokens_details?.cached_tokens;
          const reasoningTokens = chunk.usage.completion_tokens_details?.reasoning_tokens;
          builder.setUsage(finalizeProviderUsage({
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens:
              chunk.usage.total_tokens
              ?? (chunk.usage.prompt_tokens ?? 0) + (chunk.usage.completion_tokens ?? 0),
            ...(typeof cacheReadTokens === 'number' ? { cacheReadTokens } : {}),
            ...(typeof reasoningTokens === 'number' ? { reasoningTokens } : {}),
          }));
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (finishReason !== null) {
          throw new ProviderStreamProtocolError(
            'PROVIDER_STREAM_EVENT_AFTER_TERMINAL',
            terminalRef,
            'Provider emitted another Chat Completions choice after finish_reason.',
          );
        }

        const delta = choice.delta ?? {};
        const reasoningDelta = delta.reasoning_content ?? delta.reasoning;
        if (typeof reasoningDelta === 'string' && reasoningDelta.length > 0) {
          sawOutput = true;
          reasoningBuffer += reasoningDelta;
          const continuation = createContinuationArtifact(options.requestPlan, {
            type: 'reasoning_content',
            reasoningContent: reasoningBuffer,
          });
          const switched = alternating.ensure('thinking');
          closeSwitchedChannel(builder, switched.close);
          if (switched.started) {
            builder.startThinking(switched.ref, {
              kind: 'raw',
              source: reasoningSource,
              visibility: 'raw-collapsed',
              continuation,
            });
          }
          builder.appendThinking(switched.ref, reasoningDelta, {
            kind: 'raw',
            source: reasoningSource,
            visibility: 'raw-collapsed',
            continuation,
          });
        }
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          sawOutput = true;
          const switched = alternating.ensure('text');
          closeSwitchedChannel(builder, switched.close);
          if (switched.started) builder.startText(switched.ref);
          builder.appendText(switched.ref, delta.content);
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const callIndex = typeof tc.index === 'number' ? tc.index : 0;
            sawOutput = true;
            let toolRef = toolRefs.get(callIndex);
            if (!toolRef) {
              toolRef = channels.ref({
                providerBlockKey: `virtual:tool:${callIndex}`,
                sourceIndex: callIndex,
              });
              toolRefs.set(callIndex, toolRef);
              builder.startToolCall(toolRef, tc.id ?? '', tc.function?.name ?? '');
            } else {
              builder.updateToolCall(toolRef, tc.id ?? '', tc.function?.name ?? '');
            }
            const args = tc.function?.arguments;
            if (typeof args === 'string' && args.length > 0) {
              builder.appendToolCallArgs(toolRef, args);
            }
          }
        }

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }

      if (!sawOutput) {
        throw new ProviderEmptyStreamError(PROVIDER_API);
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
    const messages = toMistralMessages(context, options.requestPlan);
    const body: Record<string, unknown> = {
      model: model.id,
      messages,
      stream: true,
    };
    if (typeof options.temperature === 'number') body.temperature = options.temperature;
    if (typeof options.topP === 'number') body.top_p = options.topP;
    applyOpenAiCompatibleReasoning(body, options.reasoning);
    const maxTokens = options.maxTokens ?? model.maxTokens;
    if (typeof maxTokens === 'number' && maxTokens > 0) body.max_tokens = maxTokens;
    if (context.tools && context.tools.length > 0) {
      body.tools = context.tools.map(toMistralTool);
      body.tool_choice = 'auto';
    }
    body.stream_options = { include_usage: true };
    return body;
  }
}

export function buildMistralChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/u, '');
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
}

// =====================================================================
// 转换辅助
// =====================================================================

interface MistralMessage {
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

function toMistralMessages(
  context: Context,
  requestPlan: RequestPlan,
): MistralMessage[] {
  const out: MistralMessage[] = [];
  const prompt = partitionSystemPrompt(context);
  if (prompt.combinedText) {
    out.push({ role: 'system', content: prompt.combinedText });
  }
  for (const message of context.messages) {
    out.push(...convertMessage(message, requestPlan));
  }
  return out;
}

function convertMessage(message: Message, requestPlan: RequestPlan): MistralMessage[] {
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
    const reasoning: string[] = [];
    const toolCalls: Required<MistralMessage>['tool_calls'] = [];
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
    const out: MistralMessage = {
      role: 'assistant',
      content: text.length > 0 ? text.join('') : null,
    };
    if (toolCalls.length > 0) out.tool_calls = toolCalls;
    if (reasoning.length > 0) out.reasoning_content = reasoning.join('');
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
      tool_call_id: message.toolCallId,
      content: textBlocks.join('\n'),
    },
  ];
}

function toMistralTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
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
      return 'refusal';
    default:
      return 'stop';
  }
}

export const __testing = { buildMistralChatCompletionsUrl, mapFinishReason, toMistralMessages };
