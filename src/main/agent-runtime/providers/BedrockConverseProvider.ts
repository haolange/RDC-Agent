/**
 * AWS Bedrock Converse Stream Provider —— 适配 Bedrock Converse API 协议。
 *
 * Bedrock Converse uses a DIFFERENT wire format from OpenAI/Anthropic:
 * - Request: { system, messages, toolConfig, inferenceConfig }
 * - Response streaming: messageStart, contentBlockStart, contentBlockDelta, contentBlockStop, messageStop events
 * - Cache: cachePoint: { type: 'default' } placed in system/messages
 * - SigV4 signing via ProviderRequestAuthorizer
 * - Endpoint: https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/converse-stream
 *
 * 使用原生 fetch。流式帧走共享 readProviderFrames，不引入第三方 SDK。
 */

import { z } from 'zod';
import { applyRequestPlanBody, requestPlanHeaders } from './requestPlanWire';
import { partitionSystemPrompt } from './promptCacheWire';
import { StreamChannelRefs } from './internal/streamChannelRefs';
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
import type { EventStream } from '../core/EventStream';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Message,
  Model,
  ProviderOutputRef,
  StopReason,
  StreamOptions,
  ToolDefinition,
} from '../core/types';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import type { ProviderRequestAuthorizer } from '../../settings/provider-auth/AwsBedrockCredentials';

const PROVIDER_API = 'bedrock-converse-stream';

export interface BedrockConverseProviderOptions {
  /** AWS region for endpoint construction. */
  region?: string;
  /** Full base URL override; takes precedence over region-based construction. */
  baseUrl?: string;
  /** Body-aware SigV4 authorization. */
  requestAuthorizer?: ProviderRequestAuthorizer;
  headers?: Record<string, string>;
}

// =====================================================================
// Bedrock Converse wire types
// =====================================================================

interface BedrockSystemBlock {
  text?: string;
  cachePoint?: { type: 'default' };
}

interface BedrockContentBlock {
  text?: string;
  image?: { format: string; source: { bytes: string } };
  toolUse?: { toolUseId: string; name: string; input: unknown };
  toolResult?: { toolUseId: string; content: Array<{ text?: string; json?: unknown }>; status?: 'success' | 'error' };
  reasoningContent?: { reasoningText?: { text?: string; signature?: string } };
  cachePoint?: { type: 'default' };
}

interface BedrockMessage {
  role: 'user' | 'assistant';
  content: BedrockContentBlock[];
}

interface BedrockToolConfig {
  tools: Array<{
    toolSpec: {
      name: string;
      description: string;
      inputSchema: { json: unknown };
    };
  }>;
  toolChoice?: { auto: Record<string, never> } | { any: Record<string, never> };
}

interface BedrockInferenceConfig {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
}

interface BedrockConverseRequest {
  system?: BedrockSystemBlock[];
  messages: BedrockMessage[];
  toolConfig?: BedrockToolConfig;
  inferenceConfig?: BedrockInferenceConfig;
}

