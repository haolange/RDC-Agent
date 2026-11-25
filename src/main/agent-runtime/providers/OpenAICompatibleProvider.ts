/**
 * OpenAI-compatible Provider —— 适配 OpenAI Chat Completions 协议族。
 *
 * 覆盖：
 * - OpenAI / Azure OpenAI
 * - OpenRouter
 * - DeepSeek、Qwen DashScope（兼容模式）
 * - 任何对外暴露同协议 `/chat/completions` 的服务
 *
 * 使用原生 fetch + 自实现 SSE 解析，不引入 `openai` SDK。
 */

import { AppError } from '@shared/errors/appError';
import { applyRequestPlanBody, requestPlanHeaders } from './requestPlanWire';
import { partitionSystemPrompt } from './promptCacheWire';
import { ProviderStreamProtocolError } from './internal/AssistantStreamBuilder';
import {
  CHAT_COMPLETIONS_USAGE_FIELDS,
  consumeChatCompletionsStream,
  toChatCompletionsMessage,
  toChatCompletionsTool,
  type ChatCompletionsChoice,
  type ChatCompletionsDialect,
  type ChatCompletionsMessage,
} from './internal/chatCompletionsWire';
import { ProviderHttpError } from './internal/http';
import { sendProviderRequest, startProviderStream } from './internal/providerStreamDriver';
import { applyOpenAiCompatibleReasoning } from './reasoningWire';
import { requiresAssistantReasoningContent } from './reasoningContentReplay';
import type { ProviderRequestAuthorizer } from '../../settings/provider-auth/AwsBedrockCredentials';
import type { RequestPlan } from '@shared/types/providerCapability';
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

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const PROVIDER_API = 'openai-compatible';

function hasSemanticChoice(choice: ChatCompletionsChoice): boolean {
  const delta = choice.delta;
  return Boolean(
    (typeof delta?.content === 'string' && delta.content.length > 0)
    || (typeof delta?.reasoning === 'string' && delta.reasoning.length > 0)
    || (typeof delta?.reasoning_content === 'string' && delta.reasoning_content.length > 0)
    || (Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0),
  );
}

/**
 * Requests ask for one choice: choice 0 is read, any other choice with content is a channel collision, and after
 * finish_reason only content-free chunks (usage, keep-alives) may follow.
 */
function selectSingleChoice(
  choices: ChatCompletionsChoice[],
  finishReasonSeen: boolean,
  terminalRef: ProviderOutputRef,
): ChatCompletionsChoice | undefined {
  if (finishReasonSeen) {
    if (choices.some(hasSemanticChoice)) {
      throw new ProviderStreamProtocolError(
        'PROVIDER_STREAM_EVENT_AFTER_TERMINAL',
        terminalRef,
        'Provider emitted another semantic Chat Completions choice after finish_reason.',
      );
    }
    return undefined;
  }
  const choice = choices.find((candidate) => (candidate.index ?? 0) === 0) ?? choices[0];
  if (choice && choices.some((candidate) => candidate !== choice && hasSemanticChoice(candidate))) {
    throw new ProviderStreamProtocolError(
      'PROVIDER_STREAM_CHANNEL_COLLISION',
      terminalRef,
      'Provider emitted multiple semantic Chat Completions choices for a single-choice request.',
    );
  }
  return choice;
}

const OPENAI_COMPATIBLE_DIALECT: ChatCompletionsDialect = {
  providerApi: PROVIDER_API,
  selectChoice: selectSingleChoice,
  usageFields: CHAT_COMPLETIONS_USAGE_FIELDS,
  recordsExecution: true,
};

export interface OpenAICompatibleProviderOptions {
  /** 默认 baseUrl，可被 `StreamOptions.baseUrl` 覆盖。 */
  baseUrl?: string;
  /** 默认 API key，可被 `StreamOptions.apiKey` 覆盖。 */
  apiKey?: string;
  /** 附加请求头（例如 OpenRouter 的 HTTP-Referer / X-Title）。 */
  headers?: Record<string, string>;
  /** Some compatible surfaces (for example Azure) use a non-Bearer API-key header. */
  authorization?: 'bearer' | 'none';
  /** Explicitly configured local runtimes may accept requests without credentials. */
  allowAnonymous?: boolean;
  query?: Record<string, string>;
  /** Body-aware authorization, used by transports such as AWS SigV4. */
  requestAuthorizer?: ProviderRequestAuthorizer;
}

export class OpenAICompatibleProvider implements ProviderStrategy {
  readonly api = PROVIDER_API;
  private readonly defaultBaseUrl: string;
  private readonly defaultApiKey: string | undefined;
  private readonly defaultHeaders: Record<string, string>;
  private readonly authorization: 'bearer' | 'none';
  private readonly allowAnonymous: boolean;
  private readonly query: Record<string, string>;
  private readonly requestAuthorizer: ProviderRequestAuthorizer | undefined;

  constructor(options: OpenAICompatibleProviderOptions = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.defaultApiKey = options.apiKey;
    this.defaultHeaders = { ...(options.headers ?? {}) };
    this.authorization = options.authorization ?? 'bearer';
    this.allowAnonymous = options.allowAnonymous === true;
    this.query = { ...(options.query ?? {}) };
    this.requestAuthorizer = options.requestAuthorizer;
  }

