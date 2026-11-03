/**
 * Azure OpenAI Responses — URL and api-key auth only.
 * The Responses event loop and request body live in responsesShared.
 */

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
  toResponsesInput,
} from './internal/responsesShared';

const DEFAULT_API_VERSION = '2024-10-21';
const PROVIDER_API = 'azure-openai-responses';

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
      if (!apiKey) {
        throw new ProviderHttpError(PROVIDER_API, 401, 'missing apiKey for Azure OpenAI Responses provider');
      }
      const url = buildAzureResponsesUrl(baseUrl, this.apiVersion);
      const bodyText = JSON.stringify(applyRequestPlanBody(buildResponsesRequestBody(model, context, options), options.requestPlan));
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey,
          ...this.defaultHeaders,
          ...requestPlanHeaders(options.requestPlan),
        },
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
          failed: 'Azure OpenAI Responses request failed',
          error: 'Azure OpenAI Responses stream error',
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
}

export function buildAzureResponsesUrl(baseUrl: string, apiVersion: string): string {
  const trimmed = baseUrl.replace(/\/+$/u, '');
  const path = trimmed.endsWith('/responses') ? trimmed : `${trimmed}/responses`;
  const url = new URL(path);
  url.searchParams.set('api-version', apiVersion);
  return url.toString();
}

export const __testing = {
  buildAzureResponsesUrl,
  buildRequestBody: buildResponsesRequestBody,
  toResponsesInput,
};
