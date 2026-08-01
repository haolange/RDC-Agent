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
import {
  composeAbortSignals,
  ensureOk,
  normalizeError,
  parseSSE,
  ProviderHttpError,
} from './internal/http';
import { finalizeProviderUsage } from './internal/normalizeCacheUsage';
import { buildOpenAiResponsesReasoning, isReasoningEnabled } from './reasoningWire';
import { reasoningProjectionSource } from './reasoningProjection';
import type { ProviderRequestAuthorizer } from '../../settings/AwsBedrockCredentials';
import type { RequestPlan } from '@shared/types/providerCapability';
import { createContinuationArtifact } from '../reasoning/ContinuationArtifacts';
import { decideContinuationReplay } from '../reasoning/ContinuationReplayPolicy';
import { createProviderStateRef, findLatestProviderState } from '../reasoning/ProviderStateRefs';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const PROVIDER_API = 'openai-responses';
const TEXT_INDEX = 0;
const REASONING_INDEX = 1;
const TOOL_INDEX_BASE = 2;
const RESPONSES_REASONING_INCLUDE = 'reasoning.encrypted_content';

export interface OpenAIResponsesProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  accountId?: string;
  headers?: Record<string, string>;
  /** Body-aware authorization, used by transports such as AWS SigV4. */
  requestAuthorizer?: ProviderRequestAuthorizer;
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

export class OpenAIResponsesProvider implements ProviderStrategy {
  readonly api = PROVIDER_API;
  private readonly defaultBaseUrl: string;
  private readonly defaultApiKey: string | undefined;
  private readonly accountId: string | undefined;
  private readonly defaultHeaders: Record<string, string>;
  private readonly requestAuthorizer: ProviderRequestAuthorizer | undefined;