  stream(
    model: Model,
    context: Context,
    options: StreamOptions,
  ): EventStream<AssistantMessageEvent, AssistantMessage> {
    return startProviderStream({ providerApi: PROVIDER_API, model, options }, async (run) => {
      const response = await this.send(model, context, options, run.signal);
      return consumeChatCompletionsStream(response, run, options, OPENAI_COMPATIBLE_DIALECT);
    });
  }

  private async send(model: Model, context: Context, options: StreamOptions, signal: AbortSignal): Promise<Response> {
    const baseUrl = (options.baseUrl ?? this.defaultBaseUrl).replace(/\/+$/, '');
    const apiKey = options.apiKey ?? this.defaultApiKey;
    if (!this.allowAnonymous && !apiKey && !this.requestAuthorizer) {
      throw new ProviderHttpError(PROVIDER_API, 401, 'missing apiKey for OpenAI-compatible provider');
    }
    const body = applyRequestPlanBody(this.buildRequestBody(model, context, options), options.requestPlan);
    return sendProviderRequest(PROVIDER_API, options.requestPlan, signal, {
      url: buildChatCompletionsUrl(baseUrl, this.query),
      headers: {
        'Content-Type': 'application/json',
        ...(this.authorization === 'bearer' && apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...this.defaultHeaders,
        ...requestPlanHeaders(options.requestPlan),
      },
      body,
      authorizer: this.requestAuthorizer,
    });
  }

  private buildRequestBody(
    model: Model,
    context: Context,
    options: StreamOptions,
  ): Record<string, unknown> {
    const messages = toOpenAIMessages(context, options.requestPlan, options.promptCache);
    const body: Record<string, unknown> = {
      model: model.id,
      messages,
      stream: true,
    };
    if (options.promptCache?.enabled
      && options.promptCache.keyCarrier === 'prompt-cache-key'
      && options.promptCache.requestKey) {
      body.prompt_cache_key = options.promptCache.requestKey;
    }
    if (options.promptCache?.enabled
      && options.promptCache.breakpointCarrier === 'openai-prompt-cache'
      && (
        options.promptCache.breakpoint === 'explicit'
        || options.promptCache.breakpoint === 'automatic-and-explicit'
      )) {
      body.prompt_cache_options = {
        mode: options.promptCache.breakpoint === 'explicit' ? 'explicit' : 'implicit',
        ...(options.promptCache.ttl === 'thirty-minutes' ? { ttl: '30m' } : {}),
      };
    }
    if (typeof options.temperature === 'number') body.temperature = options.temperature;
    if (typeof options.topP === 'number') body.top_p = options.topP;
    applyOpenAiCompatibleReasoning(body, options.reasoning);
    const maxTokens = options.maxTokens ?? model.maxTokens;
    if (typeof maxTokens === 'number' && maxTokens > 0) body.max_tokens = maxTokens;
    if (context.tools && context.tools.length > 0) {
      body.tools = context.tools.map(toChatCompletionsTool);
      body.tool_choice = 'auto';
    }
    // 请求 usage 统计（OpenAI 在 stream_options 中支持）
    body.stream_options = { include_usage: true };
    return body;
  }
}

export function buildChatCompletionsUrl(baseUrl: string, query: Readonly<Record<string, string>> = {}): string {
  const trimmed = baseUrl.replace(/\/+$/u, '');
  const url = trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
  const entries = Object.entries(query).filter(([, value]) => value.trim().length > 0);
  if (entries.length === 0) return url;
  const result = new URL(url);
  for (const [name, value] of entries) result.searchParams.set(name, value);
  return result.toString();
}

// =====================================================================
// 转换辅助
// =====================================================================

function toOpenAIMessages(
  context: Context,
  requestPlan: RequestPlan,
  promptCache?: StreamOptions['promptCache'],
): ChatCompletionsMessage[] {
  const out: ChatCompletionsMessage[] = [];
  const prompt = partitionSystemPrompt(context);
  const explicitBreakpoint = promptCache?.enabled === true
    && promptCache.breakpointCarrier === 'openai-prompt-cache'
    && (
      promptCache.breakpoint === 'explicit'
      || promptCache.breakpoint === 'automatic-and-explicit'
    );
  if (explicitBreakpoint) {
    if (!prompt.stableText) {
      throw new AppError(
        'PROMPT_CACHE_STABLE_PREFIX_UNAVAILABLE', 'explicit OpenAI cache mode requires PromptPlan-owned stable segments.',
      );
    }
    const content: Array<Record<string, unknown>> = [{
      type: 'text',
      text: prompt.stableText,
      prompt_cache_breakpoint: { mode: 'explicit' },
    }];
    if (prompt.volatileText) content.push({ type: 'text', text: prompt.volatileText });
    out.push({ role: 'system', content });
  } else if (prompt.combinedText) {
    out.push({ role: 'system', content: prompt.combinedText });
  }
  const requireReasoningContent = requiresAssistantReasoningContent(
    requestPlan,
    Boolean(context.tools && context.tools.length > 0),
  );
  for (const message of context.messages) {
    out.push(toChatCompletionsMessage(message, requestPlan, requireReasoningContent));
  }
  return out;
}

export { toOpenAIMessages };
