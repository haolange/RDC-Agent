/**
 * Ollama 本地 Provider —— 适配 `POST /api/chat` 端点。
 *
 * 协议要点：
 * - 默认 baseUrl：`http://localhost:11434`。
 * - 响应是 NDJSON（每行一个 JSON 对象），不是 SSE。
 * - 每个 chunk 形如：
 *   `{ model, message: { role: 'assistant', content, tool_calls? }, done, done_reason?, eval_count?, ... }`
 * - 工具调用支持依赖 Ollama 较新版本（>=0.3.x）；不支持时不会出现 `tool_calls`。
 * - 不需要 API key，但允许通过自定义 baseUrl 指向远端实例。
 */

import { z } from 'zod';
import { createContinuationArtifact } from '../reasoning/ContinuationArtifacts';
import { decideContinuationReplay } from '../reasoning/ContinuationReplayPolicy';
import { applyRequestPlanBody, requestPlanHeaders } from './requestPlanWire';
import { AlternatingTextThinkingChannels, StreamChannelRefs } from './internal/streamChannelRefs';
import { toChatCompletionsTool } from './internal/chatCompletionsWire';
import {
  readProviderFrames,
  sendProviderRequest,
  startProviderStream,
  type ProviderFrameStream,
  type ProviderStreamRun,
} from './internal/providerStreamDriver';
import { ToolCallAccumulator } from './internal/toolCallAccumulator';
import { normalizeUsage, type UsageFieldMap } from './internal/usageNormalizer';
import { reasoningProjectionSource } from './reasoningProjection';
import { applyOllamaThink } from './reasoningWire';
import type { EventStream } from '../core/EventStream';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Message,
  Model,
  StopReason,
  StreamOptions,
} from '../core/types';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import type { RequestPlan } from '@shared/types/providerCapability';

const DEFAULT_BASE_URL = 'http://localhost:11434';
const PROVIDER_API = 'ollama';

/** One Ollama /api/chat stream line; fields this adapter does not read pass through. */
const OllamaChunkSchema = z.object({
  model: z.string().nullish(),
  message: z.object({
    role: z.string().nullish(),
    content: z.string().nullish(),
    thinking: z.string().nullish(),
    tool_calls: z.array(z.object({
      function: z.object({
        name: z.string().nullish(),
        arguments: z.union([z.record(z.string(), z.unknown()), z.string()]).nullish(),
      }).passthrough().nullish(),
    }).passthrough()).nullish(),
  }).passthrough().nullish(),
  done: z.boolean().nullish(),
  done_reason: z.string().nullish(),
  prompt_eval_count: z.number().nullish(),
  eval_count: z.number().nullish(),
  total_duration: z.number().nullish(),
}).passthrough();
type OllamaChunk = z.infer<typeof OllamaChunkSchema>;

const OLLAMA_FRAMES: ProviderFrameStream<OllamaChunk> = {
  providerApi: PROVIDER_API,
  framing: 'json-lines',
  frameSchema: OllamaChunkSchema,
};

/** The final line reports prompt and generated token counts; Ollama reports no total and no cache figures. */
const OLLAMA_USAGE_FIELDS: UsageFieldMap<OllamaChunk> = {
  inputTokens: (chunk) => chunk.prompt_eval_count,
  outputTokens: (chunk) => chunk.eval_count,
};

export interface OllamaProviderOptions {
  baseUrl?: string;
  /** Ollama 默认无需 apiKey，但允许在反代场景下注入 Bearer。 */
  apiKey?: string;
  headers?: Record<string, string>;
}

export class OllamaProvider implements ProviderStrategy {
  readonly api = PROVIDER_API;
  private readonly defaultBaseUrl: string;
  private readonly defaultApiKey: string | undefined;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: OllamaProviderOptions = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.defaultApiKey = options.apiKey;
    this.defaultHeaders = { ...(options.headers ?? {}) };
  }

  stream(
    model: Model,
    context: Context,
    options: StreamOptions,
  ): EventStream<AssistantMessageEvent, AssistantMessage> {
    return startProviderStream({ providerApi: PROVIDER_API, model, options }, async (run) => {
      const response = await this.send(model, context, options, run.signal);
      return consumeOllamaStream(response, run, options);
    });
  }

  private async send(model: Model, context: Context, options: StreamOptions, signal: AbortSignal): Promise<Response> {
    const baseUrl = (options.baseUrl ?? this.defaultBaseUrl).replace(/\/+$/, '');
    const apiKey = options.apiKey ?? this.defaultApiKey;
    const body = applyRequestPlanBody(this.buildRequestBody(model, context, options), options.requestPlan);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.defaultHeaders,
      ...requestPlanHeaders(options.requestPlan),
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return sendProviderRequest(PROVIDER_API, options.requestPlan, signal, { url: `${baseUrl}/api/chat`, headers, body });
  }

  private buildRequestBody(
    model: Model,
    context: Context,
    options: StreamOptions,
  ): Record<string, unknown> {
    const messages = toOllamaMessages(context, options.requestPlan);
    const body: Record<string, unknown> = {
      model: model.id,
      messages,
      stream: true,
    };

    const optionsBlock: Record<string, unknown> = {};
    if (typeof options.temperature === 'number') optionsBlock.temperature = options.temperature;
    if (typeof options.topP === 'number') optionsBlock.top_p = options.topP;
    if (typeof options.maxTokens === 'number') optionsBlock.num_predict = options.maxTokens;
    applyOllamaThink(body, options.reasoning, options.requestPlan);
    if (Object.keys(optionsBlock).length > 0) body.options = optionsBlock;

    if (context.tools && context.tools.length > 0) {
      body.tools = context.tools.map(toChatCompletionsTool);
    }
    return body;
  }
}