  constructor(options: OpenAIResponsesProviderOptions = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.defaultApiKey = options.apiKey;
    this.accountId = options.accountId?.trim() || undefined;
    this.defaultHeaders = { ...(options.headers ?? {}) };
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
    const composed = composeAbortSignals(options.signal, stream.signal, { providerApi: PROVIDER_API, ...options });

    try {
      builder.start();

      if (!apiKey && !this.requestAuthorizer) {
        throw new ProviderHttpError(PROVIDER_API, 401, 'missing apiKey for OpenAI Responses provider');
      }

      const url = buildOpenAIResponsesUrl(baseUrl);
      const bodyText = JSON.stringify(applyRequestPlanBody(buildRequestBody(model, context, options), options.requestPlan));
      const unsignedHeaders = apiKey
        ? { ...this.createHeaders(apiKey), ...requestPlanHeaders(options.requestPlan) }
        : { 'Content-Type': 'application/json', ...this.defaultHeaders, ...requestPlanHeaders(options.requestPlan) };
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

      const toolSlotsByItemId = new Map<string, number>();
      const toolArgBuffers = new Map<number, string>();
      let currentReasoningArtifact: ProviderContinuationArtifact | undefined;
      const summarySource = reasoningProjectionSource(options.requestPlan, 'summary');
      const rawSource = reasoningProjectionSource(options.requestPlan, 'raw');
      const opaqueSource = reasoningProjectionSource(options.requestPlan, 'opaque');
      const deepSeekResponses = isDeepSeekResponsesPlan(options.requestPlan);
      const textRef = createProviderOutputRef({ protocol: PROVIDER_API, providerBlockKey: 'virtual:text', contentIndex: TEXT_INDEX });
      const reasoningRef = createProviderOutputRef({ protocol: PROVIDER_API, providerBlockKey: 'virtual:reasoning', contentIndex: REASONING_INDEX });
      const toolRefs = new Map<number, ReturnType<typeof createProviderOutputRef>>();
      const toolStartedSlots = new Set<number>();
      let textStarted = false;
      let thinkingStarted = false;
      let thinkingClosed = false;
      let thinkingMode: 'summary' | 'raw' | 'opaque' | null = null;
      let rawReasoningText = '';
      const toolRefFor = (slot: number, itemId?: string) => {
        const existing = toolRefs.get(slot);
        if (existing) return existing;
        const sourceIndex = slot - TOOL_INDEX_BASE;
        const ref = createProviderOutputRef({ protocol: PROVIDER_API, providerBlockKey: `output:tool:${sourceIndex}`, sourceIndex, itemId, contentIndex: slot });
        toolRefs.set(slot, ref);
        return ref;
      };
      let sawToolCall = false;
      let sawOutput = false;
      let finishReason: StopReason = 'stop';
      let providerTerminalSeen = false;
      const terminalRef = createProviderOutputRef({
        protocol: PROVIDER_API,
        providerBlockKey: 'response:terminal',
        contentIndex: 1_000_000,
      });

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
              if (!textStarted) { builder.startText(textRef); textStarted = true; }
              builder.appendText(textRef, delta);
            }
            break;
          }
          case 'response.output_text.done':
            if (textStarted) builder.endText(textRef);
            break;
          case 'response.reasoning_summary_text.delta': {
            const delta = readString(event.delta) || readString(event.text);
            if (delta) {
              sawOutput = true;
              if (!thinkingStarted) {
                builder.startThinking(reasoningRef, {
                  kind: 'summary', source: summarySource, visibility: 'summary',
                  continuation: currentReasoningArtifact,
                });
                thinkingStarted = true;
                thinkingMode = 'summary';
              }
              builder.appendThinking(reasoningRef, delta, {
                kind: 'summary',
                source: summarySource,
                visibility: 'summary',
                continuation: currentReasoningArtifact,
              });
            }
            break;
          }
          case 'response.reasoning_summary_text.done':
            if (!thinkingStarted) {
              builder.startThinking(reasoningRef, {
                kind: 'summary', source: summarySource, visibility: 'summary',
                continuation: currentReasoningArtifact,
              });
              thinkingStarted = true;
              thinkingMode = 'summary';
            }
            builder.endThinking(reasoningRef, {
              kind: 'summary',
              source: summarySource,
              visibility: 'summary',
              continuation: currentReasoningArtifact,
            });
            thinkingClosed = true;
            break;
          case 'response.reasoning_text.delta': {
            const delta = readString(event.delta) || readString(event.text);
            if (delta) {
              sawOutput = true;
              rawReasoningText += delta;
              if (!thinkingStarted) {
                builder.startThinking(reasoningRef, {
                  kind: 'raw', source: rawSource, visibility: 'raw-collapsed',
                  continuation: currentReasoningArtifact,
                });
                thinkingStarted = true;
                thinkingMode = 'raw';
              }
              builder.appendThinking(reasoningRef, delta, {
                kind: 'raw', source: rawSource, visibility: 'raw-collapsed',
                continuation: currentReasoningArtifact,
              });
            }
            break;
          }
          case 'response.reasoning_text.done': {
            const fullText = readString(event.text) || readString(event.reasoning_text);
            if (fullText && !rawReasoningText) {
              sawOutput = true;
              rawReasoningText = fullText;
              if (!thinkingStarted) {
                builder.startThinking(reasoningRef, {
                  kind: 'raw', source: rawSource, visibility: 'raw-collapsed',
                  continuation: currentReasoningArtifact,
                });
                thinkingStarted = true;
                thinkingMode = 'raw';
              }
              builder.appendThinking(reasoningRef, fullText, {
                kind: 'raw', source: rawSource, visibility: 'raw-collapsed',
                continuation: currentReasoningArtifact,
              });
            }
            break;
          }
          case 'response.output_item.added': {
            const outputIndex = readNumber(event.output_index) ?? 0;
            const item = readRecord(event.item);
            const reasoningArtifact = createResponsesReasoningArtifact(options.requestPlan, item);
            if (reasoningArtifact) {
              currentReasoningArtifact = reasoningArtifact;
              if (!deepSeekResponses) {
                sawOutput = true;
                if (!thinkingStarted) {
                  builder.startThinking(reasoningRef, {
                    kind: 'opaque',
                    source: opaqueSource,
                    visibility: 'hidden',
                    continuation: currentReasoningArtifact,
                  });
                  thinkingStarted = true;
                  thinkingMode = 'opaque';
                } else if (!thinkingClosed) {
                  builder.updateThinking(reasoningRef, {
                    kind: thinkingMode ?? 'opaque',
                    source: thinkingMode === 'summary' ? summarySource : opaqueSource,
                    visibility: thinkingMode === 'summary' ? 'summary' : 'hidden',
                    continuation: currentReasoningArtifact,
                  });
                }
              }
            } else if (readString(item?.type) === 'function_call') {
              const slot = TOOL_INDEX_BASE + outputIndex;
              const itemId = readString(item?.id);
              if (itemId) toolSlotsByItemId.set(itemId, slot);
              sawToolCall = true;
              sawOutput = true;
              const toolRef = toolRefFor(slot, itemId || undefined);
              builder.startToolCall(
                toolRef,
                readString(item?.call_id) || readString(item?.id) || '',
                readString(item?.name) || '',
              );
              toolStartedSlots.add(slot);
            }
            break;
          }
          case 'response.function_call_arguments.delta': {
            const slot = resolveToolSlot(event, toolSlotsByItemId);
            const delta = readString(event.delta);
            if (slot !== null && delta) {
              toolArgBuffers.set(slot, `${toolArgBuffers.get(slot) ?? ''}${delta}`);
              builder.appendToolCallArgs(toolRefFor(slot, readString(event.item_id) || undefined), delta);
            }
            break;
          }
          case 'response.function_call_arguments.done': {
            const slot = resolveToolSlot(event, toolSlotsByItemId);
            const args = readString(event.arguments);
            if (slot !== null && args && !toolArgBuffers.get(slot)) {
              toolArgBuffers.set(slot, args);
              builder.appendToolCallArgs(toolRefFor(slot, readString(event.item_id) || undefined), args);
            }
            break;
          }
          case 'response.output_item.done': {
            const outputIndex = readNumber(event.output_index) ?? 0;
            const item = readRecord(event.item);
            const reasoningArtifact = createResponsesReasoningArtifact(options.requestPlan, item);
            if (reasoningArtifact) {
              currentReasoningArtifact = reasoningArtifact;
              if (deepSeekResponses) {
                const itemReasoningText = readDeepSeekReasoningText(item);
                if (itemReasoningText && !rawReasoningText) {
                  sawOutput = true;
                  rawReasoningText = itemReasoningText;
                  if (!thinkingStarted) {
                    builder.startThinking(reasoningRef, {
                      kind: 'raw', source: rawSource, visibility: 'raw-collapsed',
                      continuation: currentReasoningArtifact,
                    });
                    thinkingStarted = true;
                    thinkingMode = 'raw';
                  }
                  builder.appendThinking(reasoningRef, itemReasoningText, {
                    kind: 'raw', source: rawSource, visibility: 'raw-collapsed',
                    continuation: currentReasoningArtifact,
                  });
                }
                if (thinkingStarted && !thinkingClosed && thinkingMode === 'raw') {
                  builder.endThinking(reasoningRef, {
                    kind: 'raw', source: rawSource, visibility: 'raw-collapsed',
                    continuation: currentReasoningArtifact,
                  });
                  thinkingClosed = true;
                }
              } else {
                sawOutput = true;
                if (!thinkingStarted) {
                  builder.startThinking(reasoningRef, {
                    kind: 'opaque',
                    source: opaqueSource,
                    visibility: 'hidden',
                    continuation: currentReasoningArtifact,
                  });
                  thinkingStarted = true;
                  thinkingMode = 'opaque';
                } else if (!thinkingClosed) builder.updateThinking(reasoningRef, {
                  kind: 'opaque',
                  source: opaqueSource,
                  visibility: 'hidden',
                  continuation: currentReasoningArtifact,
                });
              }
            } else if (readString(item?.type) === 'function_call') {
              const slot = TOOL_INDEX_BASE + outputIndex;
              const itemId = readString(item?.id);
              if (itemId) toolSlotsByItemId.set(itemId, slot);
              sawToolCall = true;
              sawOutput = true;
              const toolRef = toolRefFor(slot, itemId || undefined);
              if (toolStartedSlots.has(slot)) {
                builder.updateToolCall(toolRef, readString(item?.call_id) || readString(item?.id) || '', readString(item?.name) || '');
              } else {
                builder.startToolCall(toolRef, readString(item?.call_id) || readString(item?.id) || '', readString(item?.name) || '');
                toolStartedSlots.add(slot);
              }
              const args = readString(item?.arguments);
              if (args && !toolArgBuffers.get(slot)) {
                toolArgBuffers.set(slot, args);
                builder.appendToolCallArgs(toolRef, args);
              }
              builder.endToolCall(toolRef);
            }
            break;
          }
          case 'response.completed': {
            const completed = readRecord(event.response) as ResponsesCompletedPayload | null;
            if (completed) {
              applyCompletedUsage(builder, completed);
              const providerState = createProviderStateRef(options.requestPlan, completed.id);
              if (providerState) builder.setProviderState(providerState);
              const completedArtifact = findResponsesReasoningArtifact(options.requestPlan, completed.output);
              if (completedArtifact) {
                currentReasoningArtifact = completedArtifact;
                if (thinkingStarted && !thinkingClosed) {
                  const kind = thinkingMode ?? (deepSeekResponses ? 'raw' : 'opaque');
                  const source = kind === 'raw' ? rawSource : kind === 'summary' ? summarySource : opaqueSource;
                  const visibility = kind === 'raw' ? 'raw-collapsed' : kind === 'summary' ? 'summary' : 'hidden';
                  builder.endThinking(reasoningRef, {
                    kind,
                    source,
                    visibility,
                    continuation: currentReasoningArtifact,
                  });
                  thinkingClosed = true;
                }
              }
              finishReason = completed.status === 'incomplete' ? 'length' : sawToolCall ? 'toolUse' : 'stop';
            }
            if (!sawOutput) {
              throw new ProviderHttpError(PROVIDER_API, 502, 'Provider stream ended without assistant output or structured tool call.');
            }
            providerTerminalSeen = true;
            break;
          }
          case 'response.incomplete': {
            const incomplete = readRecord(event.response) as ResponsesCompletedPayload | null;
            if (incomplete) {
              applyCompletedUsage(builder, incomplete);
              const incompleteArtifact = findResponsesReasoningArtifact(options.requestPlan, incomplete.output);
              if (incompleteArtifact) currentReasoningArtifact = incompleteArtifact;
            }
            if (thinkingStarted && !thinkingClosed) {
              const kind = thinkingMode ?? (deepSeekResponses ? 'raw' : 'opaque');
              const source = kind === 'raw' ? rawSource : kind === 'summary' ? summarySource : opaqueSource;
              const visibility = kind === 'raw' ? 'raw-collapsed' : kind === 'summary' ? 'summary' : 'hidden';
              builder.endThinking(reasoningRef, { kind, source, visibility, continuation: currentReasoningArtifact });
              thinkingClosed = true;
            }
            finishReason = 'length';
            if (!sawOutput) {
              throw new ProviderHttpError(PROVIDER_API, 502, 'Provider stream ended without assistant output or structured tool call.');
            }
            providerTerminalSeen = true;
            break;
          }
          case 'response.failed': {
            const failed = readRecord(event.response);
            const error = readRecord(failed?.error) ?? readRecord(event.error);
            throw new ProviderHttpError(
              PROVIDER_API,
              502,
              readString(error?.message) || 'OpenAI Responses request failed',
            );
          }
          case 'error':
            throw new ProviderHttpError(PROVIDER_API, 502, readString(event.message) || 'OpenAI Responses stream error');
          default:
            break;
        }
      }

      if (!sawOutput) {
        throw new ProviderHttpError(PROVIDER_API, 502, 'Provider stream ended without assistant output or structured tool call.');
      }
      if (thinkingStarted && !thinkingClosed) {
        const kind = thinkingMode ?? (deepSeekResponses ? 'raw' : 'opaque');
        const source = kind === 'raw' ? rawSource : kind === 'summary' ? summarySource : opaqueSource;
        const visibility = kind === 'raw' ? 'raw-collapsed' : kind === 'summary' ? 'summary' : 'hidden';
        builder.endThinking(reasoningRef, { kind, source, visibility, continuation: currentReasoningArtifact });
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

  private createHeaders(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...this.defaultHeaders,
    };
    if (this.accountId) {
      headers['chatgpt-account-id'] = this.accountId;
    }
    return headers;
  }
}

