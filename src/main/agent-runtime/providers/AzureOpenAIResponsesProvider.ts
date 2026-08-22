/**
 * Azure OpenAI Responses Provider —— 适配 Azure OpenAI Responses API 协议。
 *
 * Azure uses:
 * - `api-key` header (not Bearer) for authentication
 * - `api-version` query param (default: 2024-10-21)
 * - Same Responses API wire format as OpenAI (previous_response_id, encrypted_content)
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
  ProviderContinuationArtifact,
  StopReason,
  StreamOptions,
  ToolDefinition,
} from '../core/types';
import { applyRequestPlanBody, requestPlanHeaders } from './requestPlanWire';
import { partitionSystemPrompt } from './promptCacheWire';
import { recordQuotaFromResponse } from '../../settings/ProviderQuota';
import { AssistantStreamBuilder, createProviderOutputRef, ProviderStreamProtocolError } from './internal/AssistantStreamBuilder';
import { ResponsesItemChannels } from './internal/responsesItemChannels';
import {
  composeAbortSignals,
  ensureOk,
  normalizeError,
  parseSSE,
  ProviderHttpError,
} from './internal/http';
import { finalizeProviderUsage } from './internal/normalizeCacheUsage';
import { buildOpenAiResponsesReasoning } from './reasoningWire';
import { reasoningProjectionSource } from './reasoningProjection';
import type { RequestPlan } from '@shared/types/providerCapability';
import { createContinuationArtifact } from '../reasoning/ContinuationArtifacts';
import { decideContinuationReplay } from '../reasoning/ContinuationReplayPolicy';
import { createProviderStateRef, findLatestProviderState } from '../reasoning/ProviderStateRefs';

const DEFAULT_API_VERSION = '2024-10-21';
const PROVIDER_API = 'azure-openai-responses';
const RESPONSES_REASONING_INCLUDE = 'reasoning.encrypted_content';

export interface AzureOpenAIResponsesProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  /** Azure API version; defaults to 2024-10-21. */
  apiVersion?: string;
  headers?: Record<string, string>;
}

interface ResponsesCompletedPayload {
  id?: string;
  model?: string;
  status?: string;
  output?: unknown[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
}

type InputMessageContent = string | Array<{
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}>;

type ResponsesInputContentPart =
  | { type: 'input_text'; text: string; prompt_cache_breakpoint?: { mode: 'explicit' } }
  | { type: 'input_image'; image_url: string };

export class AzureOpenAIResponsesProvider implements ProviderStrategy {
  readonly api = PROVIDER_API;
  private readonly defaultBaseUrl: string;
  private readonly defaultApiKey: string | undefined;
  private readonly apiVersion: string;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: AzureOpenAIResponsesProviderOptions = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
    this.defaultApiKey = options.apiKey;
    this.apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
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
    const composed = composeAbortSignals(options.signal, stream.signal, { providerApi: PROVIDER_API, ...options });

    try {
      builder.start();

      if (!apiKey) {
        throw new ProviderHttpError(PROVIDER_API, 401, 'missing apiKey for Azure OpenAI Responses provider');
      }

      const url = buildAzureResponsesUrl(baseUrl, this.apiVersion);
      const bodyText = JSON.stringify(applyRequestPlanBody(buildRequestBody(model, context, options), options.requestPlan));
      const headers = {
        'Content-Type': 'application/json',
        'api-key': apiKey,
        ...this.defaultHeaders,
        ...requestPlanHeaders(options.requestPlan),
      };
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: bodyText,
        signal: composed.signal,
      });

      recordQuotaFromResponse(options.requestPlan, response);
      await ensureOk(response, PROVIDER_API);

      const toolArgBuffers = new Map<string, string>();
      const summarySource = reasoningProjectionSource(options.requestPlan, 'summary');
      const opaqueSource = reasoningProjectionSource(options.requestPlan, 'opaque');
      const items = new ResponsesItemChannels({
        protocol: PROVIDER_API,
        builder,
        sources: { summary: summarySource, raw: summarySource, opaque: opaqueSource },
      });
      const toolStarted = new Set<string>();
      let sawToolCall = false;
      let sawOutput = false;
      let finishReason: StopReason = 'stop';
      let providerTerminalSeen = false;
      const terminalRef = createProviderOutputRef({
        protocol: PROVIDER_API,
        providerBlockKey: 'response:terminal',
        contentIndex: 1_000_000,
      });
      const toolKey = (outputIndex: number, itemId?: string) => itemId || `index:${outputIndex}`;

