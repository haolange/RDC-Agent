/**
 * Google Gemini Provider —— 适配 `generativelanguage.googleapis.com` 的
 * `streamGenerateContent` 端点。
 *
 * 协议要点：
 * - 端点：`POST {baseUrl}/v1beta/models/{model}:streamGenerateContent?alt=sse&key=...`
 * - 默认响应是数组式 JSON 流，启用 `alt=sse` 后改为 SSE，便于行级解析。
 * - API key 通过 query param `key=` 传递，不放 header。
 * - system 指令走顶层 `systemInstruction` 字段。
 * - 工具结果以 `functionResponse` part 形式作为 user 消息回传。
 * - functionCall 不做增量流式，每个 chunk 中的 functionCall 都是完整对象。
 */

import { z } from 'zod';
import { createContinuationArtifact } from '../reasoning/ContinuationArtifacts';
import { decideContinuationReplay } from '../reasoning/ContinuationReplayPolicy';
import { applyRequestPlanBody, requestPlanHeaders } from './requestPlanWire';
import { AlternatingTextThinkingChannels, StreamChannelRefs } from './internal/streamChannelRefs';
import { ProviderHttpError } from './internal/http';
import {
  readProviderFrames,
  sendProviderRequest,
  startProviderStream,
  type ProviderFrameStream,
  type ProviderStreamRun,
} from './internal/providerStreamDriver';
import { ToolCallAccumulator } from './internal/toolCallAccumulator';
import { normalizeUsage, type UsageFieldMap } from './internal/usageNormalizer';
import { applyGeminiReasoning, reasoningVisibilityRequest } from './reasoningWire';
import { reasoningProjectionSource } from './reasoningProjection';
import type { AssistantStreamBuilder } from './internal/AssistantStreamBuilder';
import type { EventStream } from '../core/EventStream';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Message,
  Model,
  StopReason,
  StreamOptions,
  ThinkingArtifactSource,
  ToolDefinition,
} from '../core/types';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import type { RequestPlan } from '@shared/types/providerCapability';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const PROVIDER_API = 'google-gemini';

/** One streamGenerateContent chunk; part kinds this adapter does not read (inline data, ...) pass through. */
const GeminiStreamChunkSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(z.object({
        text: z.string().optional(),
        thought: z.boolean().optional(),
        thoughtSignature: z.string().optional(),
        functionCall: z.object({ name: z.string(), args: z.record(z.string(), z.unknown()).optional() }).passthrough().optional(),
      }).passthrough()).optional(),
      role: z.string().optional(),
    }).passthrough().optional(),
    finishReason: z.string().optional(),
    index: z.number().optional(),
  }).passthrough()).optional(),
  usageMetadata: z.object({
    promptTokenCount: z.number().optional(),
    candidatesTokenCount: z.number().optional(),
    totalTokenCount: z.number().optional(),
    thoughtsTokenCount: z.number().optional(),
  }).passthrough().optional(),
}).passthrough();
type GeminiStreamChunk = z.infer<typeof GeminiStreamChunkSchema>;
type GeminiCandidate = NonNullable<GeminiStreamChunk['candidates']>[number];
type GeminiPart = NonNullable<NonNullable<GeminiCandidate['content']>['parts']>[number];

const GEMINI_FRAMES: ProviderFrameStream<GeminiStreamChunk> = {
  providerApi: PROVIDER_API,
  framing: 'sse',
  frameSchema: GeminiStreamChunkSchema,
};

const GEMINI_USAGE_FIELDS: UsageFieldMap<NonNullable<GeminiStreamChunk['usageMetadata']>> = {
  inputTokens: (usage) => usage.promptTokenCount,
  outputTokens: (usage) => usage.candidatesTokenCount,
  totalTokens: (usage) => usage.totalTokenCount,
};

export interface GeminiProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  surface?: 'ai-studio' | 'vertex';
}

export class GeminiProvider implements ProviderStrategy {
  readonly api = PROVIDER_API;
  private readonly defaultBaseUrl: string;
  private readonly defaultApiKey: string | undefined;
  private readonly defaultHeaders: Record<string, string>;
  private readonly surface: 'ai-studio' | 'vertex';

  constructor(options: GeminiProviderOptions = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.defaultApiKey = options.apiKey;
    this.defaultHeaders = { ...(options.headers ?? {}) };
    this.surface = options.surface ?? 'ai-studio';
  }

  stream(
    model: Model,
    context: Context,
    options: StreamOptions,
  ): EventStream<AssistantMessageEvent, AssistantMessage> {
    return startProviderStream({ providerApi: PROVIDER_API, model, options }, async (run) => {
      const response = await this.send(model, context, options, run.signal);
      return consumeGeminiStream(response, run, options);
    });
  }

