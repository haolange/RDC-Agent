import { EventStream } from '../core/EventStream';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Message,
  Model,
  ProviderOutputRef,
  ProviderContinuationArtifact,
  StopReason,
  StreamOptions,
  ThinkingArtifactKind,
  ThinkingArtifactVisibility,
  ToolDefinition,
} from '../core/types';
import { applyRequestPlanBody, requestPlanHeaders } from './requestPlanWire';
import { partitionSystemPrompt } from './promptCacheWire';
import { recordQuotaFromResponse } from '../../settings/ProviderQuota';
import type { ReasoningVisibility } from '@shared/types/agentRuntime';
import { AssistantStreamBuilder, createProviderOutputRef } from './internal/AssistantStreamBuilder';
import {
  composeAbortSignals,
  ensureOk,
  normalizeError,
  parseSSE,
  ProviderHttpError,
} from './internal/http';
import { applyReasoningToAnthropicLikeBody } from './reasoningWire';
import { reasoningProjectionSource } from './reasoningProjection';
import type { RequestPlan } from '@shared/types/providerCapability';
import { createContinuationArtifact } from '../reasoning/ContinuationArtifacts';
import { decideContinuationReplay } from '../reasoning/ContinuationReplayPolicy';

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
    | { type: 'thinking'; thinking?: string; signature?: string }
    | { type: 'redacted_thinking'; data: string }
    | { type: 'tool_use'; id: string; name: string; input?: unknown };
}

interface AnthropicContentBlockDelta extends AnthropicEventBase {
  type: 'content_block_delta';
  index: number;
  delta:
    | { type: 'text_delta'; text: string }
    | { type: 'thinking_delta'; thinking: string }
    | { type: 'signature_delta'; signature: string }
    | { type: 'input_json_delta'; partial_json: string };
}

interface AnthropicContentBlockStop extends AnthropicEventBase {
  type: 'content_block_stop';
  index: number;
}

