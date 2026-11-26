/**
 * Azure OpenAI Responses — URL and api-key auth only.
 * The Responses event loop and request body live in responsesShared.
 */

import { applyRequestPlanBody, requestPlanHeaders } from './requestPlanWire';
import { ProviderHttpError } from './internal/http';
import { sendProviderRequest, startProviderStream } from './internal/providerStreamDriver';
import {
  buildResponsesRequestBody,
  consumeResponsesEventStream,
  toResponsesInput,
  type ResponsesStreamSurface,
} from './internal/responsesShared';
import type { EventStream } from '../core/EventStream';
import type { AssistantMessage, AssistantMessageEvent, Context, Model, StreamOptions } from '../core/types';
import type { ProviderStrategy } from '../core/ProviderRegistry';

const DEFAULT_API_VERSION = '2024-10-21';
const PROVIDER_API = 'azure-openai-responses';

const AZURE_RESPONSES_SURFACE: ResponsesStreamSurface = {
  protocol: PROVIDER_API,
  failureMessages: {
    failed: 'Azure OpenAI Responses request failed',
    error: 'Azure OpenAI Responses stream error',
  },
};

export interface AzureOpenAIResponsesProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  /** Azure API version; defaults to 2024-10-21. */
  apiVersion?: string;
  headers?: Record<string, string>;
}

export class AzureOpenAIResponsesProvider implements ProviderStrategy {
  readonly api = PROVIDER_API;
  private readonly defaultBaseUrl: string;
  private readonly defaultApiKey: string | undefined;
  private readonly apiVersion: string;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: AzureOpenAIResponsesProviderOptions = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
    this.defaultApiKey = options.apiKey;
    this.apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
    this.defaultHeaders = { ...(options.headers ?? {}) };
  }

  stream(model: Model, context: Context, options: StreamOptions): EventStream<AssistantMessageEvent, AssistantMessage> {
    return startProviderStream({ providerApi: PROVIDER_API, model, options }, async (run) => {
      const response = await this.send(model, context, options, run.signal);
      return consumeResponsesEventStream(response, run, options, AZURE_RESPONSES_SURFACE);
    });
  }

  private async send(model: Model, context: Context, options: StreamOptions, signal: AbortSignal): Promise<Response> {
    const baseUrl = (options.baseUrl ?? this.defaultBaseUrl).replace(/\/+$/, '');
    const apiKey = options.apiKey ?? this.defaultApiKey;
    if (!apiKey) {
      throw new ProviderHttpError(PROVIDER_API, 401, 'missing apiKey for Azure OpenAI Responses provider');
    }
    const url = buildAzureResponsesUrl(baseUrl, this.apiVersion);
    const body = applyRequestPlanBody(buildResponsesRequestBody(model, context, options), options.requestPlan);
    return sendProviderRequest(PROVIDER_API, options.requestPlan, signal, {
      url,
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
        ...this.defaultHeaders,
        ...requestPlanHeaders(options.requestPlan),
      },
      body,
    });
  }
}

export function buildAzureResponsesUrl(baseUrl: string, apiVersion: string): string {
  const trimmed = baseUrl.replace(/\/+$/u, '');
  const path = trimmed.endsWith('/responses') ? trimmed : `${trimmed}/responses`;
  const url = new URL(path);
  url.searchParams.set('api-version', apiVersion);
  return url.toString();
}

export { buildResponsesRequestBody as buildRequestBody, toResponsesInput };
