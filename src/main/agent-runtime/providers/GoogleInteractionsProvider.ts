import { EventStream } from '../core/EventStream';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  StreamOptions,
} from '../core/types';
import { recordQuotaFromResponse } from '../../settings/ProviderQuota';
import { applyRequestPlanBody, requestPlanHeaders } from './requestPlanWire';
import { AssistantStreamBuilder } from './internal/AssistantStreamBuilder';
import {
  composeAbortSignals,
  ensureOk,
  normalizeError,
  parseSSE,
  ProviderEmptyStreamError,
  ProviderHttpError,
} from './internal/http';
import {
  buildGoogleInteractionsRequest,
  buildGoogleInteractionsUrl,
} from './GoogleInteractionsWire';
import { GoogleInteractionsStreamState } from './GoogleInteractionsStreamState';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1';
const PROVIDER_API = 'google-interactions';

export interface GoogleInteractionsProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

export class GoogleInteractionsProvider implements ProviderStrategy {
  readonly api = PROVIDER_API;
  private readonly defaultBaseUrl: string;
  private readonly defaultApiKey: string | undefined;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: GoogleInteractionsProviderOptions = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, '');
    this.defaultApiKey = options.apiKey;
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
    const baseUrl = (options.baseUrl ?? this.defaultBaseUrl).replace(/\/+$/u, '');
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
    const composed = composeAbortSignals(
      options.signal,
      stream.signal,
      { providerApi: PROVIDER_API, ...options },
    );
    try {
      builder.start();
      if (!apiKey) {
        throw new ProviderHttpError(PROVIDER_API, 401, 'missing apiKey for Google Interactions provider');
      }
      const body = applyRequestPlanBody(
        buildGoogleInteractionsRequest(model, context, options),
        options.requestPlan,
      );
      const response = await fetch(buildGoogleInteractionsUrl(baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'x-goog-api-key': apiKey,
          ...this.defaultHeaders,
          ...requestPlanHeaders(options.requestPlan),
        },
        body: JSON.stringify(body),
        signal: composed.signal,
      });
      recordQuotaFromResponse(options.requestPlan, response);
      await ensureOk(response, PROVIDER_API);

      const state = new GoogleInteractionsStreamState(builder, options.requestPlan);
      for await (const data of parseSSE(
        response,
        composed.signal,
        { providerApi: PROVIDER_API, ...options },
      )) {
        if (composed.signal.aborted) break;
        if (data.trim() === '[DONE]') {
          if (!state.outcome().terminalSeen) {
            throw new ProviderHttpError(PROVIDER_API, 502, 'Google Interactions sent [DONE] before terminal.');
          }
          break;
        }
        const event = parseEvent(data);
        if (!event) {
          throw new ProviderHttpError(PROVIDER_API, 502, 'Malformed Google Interactions SSE event.');
        }
        state.handle(event);
      }
      const outcome = state.outcome();
      if (!outcome.terminalSeen) {
        throw new ProviderHttpError(PROVIDER_API, 502, 'Google Interactions stream ended without a terminal event.');
      }
      if (!outcome.sawOutput) {
        throw new ProviderEmptyStreamError(PROVIDER_API);
      }
      builder.done(outcome.finishReason);
    } catch (cause) {
      const thrown = normalizeError(cause);
      const error = thrown.name === 'AbortError' && composed.signal.reason instanceof Error
        ? composed.signal.reason
        : thrown;
      builder.fail(error, error.name === 'AbortError' ? 'aborted' : 'error');
    } finally {
      composed.dispose();
    }
  }
}

export { buildGoogleInteractionsUrl };

function parseEvent(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
