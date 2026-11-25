import { applyRequestPlanBody, requestPlanHeaders } from './requestPlanWire';
import { ProviderStreamProtocolError } from './internal/AssistantStreamBuilder';
import { parseSSE, ProviderHttpError } from './internal/http';
import { sendProviderRequest, startProviderStream, type ProviderStreamRun } from './internal/providerStreamDriver';
import {
  buildGoogleInteractionsRequest,
  buildGoogleInteractionsUrl,
} from './GoogleInteractionsWire';
import { GoogleInteractionsStreamState } from './GoogleInteractionsStreamState';
import type { EventStream } from '../core/EventStream';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  StreamOptions,
} from '../core/types';
import type { ProviderStrategy } from '../core/ProviderRegistry';

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
    return startProviderStream({ providerApi: PROVIDER_API, model, options }, async (run) => {
      const response = await this.send(model, context, options, run.signal);
      return consumeGoogleInteractionsStream(response, run, options);
    });
  }

  private async send(model: Model, context: Context, options: StreamOptions, signal: AbortSignal): Promise<Response> {
    const baseUrl = (options.baseUrl ?? this.defaultBaseUrl).replace(/\/+$/u, '');
    const apiKey = options.apiKey ?? this.defaultApiKey;
    if (!apiKey) {
      throw new ProviderHttpError(PROVIDER_API, 401, 'missing apiKey for Google Interactions provider');
    }
    const body = applyRequestPlanBody(
      buildGoogleInteractionsRequest(model, context, options),
      options.requestPlan,
    );
    return sendProviderRequest(PROVIDER_API, options.requestPlan, signal, {
      url: buildGoogleInteractionsUrl(baseUrl),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'x-goog-api-key': apiKey,
        ...this.defaultHeaders,
        ...requestPlanHeaders(options.requestPlan),
      },
      body,
    });
  }
}

/** Interaction events are validated field by field in the stream state, so a frame only has to be a JSON object. */
async function consumeGoogleInteractionsStream(
  response: Response,
  { builder, signal }: ProviderStreamRun,
  options: StreamOptions,
): Promise<{ sawOutput: boolean }> {
  const state = new GoogleInteractionsStreamState(builder, options.requestPlan);
  for await (const data of parseSSE(response, signal, { providerApi: PROVIDER_API, ...options })) {
    if (signal.aborted) break;
    const event = parseEvent(data);
    if (!event) {
      throw new ProviderStreamProtocolError(
        'PROVIDER_STREAM_MALFORMED_FRAME',
        { protocol: PROVIDER_API, providerBlockKey: 'frame', contentIndex: 0 },
        'Google Interactions sent a stream frame that is not a valid event.',
      );
    }
    state.handle(event);
  }
  const outcome = state.outcome();
  if (outcome.terminalSeen) builder.markTerminal(outcome.finishReason);
  return { sawOutput: outcome.sawOutput };
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