/**
 * Reads Ollama's JSON lines. Lines carry no block ids, so thinking and text alternate as segments; each tool call
 * arrives whole. The `done` line is the terminal signal and the last line read.
 */
async function consumeOllamaStream(
  response: Response,
  { builder, signal }: ProviderStreamRun,
  options: StreamOptions,
): Promise<{ sawOutput: boolean }> {
  const channels = new StreamChannelRefs(PROVIDER_API);
  const alternating = new AlternatingTextThinkingChannels(channels);
  const toolCalls = new ToolCallAccumulator<number>(builder);
  const thinkingSource = reasoningProjectionSource(options.requestPlan, 'raw');
  let thinkingBuffer = '';
  let sawOutput = false;

  for await (const chunk of readProviderFrames(response, signal, options, OLLAMA_FRAMES)) {
    const message = chunk.message;
    if (message) {
      if (typeof message.thinking === 'string' && message.thinking.length > 0) {
        sawOutput = true;
        thinkingBuffer += message.thinking;
        const continuation = createContinuationArtifact(options.requestPlan, {
          type: 'thinking',
          reasoningContent: thinkingBuffer,
        });
        alternating.appendThinking(builder, message.thinking, {
          kind: 'raw',
          source: thinkingSource,
          visibility: 'raw-collapsed',
          continuation,
        });
      }
      if (typeof message.content === 'string' && message.content.length > 0) {
        sawOutput = true;
        alternating.appendText(builder, message.content);
      }
      for (const toolCall of message.tool_calls ?? []) {
        const fn = toolCall.function;
        if (!fn || !fn.name) continue;
        const callIndex = toolCalls.count;
        sawOutput = true;
        const toolRef = channels.ref({ providerBlockKey: `function:${callIndex}`, sourceIndex: callIndex });
        const argumentsText = typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {});
        toolCalls.addComplete(callIndex, toolRef, `ollama-call-${Date.now()}-${callIndex + 1}`, fn.name, argumentsText);
      }
    }

    if (chunk.done) {
      builder.markTerminal(mapDoneReason(chunk.done_reason ?? 'stop', toolCalls.count > 0));
      if (typeof chunk.prompt_eval_count === 'number' || typeof chunk.eval_count === 'number') {
        builder.setUsage(normalizeUsage(chunk, OLLAMA_USAGE_FIELDS));
      }
      break;
    }
  }
  return { sawOutput };
}

// =====================================================================
// 转换辅助
// =====================================================================

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  thinking?: string;
  images?: string[];
  tool_calls?: Array<{
    function: { name: string; arguments: Record<string, unknown> };
  }>;
  tool_name?: string;
}

function toOllamaMessages(context: Context, requestPlan?: RequestPlan): OllamaMessage[] {
  const out: OllamaMessage[] = [];
  if (context.systemPrompt && context.systemPrompt.trim()) {
    out.push({ role: 'system', content: context.systemPrompt });
  }
  for (const message of context.messages) {
    out.push(...convertMessage(message, requestPlan));
  }
  return out;
}

function convertMessage(message: Message, requestPlan?: RequestPlan): OllamaMessage[] {
  if (message.role === 'user') {
    if (typeof message.content === 'string') {
      return [{ role: 'user', content: message.content }];
    }
    const texts: string[] = [];
    const images: string[] = [];
    for (const block of message.content) {
      if (block.type === 'text') texts.push(block.text);
      else if (block.type === 'image') images.push(block.data);
    }
    const out: OllamaMessage = { role: 'user', content: texts.join('\n') };
    if (images.length > 0) out.images = images;
    return [out];
  }

  if (message.role === 'assistant') {
    const texts: string[] = [];
    const thinking: string[] = [];
    const toolCalls: Required<OllamaMessage>['tool_calls'] = [];
    for (const block of message.content) {
      if (block.type === 'text') texts.push(block.text);
      else if (block.type === 'thinking' && requestPlan) {
        const sameToolLoop = message.content.some((candidate) => candidate.type === 'toolCall');
        const decision = decideContinuationReplay(block.continuation, requestPlan, { sameToolLoop });
        if (
          decision.action === 'replay'
          && block.continuation?.reasoningContent
        ) thinking.push(block.continuation.reasoningContent);
      } else if (block.type === 'toolCall') {
        toolCalls.push({
          function: { name: block.name, arguments: block.arguments ?? {} },
        });
      }
    }
    const out: OllamaMessage = { role: 'assistant', content: texts.join('') };
    if (thinking.length > 0) out.thinking = thinking.join('');
    if (toolCalls.length > 0) out.tool_calls = toolCalls;
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
      content: textBlocks.join('\n'),
      tool_name: message.toolName,
    },
  ];
}

function mapDoneReason(reason: string | null | undefined, hadToolCall: boolean): StopReason {
  if (hadToolCall && (!reason || reason === 'stop')) return 'toolUse';
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'load':
    case null:
    case undefined:
      return 'stop';
    default:
      return 'stop';
  }
}

export { mapDoneReason, toOllamaMessages };
