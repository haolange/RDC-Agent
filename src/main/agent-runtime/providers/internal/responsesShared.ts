import type {
  Context,
  Message,
  Model,
  ProviderContinuationArtifact,
  StopReason,
  StreamOptions,
  ToolDefinition,
} from '../../core/types';
import type { RequestPlan } from '@shared/types/providerCapability';
import { createContinuationArtifact } from '../../reasoning/ContinuationArtifacts';
import { decideContinuationReplay } from '../../reasoning/ContinuationReplayPolicy';
import { createProviderStateRef, findLatestProviderState } from '../../reasoning/ProviderStateRefs';
import { partitionSystemPrompt } from '../promptCacheWire';
import { buildOpenAiResponsesReasoning } from '../reasoningWire';
import { reasoningProjectionSource } from '../reasoningProjection';
import { AssistantStreamBuilder, createProviderOutputRef, ProviderStreamProtocolError } from './AssistantStreamBuilder';
import { ResponsesItemChannels } from './responsesItemChannels';
import {
  createResponsesStreamFailure,
  parseSSE,
  ProviderEmptyStreamError,
} from './http';
import { finalizeProviderUsage } from './normalizeCacheUsage';

export const RESPONSES_REASONING_INCLUDE = 'reasoning.encrypted_content';

interface ResponsesCompletedPayload {
  service_tier?: string;
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

export async function consumeResponsesEventStream(input: {
  protocol: string;
  response: Response;
  signal: AbortSignal;
  options: StreamOptions;
  builder: AssistantStreamBuilder;
  failureMessages: { failed: string; error: string };
}): Promise<void> {
  const { protocol, response, signal, options, builder } = input;
  const toolArgBuffers = new Map<string, string>();
  const summarySource = reasoningProjectionSource(options.requestPlan, 'summary');
  const rawSource = reasoningProjectionSource(options.requestPlan, 'raw');
  const opaqueSource = reasoningProjectionSource(options.requestPlan, 'opaque');
  const deepSeekResponses = isDeepSeekResponsesPlan(options.requestPlan);
  const items = new ResponsesItemChannels({
    protocol,
    builder,
    sources: { summary: summarySource, raw: rawSource, opaque: opaqueSource },
    deepSeekResponses,
  });
  const toolStarted = new Set<string>();
  let rawReasoningText = '';
  let sawToolCall = false;
  let sawOutput = false;
  let finishReason: StopReason = 'stop';
  let providerTerminalSeen = false;
  const terminalRef = createProviderOutputRef({
    protocol,
    providerBlockKey: 'response:terminal',
    contentIndex: 1_000_000,
  });
  const toolKey = (outputIndex: number, itemId?: string) => itemId || `index:${outputIndex}`;

  for await (const data of parseSSE(response, signal, { providerApi: protocol, ...options })) {
    if (signal.aborted) break;
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
      case 'response.reasoning_text.delta': {
        const delta = readString(event.delta) || readString(event.text);
        if (delta) {
          sawOutput = true;
          rawReasoningText += delta;
          items.appendReasoning(items.identityFromEvent(event), delta, 'raw');
        }
        break;
      }
      case 'response.reasoning_text.done': {
        const identity = items.identityFromEvent(event);
        const fullText = readString(event.text) || readString(event.reasoning_text);
        if (fullText && !rawReasoningText) {
          sawOutput = true;
          rawReasoningText = fullText;
          items.appendReasoning(identity, fullText, 'raw');
        } else {
          items.startReasoning(identity, 'raw');
        }
        break;
      }
      case 'response.output_item.added': {
        const item = readRecord(event.item);
        const identity = items.identityFromEvent(event, item);
        if (readString(item?.type) === 'message') items.setTextPhase(identity, readOutputPhase(item?.phase));
        const reasoningArtifact = createResponsesReasoningArtifact(options.requestPlan, item);
        if (reasoningArtifact) {
          if (!deepSeekResponses) {
            sawOutput = true;
            items.startReasoning(identity, 'opaque', reasoningArtifact);
          } else {
            items.startReasoning(identity, 'raw', reasoningArtifact);
          }
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
          if (deepSeekResponses) {
            const itemReasoningText = readDeepSeekReasoningText(item);
            if (itemReasoningText && !rawReasoningText) {
              sawOutput = true;
              rawReasoningText = itemReasoningText;
              items.appendReasoning(identity, itemReasoningText, 'raw', reasoningArtifact);
            }
            items.closeReasoning(identity, reasoningArtifact);
          } else {
            sawOutput = true;
            items.startReasoning(identity, 'opaque', reasoningArtifact);
            items.closeReasoning(identity, reasoningArtifact);
          }
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
          items.setTextPhase(identity, readOutputPhase(item?.phase));
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
          throw new ProviderEmptyStreamError(protocol);
        }
        providerTerminalSeen = true;
        break;
      }
      case 'response.incomplete': {
        const incomplete = readRecord(event.response) as ResponsesCompletedPayload | null;
        if (incomplete) {
          applyCompletedUsage(builder, incomplete);
          items.applyCompletedReasoning(incomplete.output, (item) => (
            createResponsesReasoningArtifact(options.requestPlan, item)
          ));
        }
        items.closeRemaining();
        finishReason = 'length';
        if (!sawOutput) {
          throw new ProviderEmptyStreamError(protocol);
        }
        providerTerminalSeen = true;
        break;
      }
      case 'response.failed': {
        const failed = readRecord(event.response);
        const error = readRecord(failed?.error) ?? readRecord(event.error);
        throw createResponsesStreamFailure(protocol, {
          error,
          event,
          fallbackMessage: input.failureMessages.failed,
        });
      }
      case 'error': {
        throw createResponsesStreamFailure(protocol, {
          error: readRecord(event.error) ?? event,
          event,
          fallbackMessage: input.failureMessages.error,
        });
      }
      default:
        break;
    }
  }

