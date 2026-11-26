import { AppError } from '@shared/errors/appError';
export type ProviderTimeoutPhase = 'first-byte' | 'idle';

export interface ProviderStreamReadOptions {
  providerApi: string;
  /** Max incomplete-line buffer bytes before fail-closed. Default 8 MiB. */
  maxBufferBytes?: number;
  /** Called when the Chat Completions `[DONE]` sentinel arrives; the protocol's own terminal signal. */
  onDoneSentinel?: () => void;
}

export const DEFAULT_PROVIDER_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export class ProviderStreamBufferError extends AppError {
  readonly providerApi: string;
  readonly maxBufferBytes: number;

  constructor(providerApi: string, maxBufferBytes: number) {
    super(
      'PROVIDER_STREAM_BUFFER_EXCEEDED',
      `[${providerApi}] provider stream buffer exceeded ${maxBufferBytes} bytes`,
    );
    this.name = 'ProviderStreamBufferError';
    this.providerApi = providerApi;
    this.maxBufferBytes = maxBufferBytes;
  }
}

export class ProviderTimeoutError extends AppError {
  readonly phase: ProviderTimeoutPhase;
  readonly timeoutMs: number;
  readonly providerApi: string;
  /** Whether the stream had already produced model output (text, thinking or a tool call) when the timer fired. */
  readonly afterContent: boolean;

  constructor(providerApi: string, phase: ProviderTimeoutPhase, timeoutMs: number, afterContent = false) {
    super('PROVIDER_TIMEOUT', `[${providerApi}] provider stream ${phase} timeout after ${timeoutMs}ms`);
    this.name = 'ProviderTimeoutError';
    this.providerApi = providerApi;
    this.phase = phase;
    this.timeoutMs = timeoutMs;
    this.afterContent = afterContent;
  }
}

export class ProviderHttpError extends AppError {
  readonly status: number;
  readonly providerApi: string;
  readonly bodyText?: string;
  /** How long the provider asked the client to wait before retrying (`retry-after-ms` / `Retry-After`). */
  readonly retryAfterMs?: number;

  constructor(providerApi: string, status: number, message: string, bodyText?: string, retryAfterMs?: number) {
    super('PROVIDER_HTTP_ERROR', `[${providerApi}] HTTP ${status}: ${message}`);
    this.name = 'ProviderHttpError';
    this.providerApi = providerApi;
    this.status = status;
    this.bodyText = bodyText;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Reads the provider's requested retry delay from `retry-after-ms`, or `Retry-After` in seconds or as an HTTP date. */
export function parseRetryAfterMs(headers: { get(name: string): string | null }, now = Date.now()): number | undefined {
  const milliseconds = headers.get('retry-after-ms')?.trim();
  if (milliseconds && /^\d+(?:\.\d+)?$/u.test(milliseconds)) return Number(milliseconds);
  const value = headers.get('retry-after')?.trim();
  if (!value) return undefined;
  if (/^\d+(?:\.\d+)?$/u.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

export const PROVIDER_EMPTY_STREAM_MESSAGE = 'Provider stream ended without assistant output or structured tool call.';

export class ProviderEmptyStreamError extends AppError {
  declare readonly code: 'PROVIDER_STREAM_EMPTY';
  readonly providerApi: string;

  constructor(providerApi: string, message = PROVIDER_EMPTY_STREAM_MESSAGE) {
    super('PROVIDER_STREAM_EMPTY', message);
    this.name = 'ProviderEmptyStreamError';
    this.providerApi = providerApi;
  }
}

export class ProviderWireFailureError extends AppError {
  readonly providerApi: string;
  readonly wireCode?: string;
  readonly bodyText?: string;

  constructor(providerApi: string, message: string, options?: { code?: string; bodyText?: string }) {
    super('PROVIDER_WIRE_FAILURE', `[${providerApi}] ${message}`);
    this.name = 'ProviderWireFailureError';
    this.providerApi = providerApi;
    this.wireCode = options?.code;
    this.bodyText = options?.bodyText;
  }
}

export function isProviderWireFailureError(error: unknown): error is ProviderWireFailureError {
  return error instanceof ProviderWireFailureError;
}

export function isProviderEmptyStreamError(error: unknown): error is ProviderEmptyStreamError {
  if (error instanceof ProviderEmptyStreamError) {
    return true;
  }
  return (
    error instanceof Error &&
    error.name === 'ProviderEmptyStreamError' &&
    (error as { code?: unknown }).code === 'PROVIDER_STREAM_EMPTY'
  );
}

export interface ComposedSignal {
  signal: AbortSignal;
  /** Aborts the composed signal with `reason`; a no-op once it has aborted. */
  abort: (reason: unknown) => void;
  dispose: () => void;
}

const streamActivity = new WeakMap<AbortSignal, () => void>();

/** Lets the stream readers report received bytes on `signal` to the watchdog that bounds that stream. */
export function registerStreamActivity(signal: AbortSignal, touch: () => void): void {
  streamActivity.set(signal, touch);
}

/** Reports that a chunk arrived on the stream guarded through `signal`; a no-op for an unguarded signal. */
export function touchStreamWatchdog(signal: AbortSignal | undefined): void {
  if (signal) streamActivity.get(signal)?.();
}

export interface SseRecord {
  event: string | null;
  data: string;
}

export async function* parseSSE(
  response: Response,
  signal: AbortSignal | undefined,
  options: ProviderStreamReadOptions,
): AsyncGenerator<string> {
  for await (const record of parseSSERecords(response, signal, options)) yield record.data;
}

export async function* parseSSERecords(
  response: Response,
  signal: AbortSignal | undefined,
  options: ProviderStreamReadOptions,
): AsyncGenerator<SseRecord> {
  if (!response.body) {
    throw new Error('parseSSE: response.body is null');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_PROVIDER_MAX_BUFFER_BYTES;
  let buffer = '';
  let eventName: string | null = null;

  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await readAbortable(reader, signal);
      touchStreamWatchdog(signal);
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      if (Buffer.byteLength(buffer, 'utf8') > maxBufferBytes) {
        const error = new ProviderStreamBufferError(options.providerApi, maxBufferBytes);
        void reader.cancel(error).catch(() => undefined);
        throw error;
      }
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');
        if (line.startsWith('event:')) {
          eventName = line.slice('event:'.length).trim();
          continue;
        }
        if (line.length === 0) {
          eventName = null;
          continue;
        }
        if (!line.startsWith('data:')) {
          continue;
        }
        const data = line.slice(5).trimStart();
        if (data === '[DONE]') {
          options.onDoneSentinel?.();
          return;
        }
        if (data.length === 0) {
          continue;
        }
        yield { event: eventName, data };
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore: stream already closed or cancelled
    }
  }
}

export async function* parseJsonLines(
  response: Response,
  signal: AbortSignal | undefined,
  options: ProviderStreamReadOptions,
): AsyncGenerator<string> {
  if (!response.body) {
    throw new Error('parseJsonLines: response.body is null');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_PROVIDER_MAX_BUFFER_BYTES;
  let buffer = '';

  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await readAbortable(reader, signal);
      touchStreamWatchdog(signal);
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      if (Buffer.byteLength(buffer, 'utf8') > maxBufferBytes) {
        const error = new ProviderStreamBufferError(options.providerApi, maxBufferBytes);
        void reader.cancel(error).catch(() => undefined);
        throw error;
      }
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }
        yield line;
      }
    }
    const tail = buffer.trim();
    if (tail) {
      yield tail;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore: stream already closed or cancelled
    }
  }
}