      for await (const data of parseSSE(response, composed.signal, { providerApi: PROVIDER_API, ...options })) {
        if (composed.signal.aborted) break;
        const event = parseJsonObject(data);
        if (!event) continue;

        const eventType = readString(event.type);
        if (providerTerminalSeen) {
          throw new ProviderStreamProtocolError(
            'PROVIDER_STREAM_EVENT_AFTER_TERMINAL',
            terminalRef,
            'Provider emitted ' + (eventType || 'an unknown event') + ' after the Responses terminal event.',
          );
        }
        switch (eventType) {
          case 'response.output_text.delta': {
            const delta = readString(event.delta) || readString(event.text);
            if (delta) {
              sawOutput = true;
              items.appendText(items.identityFromEvent(event), delta);
            }
            break;
          }
          case 'response.output_text.done':
            break;
          case 'response.reasoning_summary_text.delta': {
            const delta = readString(event.delta) || readString(event.text);
            if (delta) {
              sawOutput = true;
              items.appendReasoning(
                items.identityFromEvent(event),
                delta,
                'summary',
                undefined,
                readNumber(event.summary_index) ?? undefined,
              );
            }
            break;
          }
          case 'response.reasoning_summary_text.done':
            items.startReasoning(items.identityFromEvent(event), 'summary');
            break;
          case 'response.output_item.added': {
            const item = readRecord(event.item);
            const identity = items.identityFromEvent(event, item);
            const reasoningArtifact = createResponsesReasoningArtifact(options.requestPlan, item);
            if (reasoningArtifact) {
              sawOutput = true;
              items.startReasoning(identity, 'opaque', reasoningArtifact);
            } else if (readString(item?.type) === 'function_call') {
              sawToolCall = true;
              sawOutput = true;
              const toolRef = items.toolRef(identity);
              builder.startToolCall(
                toolRef,
                readString(item?.call_id) || readString(item?.id) || '',
                readString(item?.name) || '',
              );
              toolStarted.add(toolKey(identity.outputIndex, identity.itemId));
            }
            break;
          }
          case 'response.function_call_arguments.delta': {
            const identity = items.identityFromEvent(event);
            const delta = readString(event.delta);
            if (delta) {
              const key = toolKey(identity.outputIndex, identity.itemId);
              toolArgBuffers.set(key, `${toolArgBuffers.get(key) ?? ''}${delta}`);
              builder.appendToolCallArgs(items.toolRef(identity), delta);
            }
            break;
          }
          case 'response.function_call_arguments.done': {
            const identity = items.identityFromEvent(event);
            const args = readString(event.arguments);
            const key = toolKey(identity.outputIndex, identity.itemId);
            if (args && !toolArgBuffers.get(key)) {
              toolArgBuffers.set(key, args);
              builder.appendToolCallArgs(items.toolRef(identity), args);
            }
            break;
          }
          case 'response.output_item.done': {
            const item = readRecord(event.item);
            const identity = items.identityFromEvent(event, item);
            const reasoningArtifact = createResponsesReasoningArtifact(options.requestPlan, item);
            if (reasoningArtifact) {
              sawOutput = true;
              items.startReasoning(identity, 'opaque', reasoningArtifact);
              items.closeReasoning(identity, reasoningArtifact);
            } else if (readString(item?.type) === 'function_call') {
              sawToolCall = true;
              sawOutput = true;
              const toolRef = items.toolRef(identity);
              const key = toolKey(identity.outputIndex, identity.itemId);
              if (toolStarted.has(key)) {
                builder.updateToolCall(toolRef, readString(item?.call_id) || readString(item?.id) || '', readString(item?.name) || '');
              } else {
                builder.startToolCall(toolRef, readString(item?.call_id) || readString(item?.id) || '', readString(item?.name) || '');
                toolStarted.add(key);
              }
              const args = readString(item?.arguments);
              if (args && !toolArgBuffers.get(key)) {
                toolArgBuffers.set(key, args);
                builder.appendToolCallArgs(toolRef, args);
              }
              builder.endToolCall(toolRef);
            } else if (readString(item?.type) === 'message') {
              items.closeText(identity);
            }
            break;
          }
          case 'response.completed': {
            const completed = readRecord(event.response) as ResponsesCompletedPayload | null;
            if (completed) {
              applyCompletedUsage(builder, completed);
              const providerState = createProviderStateRef(options.requestPlan, completed.id);
              if (providerState) builder.setProviderState(providerState);
              items.applyCompletedReasoning(completed.output, (item) => (
                createResponsesReasoningArtifact(options.requestPlan, item)
              ));
              items.closeRemaining();
              finishReason = completed.status === 'incomplete' ? 'length' : sawToolCall ? 'toolUse' : 'stop';
            }
            if (!sawOutput) {
              throw new ProviderHttpError(PROVIDER_API, 502, 'Provider stream ended without assistant output or structured tool call.');
            }
            providerTerminalSeen = true;
            break;
          }
          case 'response.incomplete': {
            items.closeRemaining();
            finishReason = 'length';
            if (!sawOutput) {
              throw new ProviderHttpError(PROVIDER_API, 502, 'Provider stream ended without assistant output or structured tool call.');
            }
            providerTerminalSeen = true;
            break;
          }
          case 'response.failed': {
            const failed = readRecord(event.response);
            const error = readRecord(failed?.error);
            throw new ProviderHttpError(
              PROVIDER_API,
              502,
              readString(error?.message) || 'Azure OpenAI Responses request failed',
            );
          }
          case 'error':
            throw new ProviderHttpError(PROVIDER_API, 502, readString(event.message) || 'Azure OpenAI Responses stream error');
          default:
            break;
        }
      }