interface AnthropicMessageDelta extends AnthropicEventBase {
  type: 'message_delta';
  delta: { stop_reason?: string | null };
  usage?: {
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

interface AnthropicMessageStart extends AnthropicEventBase {
  type: 'message_start';
  message: {
    id?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
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
  surface?: 'anthropic' | 'vertex';
}

export class AnthropicProvider implements ProviderStrategy {
  readonly api = PROVIDER_API;
  private readonly defaultBaseUrl: string;
  private readonly defaultApiKey: string | undefined;
  private readonly anthropicVersion: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly surface: 'anthropic' | 'vertex';

  constructor(options: AnthropicProviderOptions = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.defaultApiKey = options.apiKey;
    this.anthropicVersion = options.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION;
    this.defaultHeaders = { ...(options.headers ?? {}) };
    this.surface = options.surface ?? 'anthropic';
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
        throw new ProviderHttpError(PROVIDER_API, 401, 'missing apiKey for Anthropic provider');
      }

      const body = applyRequestPlanBody(this.buildRequestBody(model, context, options), options.requestPlan);
      if (this.surface === 'vertex') {
        delete body.model;
        body.anthropic_version = 'vertex-2023-10-16';
      }
      const url = buildAnthropicMessagesUrl(baseUrl, model.id, this.surface);
      const plannedHeaders = mergeAnthropicRequestHeaders(
        this.defaultHeaders,
        requestPlanHeaders(options.requestPlan),
      );

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.surface === 'vertex'
            ? { Authorization: `Bearer ${apiKey}` }
            : { 'x-api-key': apiKey, 'anthropic-version': this.anthropicVersion }),
          ...plannedHeaders,
        },
        body: JSON.stringify(body),
        signal: composed.signal,
      });

      recordQuotaFromResponse(options.requestPlan, response);
      await ensureOk(response, PROVIDER_API);

      let responseId: string | undefined;
      const thinkingArtifactsByIndex = new Map<number, ProviderContinuationArtifact | undefined>();
      const blockRefs = new Map<number, ProviderOutputRef>();
      const blockKinds = new Map<number, 'text' | 'thinking' | 'tool_call'>();
      const refFor = (index: number): ProviderOutputRef => blockRefs.get(index) ?? createProviderOutputRef({
        protocol: PROVIDER_API, responseId, providerBlockKey: `content:${index}`, sourceIndex: index, contentIndex: index,
      });
      const thinkingKind = resolveAnthropicThinkingKind(options.reasoningVisibility);
      const thinkingVisibility = resolveAnthropicThinkingVisibility(options.reasoningVisibility);
      const thinkingSource = reasoningProjectionSource(options.requestPlan, 'raw');
      const redactedThinkingSource = reasoningProjectionSource(options.requestPlan, 'opaque');
      let stopReason: string | null = null;
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens: number | undefined;
      let cacheWriteTokens: number | undefined;
      let sawOutput = false;

      for await (const data of parseSSE(response, composed.signal, { providerApi: PROVIDER_API, ...options })) {
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
            responseId = evt.message.id?.trim() || responseId;
            inputTokens = evt.message.usage?.input_tokens ?? inputTokens;
            outputTokens = evt.message.usage?.output_tokens ?? outputTokens;
            if (typeof evt.message.usage?.cache_read_input_tokens === 'number') {
              cacheReadTokens = evt.message.usage.cache_read_input_tokens;
            }
            if (typeof evt.message.usage?.cache_creation_input_tokens === 'number') {
              cacheWriteTokens = evt.message.usage.cache_creation_input_tokens;
            }
            builder.setUsage({
              // Anthropic 的 input_tokens 不含 prompt cache 命中/写入部分；
              // agent-runtime Usage.inputTokens 归一为完整 prompt 占用（与 OpenAI prompt_tokens 口径一致）。
              inputTokens: inputTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0),
              outputTokens,
              ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
              ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
            });
            break;
          }
          case 'content_block_start': {
            const evt = event as AnthropicContentBlockStart;
            const block = evt.content_block;
            const blockRef = createProviderOutputRef({ protocol: PROVIDER_API, responseId, providerBlockKey: `content:${evt.index}`, sourceIndex: evt.index, contentIndex: evt.index });
            blockRefs.set(evt.index, blockRef);
            if (block.type === 'text') {
              builder.startText(blockRef);
              blockKinds.set(evt.index, 'text');
              if (block.text) {
                sawOutput = true;
                builder.appendText(blockRef, block.text);
              }
            } else if (block.type === 'thinking') {
              const artifact = createAnthropicThinkingArtifact(options.requestPlan, block.signature);
              thinkingArtifactsByIndex.set(evt.index, artifact);
              builder.startThinking(blockRef, {
                kind: thinkingKind,
                source: thinkingSource,
                visibility: thinkingVisibility,
                continuation: artifact,
              });
              blockKinds.set(evt.index, 'thinking');
              if (block.thinking) {
                sawOutput = true;
                builder.appendThinking(blockRef, block.thinking, {
                  kind: thinkingKind,
                  source: thinkingSource,
                  visibility: thinkingVisibility,
                  continuation: artifact,
                });
              }
            } else if (block.type === 'redacted_thinking') {
              const artifact = createAnthropicRedactedArtifact(options.requestPlan, block.data);
              thinkingArtifactsByIndex.set(evt.index, artifact);
              sawOutput = true;
              builder.startThinking(blockRef, {
                kind: 'opaque',
                source: redactedThinkingSource,
                visibility: 'hidden',
                continuation: artifact,
              });
              blockKinds.set(evt.index, 'thinking');
            } else if (block.type === 'tool_use') {
              sawOutput = true;
              builder.startToolCall(blockRef, block.id, block.name);
              blockKinds.set(evt.index, 'tool_call');
              if (block.input && typeof block.input === 'object' && Object.keys(block.input as Record<string, unknown>).length > 0) {
                builder.appendToolCallArgs(blockRef, JSON.stringify(block.input));
              }
            }
            break;
          }
          case 'content_block_delta': {
            const evt = event as AnthropicContentBlockDelta;
            if (evt.delta.type === 'text_delta') {
              sawOutput = true;
              builder.appendText(refFor(evt.index), evt.delta.text);
            } else if (evt.delta.type === 'thinking_delta') {
              sawOutput = true;
              builder.appendThinking(refFor(evt.index), evt.delta.thinking, {
                kind: thinkingKind,
                source: thinkingSource,
                visibility: thinkingVisibility,
                continuation: thinkingArtifactsByIndex.get(evt.index) ?? createAnthropicThinkingArtifact(options.requestPlan),
              });
            } else if (evt.delta.type === 'signature_delta') {
              const artifact = mergeAnthropicSignature(
                options.requestPlan,
                thinkingArtifactsByIndex.get(evt.index) ?? createAnthropicThinkingArtifact(options.requestPlan),
                evt.delta.signature,
              );
              thinkingArtifactsByIndex.set(evt.index, artifact);
              builder.updateThinking(refFor(evt.index), {
                kind: thinkingKind,
                source: thinkingSource,
                visibility: thinkingVisibility,
                continuation: artifact,
              });
            } else if (evt.delta.type === 'input_json_delta') {
              sawOutput = true;
              builder.appendToolCallArgs(refFor(evt.index), evt.delta.partial_json);
            }
            break;
          }
          case 'content_block_stop': {
            const evt = event as AnthropicContentBlockStop;
            const ref = refFor(evt.index);
            const kind = blockKinds.get(evt.index);
            if (kind === 'text') builder.endText(ref);
            else if (kind === 'thinking') builder.endThinking(ref);
            else if (kind === 'tool_call') builder.endToolCall(ref);
            else builder.endText(ref);
            break;
          }
          case 'message_delta': {
            const evt = event as AnthropicMessageDelta;
            if (evt.delta.stop_reason) stopReason = evt.delta.stop_reason;
            if (typeof evt.usage?.output_tokens === 'number') {
              outputTokens = evt.usage.output_tokens;
            }
            if (typeof evt.usage?.cache_read_input_tokens === 'number') {
              cacheReadTokens = evt.usage.cache_read_input_tokens;
            }
            if (typeof evt.usage?.cache_creation_input_tokens === 'number') {
              cacheWriteTokens = evt.usage.cache_creation_input_tokens;
            }
            if (evt.usage) {
              builder.setUsage({
                inputTokens: inputTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0),
                outputTokens,
                ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
                ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
              });
            }
            break;
          }
          case 'message_stop':
            break;
          case 'error': {
            const evt = event as AnthropicErrorEvent;
            throw new Error(`anthropic ${evt.error.type}: ${evt.error.message}`);
          }
          default:
            break;
        }
      }

      if (!sawOutput) {
        throw new ProviderHttpError(PROVIDER_API, 502, 'Provider stream ended without assistant output or structured tool call.');
      }
      builder.done(mapStopReason(stopReason));
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
    const { system, messages } = toAnthropicMessages(
      context,
      options.requestPlan,
      options.promptCache,
      this.surface,
    );
    const body: Record<string, unknown> = {
      model: model.id,
      messages,
      stream: true,
      max_tokens: options.maxTokens ?? model.maxTokens ?? 4096,
    };
    if (system) body.system = system;
    if (this.surface === 'anthropic'
      && options.promptCache?.enabled
      && options.promptCache.breakpointCarrier === 'anthropic-cache-control'
      && (
        options.promptCache.breakpoint === 'automatic'
        || options.promptCache.breakpoint === 'automatic-and-explicit'
      )) {
      body.cache_control = anthropicCacheControl(options.promptCache.ttl);
    }
    if (typeof options.temperature === 'number') body.temperature = options.temperature;
    if (typeof options.topP === 'number') body.top_p = options.topP;
    applyReasoningToAnthropicLikeBody(body, options.reasoning, options.reasoningVisibility);
    if (context.tools && context.tools.length > 0) {
      body.tools = context.tools.map(toAnthropicTool);
    }
    return body;
  }
}

