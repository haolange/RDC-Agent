import { EventStream } from '../core/EventStream';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Message,
  Model,
  ProviderCapabilities,
  ProviderReasoningArtifact,
  StopReason,
  StreamOptions,
  ToolDefinition,
} from '../core/types';
import { applyRequestPlanBody, requestPlanHeaders } from './requestPlanWire';
import { AssistantStreamBuilder } from './internal/AssistantStreamBuilder';
import {
  composeAbortSignals,
  ensureOk,
  normalizeError,
  parseSSE,
  ProviderHttpError,
} from './internal/http';
import { buildOpenAiResponsesReasoning, isReasoningEnabled } from './reasoningWire';

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
  capabilities?: Partial<ProviderCapabilities>;
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
    input_tokens_details?: { cached_tokens?: number };
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
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string };

export class OpenAIResponsesProvider implements ProviderStrategy {
  readonly api = PROVIDER_API;
  private readonly defaultBaseUrl: string;
  private readonly defaultApiKey: string | undefined;
  private readonly accountId: string | undefined;
  private readonly defaultHeaders: Record<string, string>;
  private readonly capabilities: ProviderCapabilities;

  constructor(options: OpenAIResponsesProviderOptions = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.defaultApiKey = options.apiKey;
    this.accountId = options.accountId?.trim() || undefined;
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
        throw new ProviderHttpError(PROVIDER_API, 401, 'missing apiKey for OpenAI Responses provider');
      }

      const response = await fetch(createResponsesUrl(baseUrl), {
        method: 'POST',
        headers: { ...this.createHeaders(apiKey), ...requestPlanHeaders(options.requestPlan) },
        body: JSON.stringify(applyRequestPlanBody(buildRequestBody(model, context, options), options.requestPlan)),
        signal: composed.signal,
      });

      await ensureOk(response, PROVIDER_API);

      const toolSlotsByItemId = new Map<string, number>();
      const toolArgBuffers = new Map<number, string>();
      let currentReasoningArtifact: ProviderReasoningArtifact | undefined;
      let sawToolCall = false;
      let sawOutput = false;
      let finishReason: StopReason = 'stop';

