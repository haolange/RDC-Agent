import { EventStream } from '../core/EventStream';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  StreamOptions,
} from '../core/types';
import { applyRequestPlanBody, requestPlanHeaders } from './requestPlanWire';
import { recordQuotaFromResponse } from '../../settings/provider-catalog/ProviderQuota';
import { AssistantStreamBuilder } from './internal/AssistantStreamBuilder';
import {
  composeAbortSignals,
  ensureOk,
  normalizeError,
  ProviderHttpError,
} from './internal/http';
import {
  buildResponsesRequestBody,
  consumeResponsesEventStream,
  isDeepSeekResponsesPlan,
  readDeepSeekReasoningText,
  toResponsesInput,
} from './internal/responsesShared';
import { isReasoningEnabled } from './reasoningWire';
import type { ProviderRequestAuthorizer } from '../../settings/provider-auth/AwsBedrockCredentials';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const PROVIDER_API = 'openai-responses';

export interface OpenAIResponsesProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  accountId?: string;
  headers?: Record<string, string>;
  /** Explicitly configured local runtimes may accept requests without credentials. */
  allowAnonymous?: boolean;
  /** Body-aware authorization, used by transports such as AWS SigV4. */
  requestAuthorizer?: ProviderRequestAuthorizer;
}

export class OpenAIResponsesProvider implements ProviderStrategy {
  readonly api = PROVIDER_API;
  private readonly defaultBaseUrl: string;
  private readonly defaultApiKey: string | undefined;
  private readonly accountId: string | undefined;
  private readonly defaultHeaders: Record<string, string>;
  private readonly allowAnonymous: boolean;
  private readonly requestAuthorizer: ProviderRequestAuthorizer | undefined;

  constructor(options: OpenAIResponsesProviderOptions = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.defaultApiKey = options.apiKey;
    this.accountId = options.accountId?.trim() || undefined;
    this.defaultHeaders = { ...(options.headers ?? {}) };
    this.allowAnonymous = options.allowAnonymous === true;
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
      if (!this.allowAnonymous && !apiKey && !this.requestAuthorizer) {
        throw new ProviderHttpError(PROVIDER_API, 401, 'missing apiKey for OpenAI Responses provider');
      }
      const url = buildOpenAIResponsesUrl(baseUrl);
      const bodyText = JSON.stringify(applyRequestPlanBody(buildResponsesRequestBody(model, context, options), options.requestPlan));
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
      await consumeResponsesEventStream({
        protocol: PROVIDER_API,
        response,
        signal: composed.signal,
        options,
        builder,
        failureMessages: {
          failed: 'OpenAI Responses request failed',
          error: 'OpenAI Responses stream error',
        },
      });
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

export const __testing = {
  buildRequestBody: buildResponsesRequestBody,
  isDeepSeekResponsesPlan,
  isReasoningEnabled,
  readDeepSeekReasoningText,
  toResponsesInput,
};
