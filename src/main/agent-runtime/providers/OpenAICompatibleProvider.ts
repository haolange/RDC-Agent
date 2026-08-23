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
import { composeAbortSignals, ensureOk, normalizeError, parseSSE, ProviderHttpError } from './internal/http';
import { finalizeProviderUsage } from './internal/normalizeCacheUsage';
import { applyOpenAiCompatibleReasoning } from './reasoningWire';
import { reasoningProjectionSource } from './reasoningProjection';
import type { ProviderRequestAuthorizer } from '../../settings/AwsBedrockCredentials';
import type { RequestPlan } from '@shared/types/providerCapability';
import { createContinuationArtifact } from '../reasoning/ContinuationArtifacts';
import { decideContinuationReplay } from '../reasoning/ContinuationReplayPolicy';
import { requiresAssistantReasoningContent } from './reasoningContentReplay';

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
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

function hasSemanticChoice(choice: OpenAIStreamChoice): boolean {
  const delta = choice.delta;
  return Boolean(
    (typeof delta?.content === 'string' && delta.content.length > 0)
    || (typeof delta?.reasoning === 'string' && delta.reasoning.length > 0)
    || (typeof delta?.reasoning_content === 'string' && delta.reasoning_content.length > 0)
    || (Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0),
  );
}

export interface OpenAICompatibleProviderOptions {
  /** 默认 baseUrl，可被 `StreamOptions.baseUrl` 覆盖。 */
  baseUrl?: string;
  /** 默认 API key，可被 `StreamOptions.apiKey` 覆盖。 */
  apiKey?: string;
  /** 附加请求头（例如 OpenRouter 的 HTTP-Referer / X-Title）。 */
  headers?: Record<string, string>;
  /** Some compatible surfaces (for example Azure) use a non-Bearer API-key header. */
  authorization?: 'bearer' | 'none';
  query?: Record<string, string>;
  /** Body-aware authorization, used by transports such as AWS SigV4. */
  requestAuthorizer?: ProviderRequestAuthorizer;
}

export class OpenAICompatibleProvider implements ProviderStrategy {
  readonly api = PROVIDER_API;
  private readonly defaultBaseUrl: string;
  private readonly defaultApiKey: string | undefined;
  private readonly defaultHeaders: Record<string, string>;
  private readonly authorization: 'bearer' | 'none';
  private readonly query: Record<string, string>;
  private readonly requestAuthorizer: ProviderRequestAuthorizer | undefined;