  private async send(model: Model, context: Context, options: StreamOptions, signal: AbortSignal): Promise<Response> {
    const baseUrl = (options.baseUrl ?? this.defaultBaseUrl).replace(/\/+$/, '');
    const apiKey = options.apiKey ?? this.defaultApiKey;
    if (!apiKey) {
      throw new ProviderHttpError(PROVIDER_API, 401, 'missing apiKey for Gemini provider');
    }
    const body = applyRequestPlanBody(this.buildRequestBody(context, options), options.requestPlan);
    return sendProviderRequest(PROVIDER_API, options.requestPlan, signal, {
      url: buildGeminiStreamUrl(baseUrl, model.id, apiKey, this.surface),
      headers: {
        'Content-Type': 'application/json',
        ...(this.surface === 'vertex' ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...this.defaultHeaders,
        ...requestPlanHeaders(options.requestPlan),
      },
      body,
    });
  }

  private buildRequestBody(
    context: Context,
    options: StreamOptions,
  ): Record<string, unknown> {
    const { systemInstruction, contents } = toGeminiContents(context, options.requestPlan);
    const body: Record<string, unknown> = { contents };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const generationConfig: Record<string, unknown> = {};
    if (typeof options.temperature === 'number') generationConfig.temperature = options.temperature;
    if (typeof options.topP === 'number') generationConfig.topP = options.topP;
    if (typeof options.maxTokens === 'number') generationConfig.maxOutputTokens = options.maxTokens;
    applyGeminiReasoning(generationConfig, options.reasoning, reasoningVisibilityRequest(options));
    if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

    if (context.tools && context.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: context.tools.map(toGeminiTool),
        },
      ];
    }
    return body;
  }
}

export function buildGeminiStreamUrl(
  baseUrl: string,
  modelId: string,
  apiKey: string,
  surface: 'ai-studio' | 'vertex' = 'ai-studio',
): string {
  const trimmed = baseUrl.replace(/\/+$/u, '');
  const versionedBase = surface === 'vertex'
    ? trimmed
    : trimmed.includes('/v1beta') || trimmed.includes('/v1')
      ? trimmed
      : `${trimmed}/v1beta`;
  const endpoint = `${versionedBase}/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`;
  return surface === 'vertex' ? endpoint : `${endpoint}&key=${encodeURIComponent(apiKey)}`;
}

/**
 * Gemini chunks carry no block ids: text and thought summaries alternate as segments. Each functionCall part is a
 * whole call; its thoughtSignature becomes a hidden thinking block bound to that call.
 */
async function consumeGeminiStream(
  response: Response,
  run: ProviderStreamRun,
  options: StreamOptions,
): Promise<{ sawOutput: boolean }> {
  const state = new GeminiStreamState(run.builder, options.requestPlan);
  for await (const chunk of readProviderFrames(response, run.signal, options, GEMINI_FRAMES)) state.handle(chunk);
  return { sawOutput: state.sawOutput };
}

class GeminiStreamState {
  sawOutput = false;
  private readonly channels = new StreamChannelRefs(PROVIDER_API);
  private readonly alternating = new AlternatingTextThinkingChannels(this.channels);
  private readonly toolCalls: ToolCallAccumulator<number>;
  private readonly summarySource: ThinkingArtifactSource;
  private readonly signatureSource: ThinkingArtifactSource;

  constructor(
    private readonly builder: AssistantStreamBuilder,
    private readonly requestPlan: RequestPlan,
  ) {
    this.toolCalls = new ToolCallAccumulator(builder);
    this.summarySource = reasoningProjectionSource(requestPlan, 'summary');
    this.signatureSource = reasoningProjectionSource(requestPlan, 'opaque');
  }

  handle(chunk: GeminiStreamChunk): void {
    if (chunk.usageMetadata) this.builder.setUsage(normalizeUsage(chunk.usageMetadata, GEMINI_USAGE_FIELDS));
    const candidate = chunk.candidates?.[0];
    if (!candidate) return;
    for (const [partIndex, part] of (candidate.content?.parts ?? []).entries()) {
      this.handlePart(candidate, partIndex, part);
    }
    if (candidate.finishReason) {
      this.builder.markTerminal(mapFinishReason(candidate.finishReason, this.toolCalls.count > 0));
    }
  }

