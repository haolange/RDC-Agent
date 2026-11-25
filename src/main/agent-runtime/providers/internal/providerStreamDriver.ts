import { EventStream } from '../../core/EventStream';
import { recordQuotaFromResponse } from '../../../settings/provider-catalog/ProviderQuota';
import { AssistantStreamBuilder, parseProviderFrame } from './AssistantStreamBuilder';
import { composeAbortSignals, ensureOk, normalizeError, parseJsonLines, parseSSE } from './http';
import type { ZodType } from 'zod';
import type { ProviderRequestAuthorizer } from '../../../settings/provider-auth/AwsBedrockCredentials';
import type { RequestPlan } from '@shared/types/providerCapability';
import type { AssistantMessage, AssistantMessageEvent, Model, StopReason, StreamOptions } from '../../core/types';

/** What one running request owns: the builder its frames feed and the signal that aborts it. */
export interface ProviderStreamRun {
  builder: AssistantStreamBuilder;
  signal: AbortSignal;
}

/** How a failed request ends the message: the error the stream rejects with and the stop reason it records. */
export interface ProviderStreamFailure {
  error: Error;
  reason: StopReason;
}

export interface ProviderStreamRequest {
  providerApi: string;
  model: Model;
  options: StreamOptions;
  /** How a thrown error ends the message; HTTP adapters use `httpStreamFailure`. */
  failure?: (thrown: unknown, signal: AbortSignal) => ProviderStreamFailure;
}

/**
 * The failure of a request the adapter sends itself: an abort reports why the signal fired, so a timeout stays a
 * timeout; any other error is reported as thrown.
 */
export function httpStreamFailure(thrown: unknown, signal: AbortSignal): ProviderStreamFailure {
  const normalized = normalizeError(thrown);
  const error = normalized.name === 'AbortError' && signal.reason instanceof Error ? signal.reason : normalized;
  return { error, reason: error.name === 'AbortError' ? 'aborted' : 'error' };
}

/**
 * Starts one provider stream. The driver owns the event stream, the builder, the composed abort signal and the
 * termination contract: `run` sends the request and feeds the builder, then the driver finishes the message, which
 * completes only after the wire's own terminal signal, or fails it.
 */
export function startProviderStream(
  request: ProviderStreamRequest,
  run: (stream: ProviderStreamRun) => Promise<{ sawOutput: boolean }>,
): EventStream<AssistantMessageEvent, AssistantMessage> {
  const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
    (event) => event.type === 'done',
    (event) => (event as Extract<AssistantMessageEvent, { type: 'done' }>).message,
  );
  const builder = new AssistantStreamBuilder(stream, request.model.id, request.model.provider);
  void driveProviderStream(stream, builder, request, run);
  return stream;
}

async function driveProviderStream(
  stream: EventStream<AssistantMessageEvent, AssistantMessage>,
  builder: AssistantStreamBuilder,
  request: ProviderStreamRequest,
  run: (stream: ProviderStreamRun) => Promise<{ sawOutput: boolean }>,
): Promise<void> {
  const { providerApi, options } = request;
  const composed = composeAbortSignals(options.signal, stream.signal, { providerApi, ...options });
  try {
    builder.start();
    const { sawOutput } = await run({ builder, signal: composed.signal });
    builder.finish({ signal: composed.signal, sawOutput, providerApi });
  } catch (thrown) {
    const failure = (request.failure ?? httpStreamFailure)(thrown, composed.signal);
    builder.fail(failure.error, failure.reason);
  } finally {
    composed.dispose();
  }
}

/** One POST to a provider. The body is sent as JSON text; a signing route signs that exact text. */
export interface ProviderHttpRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  /** Body-aware authorization, used by transports such as AWS SigV4. */
  authorizer?: ProviderRequestAuthorizer;
}

/** Sends the request and returns its response once the status is OK; a rate-limit reply records the quota it reports. */
export async function sendProviderRequest(
  providerApi: string,
  requestPlan: RequestPlan,
  signal: AbortSignal,
  request: ProviderHttpRequest,
): Promise<Response> {
  const bodyText = JSON.stringify(request.body);
  const headers = request.authorizer
    ? await request.authorizer({ url: request.url, method: 'POST', headers: request.headers, body: bodyText })
    : request.headers;
  const response = await fetch(request.url, { method: 'POST', headers, body: bodyText, signal });
  recordQuotaFromResponse(requestPlan, response);
  await ensureOk(response, providerApi);
  return response;
}

/** How a wire frames its stream body and what one frame of it looks like. */
export interface ProviderFrameStream<Frame> {
  providerApi: string;
  framing: 'sse' | 'json-lines';
  frameSchema: ZodType<Frame>;
}

/**
 * Yields the response's frames, each parsed against the wire's frame schema: a frame that is not JSON, or not a frame
 * of the protocol, fails the stream. An aborted read stops yielding and leaves reporting the abort to the driver.
 * `onDoneSentinel` receives the Chat Completions `[DONE]` sentinel, that protocol's own terminal signal.
 */
export async function* readProviderFrames<Frame>(
  response: Response,
  signal: AbortSignal,
  options: StreamOptions,
  wire: ProviderFrameStream<Frame>,
  onDoneSentinel?: () => void,
): AsyncGenerator<Frame> {
  const readOptions = { providerApi: wire.providerApi, ...options, ...(onDoneSentinel ? { onDoneSentinel } : {}) };
  const frames = wire.framing === 'sse'
    ? parseSSE(response, signal, readOptions)
    : parseJsonLines(response, signal, readOptions);
  for await (const data of frames) {
    if (signal.aborted) return;
    yield parseProviderFrame(data, wire.providerApi, wire.frameSchema);
  }
}