export function buildAnthropicMessagesUrl(
  baseUrl: string,
  modelId: string,
  surface: 'anthropic' | 'vertex' = 'anthropic',
): string {
  const trimmed = baseUrl.replace(/\/+$/u, '');
  return surface === 'vertex'
    ? `${trimmed}/models/${encodeURIComponent(modelId)}:streamRawPredict`
    : trimmed.endsWith('/messages') ? trimmed : `${trimmed}/messages`;
}

function resolveAnthropicThinkingKind(reasoningVisibility?: ReasoningVisibility): ThinkingArtifactKind {
  if (reasoningVisibility === 'unknown-events') return 'unknown';
  return reasoningVisibility === 'summary-events' ? 'summary' : 'raw';
}

function resolveAnthropicThinkingVisibility(reasoningVisibility?: ReasoningVisibility): ThinkingArtifactVisibility {
  return reasoningVisibility === 'summary-events' ? 'summary' : 'raw-collapsed';
}

interface AnthropicSystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral'; ttl: '5m' | '1h' };
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string }
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

function toAnthropicMessages(
  context: Context,
  requestPlan: RequestPlan,
  promptCache?: StreamOptions['promptCache'],
  surface: 'anthropic' | 'vertex' = 'anthropic',
): {
  system?: string | AnthropicSystemBlock[];
  messages: AnthropicMessage[];
} {
  const messages: AnthropicMessage[] = [];
  for (let index = 0; index < context.messages.length; index += 1) {
    const message = context.messages[index];
    if (message.role === 'toolResult') {
      const toolResultBlocks: AnthropicContentBlock[] = [];
      while (index < context.messages.length && context.messages[index].role === 'toolResult') {
        const toolResultMessage = context.messages[index];
        if (toolResultMessage.role !== 'toolResult') break;
        toolResultBlocks.push(toAnthropicToolResultBlock(toolResultMessage));
        index += 1;
      }
      index -= 1;
      messages.push({ role: 'user', content: toolResultBlocks });
      continue;
    }
    messages.push(...convertMessage(message, requestPlan).filter((converted) => converted.content.length > 0));
  }

  const prompt = partitionSystemPrompt(context);
  const explicitBreakpoint = promptCache?.enabled === true
    && promptCache.breakpointCarrier === 'anthropic-cache-control'
    && (
      promptCache.breakpoint === 'explicit'
      || promptCache.breakpoint === 'automatic-and-explicit'
    );
  if (explicitBreakpoint && surface !== 'anthropic') {
    throw new Error(
      'PROMPT_CACHE_SURFACE_UNSUPPORTED: explicit Anthropic cache blocks are not enabled for this surface manifest.',
    );
  }
  if (explicitBreakpoint) {
    if (!prompt.stableText) {
      throw new Error(
        'PROMPT_CACHE_STABLE_PREFIX_UNAVAILABLE: explicit Anthropic cache mode requires PromptPlan-owned stable segments.',
      );
    }
    const system: AnthropicSystemBlock[] = [{
      type: 'text',
      text: prompt.stableText,
      cache_control: anthropicCacheControl(promptCache.ttl),
    }];
    if (prompt.volatileText) system.push({ type: 'text', text: prompt.volatileText });
    return { system, messages };
  }
  return {
    system: prompt.combinedText,
    messages,
  };
}

