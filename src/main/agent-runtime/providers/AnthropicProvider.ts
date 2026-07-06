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
  ThinkingArtifactKind,
  ThinkingArtifactVisibility,
  ToolDefinition,
} from '../core/types';
import type { ReasoningVisibility } from '@shared/types/agentRuntime';
import { AssistantStreamBuilder } from './internal/AssistantStreamBuilder';
import {
  composeAbortSignals,
  ensureOk,
  normalizeError,
  parseSSE,
  ProviderHttpError,
} from './internal/http';
import { applyReasoningToAnthropicLikeBody } from './reasoningWire';

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
  usage?: { output_tokens?: number };
}

interface AnthropicMessageStart extends AnthropicEventBase {
  type: 'message_start';
  message: {
    usage?: { input_tokens?: number; output_tokens?: number };
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
  capabilities?: Partial<ProviderCapabilities>;
}

export class AnthropicProvider implements ProviderStrategy {
  readonly api = PROVIDER_API;
  private readonly defaultBaseUrl: string;
  private readonly defaultApiKey: string | undefined;
  private readonly anthropicVersion: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly capabilities: ProviderCapabilities;

  constructor(options: AnthropicProviderOptions = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.defaultApiKey = options.apiKey;
    this.anthropicVersion = options.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION;
    this.defaultHeaders = { ...(options.headers ?? {}) };
    this.capabilities = {
      streaming: true,
      nativeToolCalling: true,
      structuredOutput: false,
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
        throw new ProviderHttpError(PROVIDER_API, 401, 'missing apiKey for Anthropic provider');
      }

      const body = this.buildRequestBody(model, context, options);
      const url = `${baseUrl}/messages`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': this.anthropicVersion,
          ...this.defaultHeaders,
        },
        body: JSON.stringify(body),
        signal: composed.signal,
      });

      await ensureOk(response, PROVIDER_API);

      const thinkingArtifactsByIndex = new Map<number, ProviderReasoningArtifact>();
      const thinkingKind = resolveAnthropicThinkingKind(options.reasoningVisibility);
      const thinkingVisibility = resolveAnthropicThinkingVisibility(options.reasoningVisibility);
      let stopReason: string | null = null;
      let inputTokens = 0;
      let outputTokens = 0;
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
            inputTokens = evt.message.usage?.input_tokens ?? inputTokens;
            outputTokens = evt.message.usage?.output_tokens ?? outputTokens;
            builder.setUsage({ inputTokens, outputTokens });
            break;
          }
          case 'content_block_start': {
            const evt = event as AnthropicContentBlockStart;
            const block = evt.content_block;
            if (block.type === 'text') {
              if (block.text) {
                sawOutput = true;
                builder.appendText(evt.index, block.text);
              }
            } else if (block.type === 'thinking') {
              const artifact = createAnthropicThinkingArtifact(model, block.signature);
              thinkingArtifactsByIndex.set(evt.index, artifact);
              builder.updateThinking(evt.index, {
                kind: thinkingKind,
                source: 'anthropic-thinking',
                visibility: thinkingVisibility,
                replayPolicy: 'provider-artifact',
                artifact,
              });
              if (block.thinking) {
                sawOutput = true;
                builder.appendThinking(evt.index, block.thinking, {
                  kind: thinkingKind,
                  source: 'anthropic-thinking',
                  visibility: thinkingVisibility,
                  replayPolicy: 'provider-artifact',
                  artifact,
                });
              }
            } else if (block.type === 'redacted_thinking') {
              const artifact = createAnthropicRedactedArtifact(model, block.data);
              thinkingArtifactsByIndex.set(evt.index, artifact);
              sawOutput = true;
              builder.updateThinking(evt.index, {
                kind: 'opaque',
                source: 'anthropic-redacted-thinking',
                visibility: 'hidden',
                replayPolicy: 'provider-artifact',
                artifact,
              });
            } else if (block.type === 'tool_use') {
              sawOutput = true;
              builder.ensureToolCall(evt.index, block.id, block.name);
              if (block.input && typeof block.input === 'object' && Object.keys(block.input as Record<string, unknown>).length > 0) {
                builder.appendToolCallArgs(evt.index, JSON.stringify(block.input));
              }
            }
            break;
          }
          case 'content_block_delta': {
            const evt = event as AnthropicContentBlockDelta;
            if (evt.delta.type === 'text_delta') {
              sawOutput = true;
              builder.appendText(evt.index, evt.delta.text);
            } else if (evt.delta.type === 'thinking_delta') {
              sawOutput = true;
              builder.appendThinking(evt.index, evt.delta.thinking, {
                kind: thinkingKind,
                source: 'anthropic-thinking',
                visibility: thinkingVisibility,
                replayPolicy: 'provider-artifact',
                artifact: thinkingArtifactsByIndex.get(evt.index) ?? createAnthropicThinkingArtifact(model),
              });
            } else if (evt.delta.type === 'signature_delta') {
              const artifact = mergeAnthropicSignature(
                thinkingArtifactsByIndex.get(evt.index) ?? createAnthropicThinkingArtifact(model),
                evt.delta.signature,
              );
              thinkingArtifactsByIndex.set(evt.index, artifact);
              builder.updateThinking(evt.index, {
                kind: thinkingKind,
                source: 'anthropic-thinking',
                visibility: thinkingVisibility,
                replayPolicy: 'provider-artifact',
                artifact,
              });
            } else if (evt.delta.type === 'input_json_delta') {
              sawOutput = true;
              builder.appendToolCallArgs(evt.index, evt.delta.partial_json);
            }
            break;
          }
          case 'content_block_stop': {
            const evt = event as AnthropicContentBlockStop;
            builder.endText(evt.index);
            builder.endThinking(evt.index);
            builder.endToolCall(evt.index);
            break;
          }
          case 'message_delta': {
            const evt = event as AnthropicMessageDelta;
            if (evt.delta.stop_reason) stopReason = evt.delta.stop_reason;
            if (typeof evt.usage?.output_tokens === 'number') {
              outputTokens = evt.usage.output_tokens;
              builder.setUsage({ inputTokens, outputTokens });
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
    const { system, messages } = toAnthropicMessages(context);
    const body: Record<string, unknown> = {
      model: model.id,
      messages,
      stream: true,
      max_tokens: options.maxTokens ?? model.maxTokens ?? 4096,
    };
    if (system) body.system = system;
    if (typeof options.temperature === 'number') body.temperature = options.temperature;
    if (typeof options.topP === 'number') body.top_p = options.topP;
    applyReasoningToAnthropicLikeBody(body, options.reasoning, options.reasoningVisibility);
    if (context.tools && context.tools.length > 0) {
      body.tools = context.tools.map(toAnthropicTool);
    }
    return body;
  }
}