/** One Converse stream event; event kinds and fields this adapter does not read pass through. */
const optionalIndex = z.number().optional();
const BedrockStreamEventSchema = z.object({
  messageStart: z.object({ role: z.string().optional() }).passthrough().optional(),
  contentBlockStart: z.object({
    contentBlockIndex: optionalIndex,
    start: z.object({
      toolUse: z.object({ toolUseId: z.string().optional(), name: z.string().optional() }).passthrough().optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
  contentBlockDelta: z.object({
    contentBlockIndex: optionalIndex,
    delta: z.object({
      text: z.string().optional(),
      toolUse: z.object({ input: z.string().optional() }).passthrough().optional(),
      reasoningContent: z.object({ text: z.string().optional() }).passthrough().optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
  contentBlockStop: z.object({ contentBlockIndex: optionalIndex }).passthrough().optional(),
  messageStop: z.object({ stopReason: z.string().optional() }).passthrough().optional(),
  metadata: z.object({
    usage: z.object({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      totalTokens: z.number().optional(),
      cacheReadInputTokens: z.number().optional(),
      cacheWriteInputTokens: z.number().optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough();
type BedrockStreamEvent = z.infer<typeof BedrockStreamEventSchema>;
type BedrockUsage = NonNullable<NonNullable<BedrockStreamEvent['metadata']>['usage']>;

const BEDROCK_FRAMES: ProviderFrameStream<BedrockStreamEvent> = {
  providerApi: PROVIDER_API,
  framing: 'sse',
  frameSchema: BedrockStreamEventSchema,
};

const BEDROCK_USAGE_FIELDS: UsageFieldMap<BedrockUsage> = {
  inputTokens: (usage) => usage.inputTokens,
  outputTokens: (usage) => usage.outputTokens,
  totalTokens: (usage) => usage.totalTokens,
  cacheReadTokens: (usage) => usage.cacheReadInputTokens,
  cacheWriteTokens: (usage) => usage.cacheWriteInputTokens,
};

export class BedrockConverseProvider implements ProviderStrategy {
  readonly api = PROVIDER_API;
  private readonly region: string | undefined;
  private readonly baseUrl: string | undefined;
  private readonly requestAuthorizer: ProviderRequestAuthorizer | undefined;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: BedrockConverseProviderOptions = {}) {
    this.region = options.region;
    this.baseUrl = options.baseUrl?.replace(/\/+$/, '');
    this.requestAuthorizer = options.requestAuthorizer;
    this.defaultHeaders = { ...(options.headers ?? {}) };
  }

  stream(
    model: Model,
    context: Context,
    options: StreamOptions,
  ): EventStream<AssistantMessageEvent, AssistantMessage> {
    return startProviderStream({ providerApi: PROVIDER_API, model, options }, async (run) => {
      const response = await this.send(model, context, options, run.signal);
      return consumeBedrockStream(response, run, options);
    });
  }

  private async send(model: Model, context: Context, options: StreamOptions, signal: AbortSignal): Promise<Response> {
    if (!this.requestAuthorizer) {
      throw new ProviderHttpError(PROVIDER_API, 401, 'missing requestAuthorizer for Bedrock Converse provider');
    }
    const url = this.buildEndpointUrl(model.id, options.baseUrl);
    const body = applyRequestPlanBody(this.buildRequestBody(model, context, options) as unknown as Record<string, unknown>, options.requestPlan);
    return sendProviderRequest(PROVIDER_API, options.requestPlan, signal, {
      url,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...this.defaultHeaders,
        ...requestPlanHeaders(options.requestPlan),
      },
      body,
      authorizer: this.requestAuthorizer,
    });
  }

  private buildEndpointUrl(modelId: string, baseUrlOverride?: string): string {
    return buildBedrockConverseStreamUrl(modelId, baseUrlOverride || this.baseUrl, this.region);
  }

  private buildRequestBody(
    model: Model,
    context: Context,
    options: StreamOptions,
  ): BedrockConverseRequest {
    const prompt = partitionSystemPrompt(context);
    const system: BedrockSystemBlock[] = [];
    if (prompt.stableText) {
      system.push({ text: prompt.stableText, cachePoint: { type: 'default' } });
    }
    if (prompt.volatileText) {
      system.push({ text: prompt.volatileText });
    } else if (!prompt.stableText && prompt.combinedText) {
      system.push({ text: prompt.combinedText });
    }

    const messages = toBedrockMessages(context);

    const request: BedrockConverseRequest = {
      messages,
    };
    if (system.length > 0) {
      request.system = system;
    }

    const inferenceConfig: BedrockInferenceConfig = {};
    const maxTokens = options.maxTokens ?? model.maxTokens;
    if (typeof maxTokens === 'number' && maxTokens > 0) {
      inferenceConfig.maxTokens = maxTokens;
    }
    if (typeof options.temperature === 'number') {
      inferenceConfig.temperature = options.temperature;
    }
    if (typeof options.topP === 'number') {
      inferenceConfig.topP = options.topP;
    }
    if (Object.keys(inferenceConfig).length > 0) {
      request.inferenceConfig = inferenceConfig;
    }

    if (context.tools && context.tools.length > 0) {
      request.toolConfig = {
        tools: context.tools.map(toBedrockTool),
        toolChoice: { auto: {} },
      };
    }

    return request;
  }
}

/**
 * Reads Converse stream events. Content blocks are addressed by contentBlockIndex: text and reasoning open on their
 * first delta, a tool call opens on contentBlockStart, and contentBlockStop closes whatever the index holds.
 */
async function consumeBedrockStream(
  response: Response,
  { builder, signal }: ProviderStreamRun,
  options: StreamOptions,
): Promise<{ sawOutput: boolean }> {
  const channels = new StreamChannelRefs(PROVIDER_API);
  const textRefs = new Map<number, ProviderOutputRef>();
  const thinkingRefs = new Map<number, ProviderOutputRef>();
  const toolCalls = new ToolCallAccumulator<number>(builder);
  const toolRef = (blockIndex: number) => channels.ref({ providerBlockKey: `virtual:tool:${blockIndex}`, sourceIndex: blockIndex });
  let sawOutput = false;
  const thinkingMeta = {
    kind: 'raw' as const,
    source: 'unknown' as const,
    visibility: 'raw-collapsed' as const,
  };

  for await (const event of readProviderFrames(response, signal, options, BEDROCK_FRAMES)) {
    if (event.messageStart) {
      // Message started; role is typically 'assistant'
      continue;
    }

    if (event.contentBlockStart) {
      const blockIndex = event.contentBlockStart.contentBlockIndex ?? 0;
      const start = event.contentBlockStart.start;
      if (start?.toolUse) {
        const ref = toolRef(blockIndex);
        sawOutput = true;
        toolCalls.start(blockIndex, ref, start.toolUse.toolUseId ?? '', start.toolUse.name ?? '');
      }
      continue;
    }

    if (event.contentBlockDelta) {
      const blockIndex = event.contentBlockDelta.contentBlockIndex ?? 0;
      const delta = event.contentBlockDelta.delta;

      if (delta?.text) {
        sawOutput = true;
        let textRef = textRefs.get(blockIndex);
        if (!textRef) {
          textRef = channels.ref({
            providerBlockKey: `output:text:${blockIndex}`,
            sourceIndex: blockIndex,
          });
          textRefs.set(blockIndex, textRef);
          builder.startText(textRef);
        }
        builder.appendText(textRef, delta.text);
      }

      if (delta?.reasoningContent?.text) {
        sawOutput = true;
        let thinkingRef = thinkingRefs.get(blockIndex);
        if (!thinkingRef) {
          thinkingRef = channels.ref({
            providerBlockKey: `output:thinking:${blockIndex}`,
            sourceIndex: blockIndex,
          });
          thinkingRefs.set(blockIndex, thinkingRef);
          builder.startThinking(thinkingRef, thinkingMeta);
        }
        builder.appendThinking(thinkingRef, delta.reasoningContent.text, thinkingMeta);
      }

      if (delta?.toolUse?.input && toolCalls.isOpen(blockIndex)) {
        sawOutput = true;
        toolCalls.appendArguments(blockIndex, toolRef(blockIndex), delta.toolUse.input);
      }
      continue;
    }

    if (event.contentBlockStop) {
      const blockIndex = event.contentBlockStop.contentBlockIndex ?? 0;
      if (toolCalls.isOpen(blockIndex)) toolCalls.close(blockIndex, toolRef(blockIndex));
      const textRef = textRefs.get(blockIndex);
      if (textRef) {
        builder.endText(textRef);
        textRefs.delete(blockIndex);
      }
      const thinkingRef = thinkingRefs.get(blockIndex);
      if (thinkingRef) {
        builder.endThinking(thinkingRef, thinkingMeta);
        thinkingRefs.delete(blockIndex);
      }
      continue;
    }

    if (event.messageStop) {
      builder.markTerminal(mapBedrockStopReason(event.messageStop.stopReason));
      continue;
    }

    if (event.metadata?.usage) {
      builder.setUsage(normalizeUsage(event.metadata.usage, BEDROCK_USAGE_FIELDS));
      continue;
    }
  }
  return { sawOutput };
}

// =====================================================================
// 转换辅助
// =====================================================================

function toBedrockMessages(context: Context): BedrockMessage[] {
  const out: BedrockMessage[] = [];
  for (const message of context.messages) {
    const converted = convertMessage(message);
    if (converted) {
      out.push(converted);
    }
  }
  return out;
}

function convertMessage(message: Message): BedrockMessage | null {
  if (message.role === 'user') {
    const content: BedrockContentBlock[] = [];
    if (typeof message.content === 'string') {
      content.push({ text: message.content });
    } else {
      for (const block of message.content) {
        if (block.type === 'text') {
          content.push({ text: block.text });
        } else {
          content.push({
            image: {
              format: block.mimeType.split('/')[1] ?? 'png',
              source: { bytes: block.data },
            },
          });
        }
      }
    }
    return { role: 'user', content };
  }

  if (message.role === 'assistant') {
    const content: BedrockContentBlock[] = [];
    for (const block of message.content) {
      if (block.type === 'text') {
        content.push({ text: block.text });
      } else if (block.type === 'thinking') {
        // Bedrock reasoning content replay
        if (block.continuation?.carrier === 'reasoning-content' && block.continuation.reasoningContent) {
          content.push({
            reasoningContent: {
              reasoningText: { text: block.continuation.reasoningContent },
            },
          });
        }
      } else {
        content.push({
          toolUse: {
            toolUseId: block.id,
            name: block.name,
            input: block.arguments,
          },
        });
      }
    }
    return { role: 'assistant', content };
  }

  // toolResult - Bedrock expects tool results as user messages
  const toolResultContent: Array<{ text?: string }> = [];
  for (const block of message.content) {
    if (block.type === 'text') {
      toolResultContent.push({ text: block.text });
    }
  }
  return {
    role: 'user',
    content: [{
      toolResult: {
        toolUseId: message.toolCallId,
        content: toolResultContent.length > 0 ? toolResultContent : [{ text: '' }],
        status: message.isError ? 'error' : 'success',
      },
    }],
  };
}

function toBedrockTool(tool: ToolDefinition): BedrockToolConfig['tools'][number] {
  return {
    toolSpec: {
      name: tool.name,
      description: tool.description,
      inputSchema: { json: tool.parameters },
    },
  };
}

function mapBedrockStopReason(reason: string | undefined): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'toolUse';
    case 'content_filtered':
      return 'refusal';
    default:
      return 'stop';
  }
}

export { mapBedrockStopReason, toBedrockMessages };

/**
 * The ConverseStream operation URL: a configured base is the model's endpoint prefix; without one the
 * regional runtime endpoint names the model.
 */
export function buildBedrockConverseStreamUrl(modelId: string, baseUrl?: string, region?: string): string {
  if (baseUrl) {
    const trimmed = baseUrl.replace(/\/+$/u, '');
    return trimmed.endsWith('/converse-stream') ? trimmed : `${trimmed}/converse-stream`;
  }
  const resolvedRegion = region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
  return `https://bedrock-runtime.${resolvedRegion}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse-stream`;
}