export async function ensureOk(response: Response, providerApi: string): Promise<void> {
  if (response.ok) {
    return;
  }
  let bodyText: string | undefined;
  try {
    bodyText = await response.text();
  } catch {
    bodyText = undefined;
  }
  const looksLikeHtml = Boolean(bodyText && /(?:<!doctype\s+html|<html\b)/i.test(bodyText));
  const htmlTitle = looksLikeHtml ? bodyText?.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] : undefined;
  const snippet = looksLikeHtml
    ? htmlTitle
        ?.replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() ||
      response.statusText ||
      'HTML error response'
    : bodyText
      ? bodyText.slice(0, 500)
      : response.statusText || 'request failed';
  throw new ProviderHttpError(providerApi, response.status, snippet, bodyText, parseRetryAfterMs(response.headers));
}

export function nowMs(): number {
  return Date.now();
}

export function composeAbortSignals(external: AbortSignal | undefined, internal: AbortSignal): ComposedSignal {
  const controller = new AbortController();
  const onAbort = (reason: unknown): void => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };

  const internalAbort = (): void => onAbort(internal.reason);
  const externalAbort = (): void => onAbort(external?.reason);

  if (internal.aborted) {
    onAbort(internal.reason);
  } else {
    internal.addEventListener('abort', internalAbort, { once: true });
  }

  if (external) {
    if (external.aborted) {
      onAbort(external.reason);
    } else {
      external.addEventListener('abort', externalAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    abort: onAbort,
    dispose: () => {
      internal.removeEventListener('abort', internalAbort);
      external?.removeEventListener('abort', externalAbort);
    },
  };
}

export function normalizeError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(String(err));
}

function readWireRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readWireString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readHttpLikeStatus(record: Record<string, unknown> | null): number | undefined {
  if (!record) {
    return undefined;
  }
  for (const key of ['status', 'status_code'] as const) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 400 && value <= 599) {
      return value;
    }
  }
  return undefined;
}

function serializeWireErrorBody(record: Record<string, unknown> | null): string | undefined {
  if (!record) {
    return undefined;
  }
  try {
    return JSON.stringify(record).slice(0, 500);
  } catch {
    return undefined;
  }
}

/** Responses SSE `error` / `response.failed` — preserve provider message; only synthesize HTTP when status is explicit. */
export function createResponsesStreamFailure(
  providerApi: string,
  params: {
    error?: Record<string, unknown> | null;
    event?: Record<string, unknown> | null;
    fallbackMessage: string;
  },
): ProviderHttpError | ProviderWireFailureError {
  const errorRecord = readWireRecord(params.error);
  const eventRecord = readWireRecord(params.event);
  const source = errorRecord ?? eventRecord;
  const message = readWireString(source?.message) || params.fallbackMessage;
  const status = readHttpLikeStatus(errorRecord) ?? readHttpLikeStatus(eventRecord);
  const wireCode = readWireString(source?.code) || undefined;
  const bodyText = serializeWireErrorBody(source);

  if (status !== undefined) {
    return new ProviderHttpError(providerApi, status, message, bodyText);
  }
  return new ProviderWireFailureError(providerApi, message, { code: wireCode, bodyText });
}

/** One read that rejects with the signal's reason as soon as it aborts; the stream watchdog is what bounds waiting. */
function readAbortable(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) return reader.read();
  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    const onAbort = (): void => {
      void reader.cancel(signal.reason).catch(() => undefined);
      reject(abortErrorFromSignal(signal));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    reader.read().then(
      (result) => {
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortErrorFromSignal(signal);
  }
}

function abortErrorFromSignal(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }
  const abortErr = new Error('Provider request aborted');
  abortErr.name = 'AbortError';
  return abortErr;
}