      for await (const data of parseSSE(response, composed.signal, { providerApi: PROVIDER_API, ...options })) {
        if (composed.signal.aborted) break;
        const event = parseJsonObject(data);
        if (!event) continue;

        const eventType = readString(event.type);
        switch (eventType) {
          case 'response.output_text.delta': {
            const delta = readString(event.delta) || readString(event.text);
            if (delta) {
              sawOutput = true;
              builder.appendText(TEXT_INDEX, delta);
            }
            break;
          }
          case 'response.output_text.done':
            builder.endText(TEXT_INDEX);
            break;
          case 'response.reasoning_summary_text.delta': {
            const delta = readString(event.delta) || readString(event.text);
            if (delta) {
              sawOutput = true;
              builder.appendThinking(REASONING_INDEX, delta, {
                kind: 'summary',
                source: 'openai-responses-summary',
                visibility: 'summary',
                replayPolicy: currentReasoningArtifact ? 'provider-artifact' : 'none',
                artifact: currentReasoningArtifact,
              });
            }
            break;
          }
          case 'response.reasoning_summary_text.done':
            builder.endThinking(REASONING_INDEX, {
              kind: 'summary',
              source: 'openai-responses-summary',
              visibility: 'summary',
              replayPolicy: currentReasoningArtifact ? 'provider-artifact' : 'none',
              artifact: currentReasoningArtifact,
            });
            break;
          case 'response.output_item.added': {
            const outputIndex = readNumber(event.output_index) ?? 0;
            const item = readRecord(event.item);
            const reasoningArtifact = createResponsesReasoningArtifact(model, item);
            if (reasoningArtifact) {
              currentReasoningArtifact = reasoningArtifact;
              sawOutput = true;
              builder.updateThinking(REASONING_INDEX, {
                kind: 'opaque',
                source: 'openai-responses-encrypted',
                visibility: 'hidden',
                replayPolicy: 'provider-artifact',
                artifact: currentReasoningArtifact,
              });
            } else if (readString(item?.type) === 'function_call') {
              const slot = TOOL_INDEX_BASE + outputIndex;
              const itemId = readString(item?.id);
              if (itemId) toolSlotsByItemId.set(itemId, slot);
              sawToolCall = true;
              sawOutput = true;
              builder.ensureToolCall(
                slot,
                readString(item?.call_id) || readString(item?.id) || '',
                readString(item?.name) || '',
              );
            }
            break;
          }
          case 'response.function_call_arguments.delta': {
            const slot = resolveToolSlot(event, toolSlotsByItemId);
            const delta = readString(event.delta);
            if (slot !== null && delta) {
              toolArgBuffers.set(slot, `${toolArgBuffers.get(slot) ?? ''}${delta}`);
              builder.appendToolCallArgs(slot, delta);
            }
            break;
          }
          case 'response.function_call_arguments.done': {
            const slot = resolveToolSlot(event, toolSlotsByItemId);
            const args = readString(event.arguments);
            if (slot !== null && args && !toolArgBuffers.get(slot)) {
              toolArgBuffers.set(slot, args);
              builder.appendToolCallArgs(slot, args);
            }
            if (slot !== null) builder.endToolCall(slot);
            break;
          }
          case 'response.output_item.done': {
            const outputIndex = readNumber(event.output_index) ?? 0;
            const item = readRecord(event.item);
            const reasoningArtifact = createResponsesReasoningArtifact(model, item);
            if (reasoningArtifact) {
              currentReasoningArtifact = reasoningArtifact;
              sawOutput = true;
              builder.updateThinking(REASONING_INDEX, {
                kind: 'opaque',
                source: 'openai-responses-encrypted',
                visibility: 'hidden',
                replayPolicy: 'provider-artifact',
                artifact: currentReasoningArtifact,
              });
            } else if (readString(item?.type) === 'function_call') {
              const slot = TOOL_INDEX_BASE + outputIndex;
              const itemId = readString(item?.id);
              if (itemId) toolSlotsByItemId.set(itemId, slot);
              sawToolCall = true;
              sawOutput = true;
              builder.ensureToolCall(
                slot,
                readString(item?.call_id) || readString(item?.id) || '',
                readString(item?.name) || '',
              );
              const args = readString(item?.arguments);
              if (args && !toolArgBuffers.get(slot)) {
                toolArgBuffers.set(slot, args);
                builder.appendToolCallArgs(slot, args);
              }
              builder.endToolCall(slot);
            }
            break;
          }
          case 'response.completed': {
            const completed = readRecord(event.response) as ResponsesCompletedPayload | null;
            if (completed) {
              applyCompletedResponse(builder, completed);
              const completedArtifact = findResponsesReasoningArtifact(model, completed.output);
              if (completedArtifact) {
                currentReasoningArtifact = completedArtifact;
                builder.updateThinking(REASONING_INDEX, {
                  kind: 'summary',
                  source: 'openai-responses-summary',
                  visibility: 'summary',
                  replayPolicy: 'provider-artifact',
                  artifact: currentReasoningArtifact,
                });
              }
              finishReason = completed.status === 'incomplete' ? 'length' : sawToolCall ? 'toolUse' : 'stop';
            }
            break;
          }
          case 'response.incomplete':
            finishReason = 'length';
            break;
          case 'response.failed': {
            const failed = readRecord(event.response);
            const error = readRecord(failed?.error);
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

function createResponsesUrl(baseUrl: string): string {
  return baseUrl.endsWith('/responses') ? baseUrl : `${baseUrl}/responses`;
}

function buildRequestBody(model: Model, context: Context, options: StreamOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: model.id,
    input: toResponsesInput(context),
    stream: true,
    store: false,
    parallel_tool_calls: true,
  };
  if (context.systemPrompt?.trim()) {
    body.instructions = context.systemPrompt.trim();
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

function toResponsesInput(context: Context): unknown[] {
  const items: unknown[] = [];
  for (const message of context.messages) {
    items.push(...convertMessage(message));
  }
  return items;
}

function convertMessage(message: Message): unknown[] {
  if (message.role === 'user') {
    return [toInputMessage('user', message.content)];
  }

  if (message.role === 'assistant') {
    const items: unknown[] = [];
    for (const block of message.content) {
      if (block.type === 'thinking') {
        const replayItem = toResponsesReasoningReplayItem(block.artifact, block.replayPolicy);
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
  artifact: ProviderReasoningArtifact | undefined,
  replayPolicy: string,
): Record<string, unknown> | null {
  if (replayPolicy !== 'provider-artifact' || !artifact) return null;
  if (artifact.protocol !== PROVIDER_API && artifact.protocol !== 'OpenAIResponses') return null;
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

function applyCompletedResponse(builder: AssistantStreamBuilder, payload: ResponsesCompletedPayload): void {
  if (payload.usage) {
    const cacheReadTokens = payload.usage.input_tokens_details?.cached_tokens;
    const reasoningTokens = payload.usage.output_tokens_details?.reasoning_tokens;
    builder.setUsage({
      inputTokens: payload.usage.input_tokens ?? 0,
      outputTokens: payload.usage.output_tokens ?? 0,
      totalTokens:
        payload.usage.total_tokens
        ?? (payload.usage.input_tokens ?? 0) + (payload.usage.output_tokens ?? 0),
      ...(typeof cacheReadTokens === 'number' ? { cacheReadTokens } : {}),
      ...(typeof reasoningTokens === 'number' ? { reasoningTokens } : {}),
    });
  }
}

function createResponsesReasoningArtifact(
  model: Model,
  item: Record<string, unknown> | null | undefined,
): ProviderReasoningArtifact | undefined {
  if (readString(item?.type) !== 'reasoning') return undefined;
  const encryptedContent = readString(item?.encrypted_content) || readString(item?.encryptedContent);
  return {
    providerId: model.provider,
    modelId: model.id,
    protocol: PROVIDER_API,
    type: 'reasoning',
    id: readString(item?.id) || undefined,
    encryptedContent: encryptedContent || undefined,
    raw: item ?? undefined,
  };
}

function findResponsesReasoningArtifact(
  model: Model,
  output: unknown[] | undefined,
): ProviderReasoningArtifact | undefined {
  if (!Array.isArray(output)) return undefined;
  for (const item of output) {
    const artifact = createResponsesReasoningArtifact(model, readRecord(item));
    if (artifact) return artifact;
  }
  return undefined;
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

export const __testing = { buildRequestBody, isReasoningEnabled, toResponsesInput };