      if (!sawOutput) {
        throw new ProviderHttpError(PROVIDER_API, 502, 'Provider stream ended without assistant output or structured tool call.');
      }
      items.closeRemaining();
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
}

export function buildAzureResponsesUrl(baseUrl: string, apiVersion: string): string {
  const trimmed = baseUrl.replace(/\/+$/u, '');
  const path = trimmed.endsWith('/responses') ? trimmed : `${trimmed}/responses`;
  const url = new URL(path);
  url.searchParams.set('api-version', apiVersion);
  return url.toString();
}

function buildRequestBody(model: Model, context: Context, options: StreamOptions): Record<string, unknown> {
  const providerState = findLatestProviderState(context, options.requestPlan);
  const inputContext = providerState
    ? { ...context, messages: context.messages.slice(providerState.assistantMessageIndex + 1) }
    : context;
  const prompt = partitionSystemPrompt(context);
  const explicitBreakpoint = options.promptCache?.enabled === true
    && options.promptCache.breakpointCarrier === 'openai-prompt-cache'
    && (
      options.promptCache.breakpoint === 'explicit'
      || options.promptCache.breakpoint === 'automatic-and-explicit'
    );
  const input = toResponsesInput(inputContext, options.requestPlan);
  if (explicitBreakpoint) {
    if (!prompt.stableText) {
      throw new Error(
        'PROMPT_CACHE_STABLE_PREFIX_UNAVAILABLE: explicit OpenAI cache mode requires PromptPlan-owned stable segments.',
      );
    }
    const content: ResponsesInputContentPart[] = [{
      type: 'input_text',
      text: prompt.stableText,
      prompt_cache_breakpoint: { mode: 'explicit' },
    }];
    if (prompt.volatileText) {
      content.push({ type: 'input_text', text: prompt.volatileText });
    }
    input.unshift({ type: 'message', role: 'developer', content });
  }
  const body: Record<string, unknown> = {
    model: model.id,
    input,
    stream: true,
    store: options.requestPlan.statePlan.store,
    parallel_tool_calls: true,
  };
  if (options.promptCache?.enabled
    && options.promptCache.keyCarrier === 'prompt-cache-key'
    && options.promptCache.requestKey) {
    body.prompt_cache_key = options.promptCache.requestKey;
  }
  if (explicitBreakpoint) {
    body.prompt_cache_options = {
      mode: options.promptCache?.breakpoint === 'explicit' ? 'explicit' : 'implicit',
      ...(options.promptCache?.ttl === 'thirty-minutes' ? { ttl: '30m' } : {}),
    };
  }
  if (providerState) body.previous_response_id = providerState.state.value;
  if (!explicitBreakpoint && prompt.combinedText) {
    body.instructions = prompt.combinedText;
  }
  if (typeof options.temperature === 'number') body.temperature = options.temperature;
  if (typeof options.topP === 'number') body.top_p = options.topP;
  const reasoningPayload = buildOpenAiResponsesReasoning(options.reasoning, options.reasoningVisibility);
  if (reasoningPayload.reasoning) {
    body.reasoning = reasoningPayload.reasoning;
  }
  if (reasoningPayload.include?.includes(RESPONSES_REASONING_INCLUDE)) {
    body.include = [RESPONSES_REASONING_INCLUDE];
  }
  const maxTokens = options.maxTokens ?? model.maxTokens;
  if (typeof maxTokens === 'number' && maxTokens > 0) {
    body.max_output_tokens = maxTokens;
  }
  if (context.tools && context.tools.length > 0) {
    body.tools = context.tools.map(toResponsesTool);
    body.tool_choice = 'auto';
  }
  return body;
}