export function buildOpenAIResponsesUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/u, '');
  return trimmed.endsWith('/responses') ? trimmed : `${trimmed}/responses`;
}

function buildRequestBody(model: Model, context: Context, options: StreamOptions): Record<string, unknown> {
  const deepSeekResponses = isDeepSeekResponsesPlan(options.requestPlan);
  const providerState = deepSeekResponses ? undefined : findLatestProviderState(context, options.requestPlan);
  const inputContext = providerState
    ? { ...context, messages: context.messages.slice(providerState.assistantMessageIndex + 1) }
    : context;
  const prompt = partitionSystemPrompt(context);
  const explicitBreakpoint = !deepSeekResponses && options.promptCache?.enabled === true
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
    ...(!deepSeekResponses ? {
      store: options.requestPlan.statePlan.store,
      parallel_tool_calls: true,
    } : {}),
  };
  if (!deepSeekResponses && options.promptCache?.enabled
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
  if (!deepSeekResponses && reasoningPayload.include?.includes(RESPONSES_REASONING_INCLUDE)) {
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

function findResponsesReasoningArtifact(
  requestPlan: RequestPlan,
  output: unknown[] | undefined,
): ProviderContinuationArtifact | undefined {
  if (!Array.isArray(output)) return undefined;
  for (const item of output) {
    const artifact = createResponsesReasoningArtifact(requestPlan, readRecord(item));
    if (artifact) return artifact;
  }
  return undefined;
}

function isDeepSeekResponsesPlan(requestPlan: RequestPlan): boolean {
  return requestPlan.executionIdentity.protocolDialect === 'DeepSeekResponses';
}

function readDeepSeekReasoningText(item: Record<string, unknown> | null | undefined): string {
  if (!item) return '';
  if (typeof item.content === 'string') return item.content;
  if (!Array.isArray(item.content)) return '';
  return item.content.flatMap((part): string[] => {
    const value = readRecord(part);
    const text = readString(value?.text) || readString(value?.content);
    return text ? [text] : [];
  }).join('');
}

function resolveToolSlot(event: Record<string, unknown>, toolSlotsByItemId: Map<string, number>): number | null {
  const itemId = readString(event.item_id);
  if (itemId && toolSlotsByItemId.has(itemId)) {
    return toolSlotsByItemId.get(itemId) ?? null;
  }
  const outputIndex = readNumber(event.output_index);
  return outputIndex === null ? null : TOOL_INDEX_BASE + outputIndex;
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

export const __testing = {
  buildRequestBody,
  isDeepSeekResponsesPlan,
  isReasoningEnabled,
  readDeepSeekReasoningText,
  toResponsesInput,
};