  if (!sawOutput) {
    throw new ProviderEmptyStreamError(protocol);
  }
  items.closeRemaining();
  builder.done(finishReason);
}

export function buildResponsesRequestBody(
  model: Model,
  context: Context,
  options: StreamOptions,
): Record<string, unknown> {
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

export function toResponsesInput(context: Context, requestPlan: RequestPlan): unknown[] {
  const items: unknown[] = [];
  for (const message of context.messages) {
    items.push(...convertMessage(message, requestPlan));
  }
  return items;
}

export function isDeepSeekResponsesPlan(requestPlan: RequestPlan): boolean {
  return requestPlan.executionIdentity.protocolDialect === 'DeepSeekResponses';
}

export function readDeepSeekReasoningText(item: Record<string, unknown> | null | undefined): string {
  if (!item) return '';
  if (typeof item.content === 'string') return item.content;
  if (!Array.isArray(item.content)) return '';
  return item.content.flatMap((part): string[] => {
    const value = readRecord(part);
    const text = readString(value?.text) || readString(value?.content);
    return text ? [text] : [];
  }).join('');
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
      } else if (block.type === 'text' && block.text) {
        items.push({ role: 'assistant', content: block.text, type: 'message', ...(block.phase ? { phase: block.phase } : {}) });
      } else if (block.type === 'toolCall') {
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

function readOutputPhase(value: unknown): 'commentary' | 'final_answer' | undefined {
  return value === 'commentary' || value === 'final_answer' ? value : undefined;
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
    strict: false,
  };
}

function applyCompletedUsage(builder: AssistantStreamBuilder, payload: ResponsesCompletedPayload): void {
  builder.setExecution({
    ...(typeof payload.model === 'string' ? { modelId: payload.model } : {}),
    ...(typeof payload.service_tier === 'string' ? { serviceTier: payload.service_tier } : {}),
  });
  if (!payload.usage) return;
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