  constructor(options: OpenAICompatibleProviderOptions = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.defaultApiKey = options.apiKey;
    this.defaultHeaders = { ...(options.headers ?? {}) };
    this.authorization = options.authorization ?? 'bearer';
    this.query = { ...(options.query ?? {}) };
    this.requestAuthorizer = options.requestAuthorizer;
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

      if (!apiKey && !this.requestAuthorizer) {
        throw new ProviderHttpError(PROVIDER_API, 401, 'missing apiKey for OpenAI-compatible provider');
      }

      const body = applyRequestPlanBody(this.buildRequestBody(model, context, options), options.requestPlan);
      const url = buildChatCompletionsUrl(baseUrl, this.query);
      const bodyText = JSON.stringify(body);
      const unsignedHeaders = {
        'Content-Type': 'application/json',
        ...(this.authorization === 'bearer' && apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...this.defaultHeaders,
        ...requestPlanHeaders(options.requestPlan),
      };
      const headers = this.requestAuthorizer
        ? await this.requestAuthorizer({ url, method: 'POST', headers: unsignedHeaders, body: bodyText })
        : unsignedHeaders;

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: bodyText,
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
        let chunk: OpenAIStreamChunk;
        try {
          chunk = JSON.parse(data) as OpenAIStreamChunk;
        } catch {
          // 单条解析失败不应中断整个流。
          continue;
        }

        if (chunk.usage) {
          const cacheReadTokens = chunk.usage.prompt_tokens_details?.cached_tokens;
          const cacheWriteTokens = chunk.usage.prompt_tokens_details?.cache_write_tokens;
          const reasoningTokens = chunk.usage.completion_tokens_details?.reasoning_tokens;
          builder.setUsage(finalizeProviderUsage({
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens:
              chunk.usage.total_tokens
              ?? (chunk.usage.prompt_tokens ?? 0) + (chunk.usage.completion_tokens ?? 0),
            ...(typeof cacheReadTokens === 'number' ? { cacheReadTokens } : {}),
            ...(typeof cacheWriteTokens === 'number' ? { cacheWriteTokens } : {}),
            ...(typeof reasoningTokens === 'number' ? { reasoningTokens } : {}),
            ...(typeof chunk.usage.prompt_cache_hit_tokens === 'number'
              ? { promptCacheHitTokens: chunk.usage.prompt_cache_hit_tokens }
              : {}),
            ...(typeof chunk.usage.prompt_cache_miss_tokens === 'number'
              ? { promptCacheMissTokens: chunk.usage.prompt_cache_miss_tokens }
              : {}),
          }));
        }

        const choices = chunk.choices ?? [];
        if (finishReason !== null) {
          if (choices.some(hasSemanticChoice)) {
            throw new ProviderStreamProtocolError(
              'PROVIDER_STREAM_EVENT_AFTER_TERMINAL',
              terminalRef,
              'Provider emitted another semantic Chat Completions choice after finish_reason.',
            );
          }
          continue;
        }
        const choice = choices.find((candidate) => (candidate.index ?? 0) === 0) ?? choices[0];
        if (!choice) continue;
        if (choices.some((candidate) => candidate !== choice && hasSemanticChoice(candidate))) {
          throw new ProviderStreamProtocolError(
            'PROVIDER_STREAM_CHANNEL_COLLISION',
            terminalRef,
            'Provider emitted multiple semantic Chat Completions choices for a single-choice request.',
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
    const messages = toOpenAIMessages(context, options.requestPlan, options.promptCache);
    const body: Record<string, unknown> = {
      model: model.id,
      messages,
      stream: true,
    };
    if (options.promptCache?.enabled
      && options.promptCache.keyCarrier === 'prompt-cache-key'
      && options.promptCache.requestKey) {
      body.prompt_cache_key = options.promptCache.requestKey;
    }
    if (options.promptCache?.enabled
      && options.promptCache.breakpointCarrier === 'openai-prompt-cache'
      && (
        options.promptCache.breakpoint === 'explicit'
        || options.promptCache.breakpoint === 'automatic-and-explicit'
      )) {
      body.prompt_cache_options = {
        mode: options.promptCache.breakpoint === 'explicit' ? 'explicit' : 'implicit',
        ...(options.promptCache.ttl === 'thirty-minutes' ? { ttl: '30m' } : {}),
      };
    }
    if (typeof options.temperature === 'number') body.temperature = options.temperature;
    if (typeof options.topP === 'number') body.top_p = options.topP;
    applyOpenAiCompatibleReasoning(body, options.reasoning);
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

export function buildChatCompletionsUrl(baseUrl: string, query: Readonly<Record<string, string>> = {}): string {
  const trimmed = baseUrl.replace(/\/+$/u, '');
  const url = trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
  const entries = Object.entries(query).filter(([, value]) => value.trim().length > 0);
  if (entries.length === 0) return url;
  const result = new URL(url);
  for (const [name, value] of entries) result.searchParams.set(name, value);
  return result.toString();
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
  reasoning_content?: string;
}

function toOpenAIMessages(
  context: Context,
  requestPlan: RequestPlan,
  promptCache?: StreamOptions['promptCache'],
): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  const prompt = partitionSystemPrompt(context);
  const explicitBreakpoint = promptCache?.enabled === true
    && promptCache.breakpointCarrier === 'openai-prompt-cache'
    && (
      promptCache.breakpoint === 'explicit'
      || promptCache.breakpoint === 'automatic-and-explicit'
    );
  if (explicitBreakpoint) {
    if (!prompt.stableText) {
      throw new Error(
        'PROMPT_CACHE_STABLE_PREFIX_UNAVAILABLE: explicit OpenAI cache mode requires PromptPlan-owned stable segments.',
      );
    }
    const content: Array<Record<string, unknown>> = [{
      type: 'text',
      text: prompt.stableText,
      prompt_cache_breakpoint: { mode: 'explicit' },
    }];
    if (prompt.volatileText) content.push({ type: 'text', text: prompt.volatileText });
    out.push({ role: 'system', content });
  } else if (prompt.combinedText) {
    out.push({ role: 'system', content: prompt.combinedText });
  }
  const requireReasoningContent = requiresAssistantReasoningContent(
    requestPlan,
    Boolean(context.tools && context.tools.length > 0),
  );
  for (const message of context.messages) {
    out.push(...convertMessage(message, requestPlan, requireReasoningContent));
  }
  return out;
}

function convertMessage(
  message: Message,
  requestPlan: RequestPlan,
  requireReasoningContent: boolean,
): OpenAIMessage[] {
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
    const toolCalls: Required<OpenAIMessage>['tool_calls'] = [];
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
    const out: OpenAIMessage = {
      role: 'assistant',
      content: text.length > 0 ? text.join('') : null,
    };
    if (toolCalls.length > 0) out.tool_calls = toolCalls;
    if (reasoning.length > 0) out.reasoning_content = reasoning.join('');
    else if (requireReasoningContent) out.reasoning_content = '';
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

export const __testing = { buildChatCompletionsUrl, mapFinishReason, toOpenAIMessages };
