/**
 * Mistral Conversations Provider —— 适配 Mistral AI Chat Completions 协议。
 *
 * Mistral's API is OpenAI-compatible at the wire level (Chat Completions format).
 * Key differences from generic OpenAI-compatible:
 * - Default base URL: https://api.mistral.ai/v1
 * - Mistral-specific headers (User-Agent)
 * - thinking_format support for reasoning models
 *
 * 使用原生 fetch + 自实现 SSE 解析，不引入第三方 SDK。
 */

import { applyRequestPlanBody, requestPlanHeaders } from './requestPlanWire';
import { partitionSystemPrompt } from './promptCacheWire';
import { ProviderStreamProtocolError } from './internal/AssistantStreamBuilder';
import {
  consumeChatCompletionsStream,
  toChatCompletionsMessage,
  toChatCompletionsTool,
  type ChatCompletionsChoice,
  type ChatCompletionsDialect,
  type ChatCompletionsMessage,
  type ChatCompletionsUsage,
} from './internal/chatCompletionsWire';
import { ProviderHttpError } from './internal/http';
import { sendProviderRequest, startProviderStream } from './internal/providerStreamDriver';
import { applyOpenAiCompatibleReasoning } from './reasoningWire';
import type { UsageFieldMap } from './internal/usageNormalizer';
import type { EventStream } from '../core/EventStream';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  ProviderOutputRef,
  StreamOptions,
} from '../core/types';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import type { RequestPlan } from '@shared/types/providerCapability';

const DEFAULT_BASE_URL = 'https://api.mistral.ai/v1';
const PROVIDER_API = 'mistral-conversations';

/** Mistral's first choice is read; once finish_reason arrived, any further choice ends the stream as a violation. */
function selectFirstChoice(
  choices: ChatCompletionsChoice[],
  finishReasonSeen: boolean,
  terminalRef: ProviderOutputRef,
): ChatCompletionsChoice | undefined {
  const choice = choices[0];
  if (choice && finishReasonSeen) {
    throw new ProviderStreamProtocolError(
      'PROVIDER_STREAM_EVENT_AFTER_TERMINAL',
      terminalRef,
      'Provider emitted another Chat Completions choice after finish_reason.',
    );
  }
  return choice;
}

/** Mistral reports token counts, cached prompt tokens and reasoning tokens, but no cache writes or native hit/miss. */
const MISTRAL_USAGE_FIELDS: UsageFieldMap<ChatCompletionsUsage> = {
  inputTokens: (usage) => usage.prompt_tokens,
  outputTokens: (usage) => usage.completion_tokens,
  totalTokens: (usage) => usage.total_tokens,
  cacheReadTokens: (usage) => usage.prompt_tokens_details?.cached_tokens,
  reasoningTokens: (usage) => usage.completion_tokens_details?.reasoning_tokens,
};

const MISTRAL_DIALECT: ChatCompletionsDialect = {
  providerApi: PROVIDER_API,
  selectChoice: selectFirstChoice,
  usageFields: MISTRAL_USAGE_FIELDS,
  recordsExecution: false,
};

export interface MistralProviderOptions {
  /** 默认 baseUrl，可被 `StreamOptions.baseUrl` 覆盖。 */
  baseUrl?: string;
  /** 默认 API key，可被 `StreamOptions.apiKey` 覆盖。 */
  apiKey?: string;
  /** 附加请求头。 */
  headers?: Record<string, string>;
}

export class MistralProvider implements ProviderStrategy {
  readonly api = PROVIDER_API;
  private readonly defaultBaseUrl: string;
  private readonly defaultApiKey: string | undefined;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: MistralProviderOptions = {}) {
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
      return consumeChatCompletionsStream(response, run, options, MISTRAL_DIALECT);
    });
  }

  private async send(model: Model, context: Context, options: StreamOptions, signal: AbortSignal): Promise<Response> {
    const baseUrl = (options.baseUrl ?? this.defaultBaseUrl).replace(/\/+$/, '');
    const apiKey = options.apiKey ?? this.defaultApiKey;
    if (!apiKey) {
      throw new ProviderHttpError(PROVIDER_API, 401, 'missing apiKey for Mistral provider');
    }
    const body = applyRequestPlanBody(this.buildRequestBody(model, context, options), options.requestPlan);
    return sendProviderRequest(PROVIDER_API, options.requestPlan, signal, {
      url: buildMistralChatCompletionsUrl(baseUrl),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'RDC-Agent',
        ...this.defaultHeaders,
        ...requestPlanHeaders(options.requestPlan),
      },
      body,
    });
  }

  private buildRequestBody(
    model: Model,
    context: Context,
    options: StreamOptions,
  ): Record<string, unknown> {
    const messages = toMistralMessages(context, options.requestPlan);
    const body: Record<string, unknown> = {
      model: model.id,
      messages,
      stream: true,
    };
    if (typeof options.temperature === 'number') body.temperature = options.temperature;
    if (typeof options.topP === 'number') body.top_p = options.topP;
    applyOpenAiCompatibleReasoning(body, options.reasoning);
    const maxTokens = options.maxTokens ?? model.maxTokens;
    if (typeof maxTokens === 'number' && maxTokens > 0) body.max_tokens = maxTokens;
    if (context.tools && context.tools.length > 0) {
      body.tools = context.tools.map(toChatCompletionsTool);
      body.tool_choice = 'auto';
    }
    body.stream_options = { include_usage: true };
    return body;
  }
}

export function buildMistralChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/u, '');
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
}

// =====================================================================
// 转换辅助
// =====================================================================

function toMistralMessages(
  context: Context,
  requestPlan: RequestPlan,
): ChatCompletionsMessage[] {
  const out: ChatCompletionsMessage[] = [];
  const prompt = partitionSystemPrompt(context);
  if (prompt.combinedText) {
    out.push({ role: 'system', content: prompt.combinedText });
  }
  for (const message of context.messages) {
    out.push(toChatCompletionsMessage(message, requestPlan, false));
  }
  return out;
}

export { toMistralMessages };