function toResponsesInput(context: Context, requestPlan: RequestPlan): unknown[] {
  const items: unknown[] = [];
  for (const message of context.messages) {
    items.push(...convertMessage(message, requestPlan));
  }
  return items;
}

function convertMessage(message: Message, requestPlan: RequestPlan): unknown[] {
  if (message.role === 'user') {
    return [toInputMessage('user', message.content)];
  }

  if (message.role === 'assistant') {
    const items: unknown[] = [];
    for (const block of message.content) {
      if (block.type === 'thinking') {
        const replayItem = toResponsesReasoningReplayItem(
          block.continuation,
          requestPlan,
          message.content.some((candidate) => candidate.type === 'toolCall'),
        );
        if (replayItem) items.push(replayItem);
      }
    }
    const text = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    if (text) {
      items.push({ role: 'assistant', content: text, type: 'message' });
    }
    for (const block of message.content) {
      if (block.type === 'toolCall') {
        items.push({
          type: 'function_call',
          call_id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.arguments ?? {}),
          status: 'completed',
        });
      }
    }
    return items;
  }

  const output = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  return [{
    type: 'function_call_output',
    call_id: message.toolCallId,
    output,
  }];
}

function toInputMessage(role: 'user' | 'assistant', content: InputMessageContent): unknown {
  if (typeof content === 'string') {
    return { role, content, type: 'message' };
  }
  const parts: ResponsesInputContentPart[] = content.flatMap((block): ResponsesInputContentPart[] => {
    if (block.type === 'text') {
      return [{ type: 'input_text', text: block.text ?? '' }];
    }
    if (block.type === 'image' && block.data && block.mimeType) {
      return [{ type: 'input_image', image_url: `data:${block.mimeType};base64,${block.data}` }];
    }
    return [];
  });
  return { role, content: parts.length > 0 ? parts : [{ type: 'input_text', text: '' }], type: 'message' };
}

function toResponsesReasoningReplayItem(
  artifact: ProviderContinuationArtifact | undefined,
  requestPlan: RequestPlan,
  sameToolLoop: boolean,
): Record<string, unknown> | null {
  const decision = decideContinuationReplay(artifact, requestPlan, { sameToolLoop });
  if (decision.action !== 'replay' || !artifact || artifact.carrier !== 'reasoning-item') return null;
  if (artifact.raw) return artifact.raw;
  const item: Record<string, unknown> = { type: artifact.type || 'reasoning' };
  if (artifact.id) item.id = artifact.id;
  if (artifact.encryptedContent) item.encrypted_content = artifact.encryptedContent;
  return item.id || item.encrypted_content ? item : null;
}

function toResponsesTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

function applyCompletedUsage(builder: AssistantStreamBuilder, payload: ResponsesCompletedPayload): void {
  if (payload.usage) {
    const cacheReadTokens = payload.usage.input_tokens_details?.cached_tokens;
    const cacheWriteTokens = payload.usage.input_tokens_details?.cache_write_tokens;
    const reasoningTokens = payload.usage.output_tokens_details?.reasoning_tokens;
    builder.setUsage(finalizeProviderUsage({
      inputTokens: payload.usage.input_tokens ?? 0,
      outputTokens: payload.usage.output_tokens ?? 0,
      totalTokens:
        payload.usage.total_tokens
        ?? (payload.usage.input_tokens ?? 0) + (payload.usage.output_tokens ?? 0),
      ...(typeof cacheReadTokens === 'number' ? { cacheReadTokens } : {}),
      ...(typeof cacheWriteTokens === 'number' ? { cacheWriteTokens } : {}),
      ...(typeof reasoningTokens === 'number' ? { reasoningTokens } : {}),
    }));
  }
}

function createResponsesReasoningArtifact(
  requestPlan: RequestPlan,
  item: Record<string, unknown> | null | undefined,
): ProviderContinuationArtifact | undefined {
  if (readString(item?.type) !== 'reasoning') return undefined;
  const encryptedContent = readString(item?.encrypted_content) || readString(item?.encryptedContent);
  return createContinuationArtifact(requestPlan, {
    type: 'reasoning',
    id: readString(item?.id) || undefined,
    encryptedContent: encryptedContent || undefined,
    raw: item ?? undefined,
  });
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export const __testing = { buildAzureResponsesUrl, buildRequestBody, toResponsesInput };