function resolveAnthropicThinkingKind(reasoningVisibility?: ReasoningVisibility): ThinkingArtifactKind {
  return reasoningVisibility === 'summary-events' ? 'summary' : 'raw';
}

function resolveAnthropicThinkingVisibility(reasoningVisibility?: ReasoningVisibility): ThinkingArtifactVisibility {
  return reasoningVisibility === 'summary-events' ? 'summary' : 'raw-collapsed';
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

function toAnthropicMessages(context: Context): {
  system?: string;
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
    messages.push(...convertMessage(message).filter((converted) => converted.content.length > 0));
  }
  return {
    system: context.systemPrompt && context.systemPrompt.trim() ? context.systemPrompt : undefined,
    messages,
  };
}

function convertMessage(message: Message): AnthropicMessage[] {
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
        const replayBlock = toAnthropicThinkingReplayBlock(block.text, block.artifact, block.replayPolicy);
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

function createAnthropicThinkingArtifact(model: Model, signature?: string): ProviderReasoningArtifact {
  return {
    providerId: model.provider,
    modelId: model.id,
    protocol: PROVIDER_API,
    type: 'thinking',
    signature: signature || undefined,
  };
}

function createAnthropicRedactedArtifact(model: Model, data: string): ProviderReasoningArtifact {
  return {
    providerId: model.provider,
    modelId: model.id,
    protocol: PROVIDER_API,
    type: 'redacted_thinking',
    data,
  };
}

function mergeAnthropicSignature(
  artifact: ProviderReasoningArtifact,
  signatureDelta: string,
): ProviderReasoningArtifact {
  return {
    ...artifact,
    type: 'thinking',
    signature: `${artifact.signature ?? ''}${signatureDelta}`,
  };
}

function toAnthropicThinkingReplayBlock(
  text: string | undefined,
  artifact: ProviderReasoningArtifact | undefined,
  replayPolicy: string,
): Extract<AnthropicContentBlock, { type: 'thinking' | 'redacted_thinking' }> | null {
  if (replayPolicy !== 'provider-artifact' || !artifact) return null;
  if (artifact.protocol !== PROVIDER_API && artifact.protocol !== 'AnthropicMessages') return null;
  if (artifact.type === 'redacted_thinking') {
    return artifact.data ? { type: 'redacted_thinking', data: artifact.data } : null;
  }
  if (artifact.type !== 'thinking' || !text || !artifact.signature) return null;
  return { type: 'thinking', thinking: text, signature: artifact.signature };
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

export const __testing = { mapStopReason, toAnthropicMessages };