  private handlePart(candidate: GeminiCandidate, partIndex: number, part: GeminiPart): void {
    const thoughtSignature = part.thoughtSignature;
    const partBindingKey = 'candidate:' + (candidate.index ?? 0) + ':part:' + partIndex;
    if (typeof part.text === 'string') {
      this.sawOutput = true;
      if (part.thought) {
        const continuation = thoughtSignature
          ? createContinuationArtifact(this.requestPlan, {
              type: 'thought_signature',
              thoughtSignature,
              containerBinding: { providerBlockKey: partBindingKey },
            })
          : undefined;
        this.alternating.appendThinking(this.builder, part.text, {
          kind: 'summary',
          source: this.summarySource,
          visibility: 'summary',
          continuation,
        });
      } else {
        this.alternating.appendText(this.builder, part.text);
      }
      return;
    }
    if (part.functionCall) {
      const callIndex = this.toolCalls.count;
      const callId = 'gemini-call-' + Date.now() + '-' + (callIndex + 1);
      this.sawOutput = true;
      if (thoughtSignature) {
        const signatureRef = this.channels.ref({
          providerBlockKey: partBindingKey + ':thought-signature',
          sourceIndex: partIndex,
        });
        this.builder.startThinking(signatureRef, {
          kind: 'opaque',
          source: this.signatureSource,
          visibility: 'hidden',
          continuation: createContinuationArtifact(this.requestPlan, {
            type: 'thought_signature',
            thoughtSignature,
            containerBinding: { providerBlockKey: partBindingKey, toolCallIds: [callId] },
          }),
        });
        this.builder.endThinking(signatureRef);
      }
      const toolRef = this.channels.ref({ providerBlockKey: `function:${callIndex}`, sourceIndex: callIndex });
      this.toolCalls.addComplete(callIndex, toolRef, callId, part.functionCall.name, JSON.stringify(part.functionCall.args ?? {}));
    }
    // inlineData / 其它 part 暂不处理。
  }
}

// =====================================================================
// 转换辅助
// =====================================================================

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<Record<string, unknown>>;
}

function toGeminiContents(context: Context, requestPlan: RequestPlan): {
  systemInstruction?: string;
  contents: GeminiContent[];
} {
  const contents: GeminiContent[] = [];
  for (const message of context.messages) {
    contents.push(...convertMessage(message, requestPlan));
  }
  return {
    systemInstruction:
      context.systemPrompt && context.systemPrompt.trim() ? context.systemPrompt : undefined,
    contents,
  };
}

function convertMessage(message: Message, requestPlan: RequestPlan): GeminiContent[] {
  if (message.role === 'user') {
    if (typeof message.content === 'string') {
      return [{ role: 'user', parts: [{ text: message.content }] }];
    }
    const parts: Array<Record<string, unknown>> = [];
    for (const block of message.content) {
      if (block.type === 'text') {
        parts.push({ text: block.text });
      } else {
        parts.push({
          inlineData: { mimeType: block.mimeType, data: block.data },
        });
      }
    }
    return [{ role: 'user', parts }];
  }

  if (message.role === 'assistant') {
    const parts: Array<Record<string, unknown>> = [];
    const pendingSignatures = new Map<string, string>();
    const toolCallIds = message.content
      .filter((block) => block.type === 'toolCall')
      .map((block) => block.id);
    for (const block of message.content) {
      if (block.type === 'text') {
        parts.push({ text: block.text });
      } else if (block.type === 'thinking') {
        const binding = block.continuation?.containerBinding;
        const decision = decideContinuationReplay(block.continuation, requestPlan, {
          sameToolLoop: toolCallIds.length > 0,
          providerBlockKey: binding?.providerBlockKey,
          itemId: binding?.itemId,
          toolCallIds: binding?.toolCallIds,
        });
        if (decision.action !== 'replay' || !block.continuation?.thoughtSignature) continue;
        if (binding?.toolCallIds?.length) {
          for (const toolCallId of binding.toolCallIds) {
            if (toolCallIds.includes(toolCallId)) pendingSignatures.set(toolCallId, block.continuation.thoughtSignature);
          }
        } else if (block.text) {
          parts.push({ text: block.text, thought: true, thoughtSignature: block.continuation.thoughtSignature });
        }
      } else {
        parts.push({
          functionCall: { name: block.name, args: block.arguments },
          ...(pendingSignatures.has(block.id) ? { thoughtSignature: pendingSignatures.get(block.id) } : {}),
        });
      }
    }
    return [{ role: 'model', parts }];
  }

  // toolResult -> functionResponse
  const textBlocks: string[] = [];
  for (const block of message.content) {
    if (block.type === 'text') textBlocks.push(block.text);
  }
  return [
    {
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: message.toolName,
            response: { content: textBlocks.join('\n'), isError: message.isError || undefined },
          },
        },
      ],
    },
  ];
}

function toGeminiTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

function mapFinishReason(reason: string | null | undefined, hadToolCall: boolean): StopReason {
  if (hadToolCall && (!reason || reason === 'STOP')) return 'toolUse';
  switch (reason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
      return 'refusal';
    default:
      return 'stop';
  }
}

export { mapFinishReason, toGeminiContents };