function convertMessage(message: Message, requestPlan: RequestPlan): AnthropicMessage[] {
  if (message.role === 'user') {
    if (typeof message.content === 'string') {
      const text = message.content.trim();
      return text ? [{ role: 'user', content: [{ type: 'text', text }] }] : [];
    }
    const blocks: AnthropicContentBlock[] = [];
    for (const block of message.content) {
      if (block.type === 'text' && block.text.trim()) {
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
      if (block.type === 'text' && block.text.trim()) {
        blocks.push({ type: 'text', text: block.text });
      } else if (block.type === 'thinking') {
        const replayBlock = toAnthropicThinkingReplayBlock(
          block.text,
          block.continuation,
          requestPlan,
          message.content.some((candidate) => candidate.type === 'toolCall'),
        );
        if (replayBlock) blocks.push(replayBlock);
      } else if (block.type === 'toolCall') {
        blocks.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.arguments ?? {},
        });
      }
    }
    return [{ role: 'assistant', content: blocks }];
  }

  return [
    {
      role: 'user',
      content: [toAnthropicToolResultBlock(message)],
    },
  ];
}

function toAnthropicToolResultBlock(message: Extract<Message, { role: 'toolResult' }>): AnthropicContentBlock {
  const textBlocks: Array<{ type: 'text'; text: string }> = [];
  for (const block of message.content) {
    if (block.type === 'text' && block.text.trim()) textBlocks.push({ type: 'text', text: block.text });
  }
  return {
    type: 'tool_result',
    tool_use_id: message.toolCallId,
    content: textBlocks.length > 0 ? textBlocks : [{ type: 'text', text: 'Tool returned no text.' }],
    is_error: message.isError || undefined,
  };
}

