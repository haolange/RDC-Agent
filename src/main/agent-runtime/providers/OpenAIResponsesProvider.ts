import { applyRequestPlanBody, requestPlanHeaders } from './requestPlanWire';
import { promptCacheHeaders } from './promptCacheWire';
import { ProviderHttpError } from './internal/http';
import { sendProviderRequest, startProviderStream } from './internal/providerStreamDriver';
import {
  buildResponsesRequestBody,
  consumeResponsesEventStream,
  isDeepSeekResponsesPlan,
  readDeepSeekReasoningText,
  toResponsesInput,
  type ResponsesStreamSurface,
} from './internal/responsesShared';
import { isReasoningEnabled } from './reasoningWire';
import type { EventStream } from '../core/EventStream';
import type { AssistantMessage, AssistantMessageEvent, Context, Model, StreamOptions } from '../core/types';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import type { ProviderRequestAuthorizer } from '../../settings/provider-auth/AwsBedrockCredentials';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const PROVIDER_API = 'openai-responses';

const OPENAI_RESPONSES_SURFACE: ResponsesStreamSurface = {
  protocol: PROVIDER_API,
  failureMessages: {
    failed: 'OpenAI Responses request failed',
    error: 'OpenAI Responses stream error',
  },
};

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

  stream(model: Model, context: Context, options: StreamOptions): EventStream<AssistantMessageEvent, AssistantMessage> {
    return startProviderStream({ providerApi: PROVIDER_API, model, options }, async (run) => {
      const response = await this.send(model, context, options, run.signal);
      return consumeResponsesEventStream(response, run, options, OPENAI_RESPONSES_SURFACE);
    });
  }

  private async send(model: Model, context: Context, options: StreamOptions, signal: AbortSignal): Promise<Response> {
    const baseUrl = (options.baseUrl ?? this.defaultBaseUrl).replace(/\/+$/, '');
    const apiKey = options.apiKey ?? this.defaultApiKey;
    if (!this.allowAnonymous && !apiKey && !this.requestAuthorizer) {
      throw new ProviderHttpError(PROVIDER_API, 401, 'missing apiKey for OpenAI Responses provider');
    }
    const url = buildOpenAIResponsesUrl(baseUrl);
    const body = applyRequestPlanBody(buildResponsesRequestBody(model, context, options), options.requestPlan);
    return sendProviderRequest(PROVIDER_API, options.requestPlan, signal, {
      url,
      headers: {
        ...(apiKey ? this.createHeaders(apiKey) : { 'Content-Type': 'application/json', ...this.defaultHeaders }),
        ...requestPlanHeaders(options.requestPlan),
        ...promptCacheHeaders(options.promptCache),
      },
      body,
      authorizer: this.requestAuthorizer,
    });
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

export {
  buildResponsesRequestBody as buildRequestBody,
  isDeepSeekResponsesPlan,
  isReasoningEnabled,
  readDeepSeekReasoningText,
  toResponsesInput,
};