function createAnthropicThinkingArtifact(
  requestPlan: RequestPlan,
  signature?: string,
): ProviderContinuationArtifact | undefined {
  return createContinuationArtifact(requestPlan, {
    type: 'thinking',
    signature: signature || undefined,
  });
}

function createAnthropicRedactedArtifact(
  requestPlan: RequestPlan,
  data: string,
): ProviderContinuationArtifact | undefined {
  return createContinuationArtifact(requestPlan, {
    type: 'redacted_thinking',
    redactedContent: data,
  });
}

function mergeAnthropicSignature(
  requestPlan: RequestPlan,
  artifact: ProviderContinuationArtifact | undefined,
  signatureDelta: string,
): ProviderContinuationArtifact | undefined {
  return createContinuationArtifact(requestPlan, {
    type: 'thinking',
    signature: (artifact?.signature ?? '') + signatureDelta,
  });
}

function toAnthropicThinkingReplayBlock(
  text: string | undefined,
  artifact: ProviderContinuationArtifact | undefined,
  requestPlan: RequestPlan,
  sameToolLoop: boolean,
): Extract<AnthropicContentBlock, { type: 'thinking' | 'redacted_thinking' }> | null {
  const decision = decideContinuationReplay(artifact, requestPlan, { sameToolLoop });
  if (decision.action !== 'replay' || !artifact || artifact.carrier !== 'signed-content-block') return null;
  if (artifact.type === 'redacted_thinking') {
    return artifact.redactedContent ? { type: 'redacted_thinking', data: artifact.redactedContent } : null;
  }
  if (artifact.type !== 'thinking' || !text || !artifact.signature) return null;
  return { type: 'thinking', thinking: text, signature: artifact.signature };
}

function anthropicCacheControl(
  ttl: NonNullable<StreamOptions['promptCache']>['ttl'],
): { type: 'ephemeral'; ttl: '5m' | '1h' } {
  return { type: 'ephemeral', ttl: ttl === 'one-hour' ? '1h' : '5m' };
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
    case 'refusal':
      return 'refusal';
    case 'stop_sequence':
      return 'stop';
    default:
      return 'stop';
  }
}

function mergeAnthropicRequestHeaders(
  defaultHeaders: Readonly<Record<string, string>>,
  planHeaders: Readonly<Record<string, string>>,
): Record<string, string> {
  const merged = { ...defaultHeaders, ...planHeaders };
  const betaValues: string[] = [];
  for (const headers of [defaultHeaders, planHeaders]) {
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() !== 'anthropic-beta') continue;
      for (const beta of value.split(',').map((entry) => entry.trim()).filter(Boolean)) {
        if (!betaValues.includes(beta)) betaValues.push(beta);
      }
    }
  }
  for (const name of Object.keys(merged)) {
    if (name.toLowerCase() === 'anthropic-beta') delete merged[name];
  }
  if (betaValues.length > 0) merged['anthropic-beta'] = betaValues.join(',');
  return merged;
}

export const __testing = { mapStopReason, mergeAnthropicRequestHeaders, toAnthropicMessages };
