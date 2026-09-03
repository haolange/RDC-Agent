export type ProviderTimeoutPhase = 'first-byte' | 'idle' | 'total';

export interface ProviderStreamTimeoutOptions {
  firstChunkTimeoutMs?: number;
  streamIdleTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export interface ProviderStreamReadOptions extends ProviderStreamTimeoutOptions {
  providerApi: string;
  /** Max incomplete-line buffer bytes before fail-closed. Default 8 MiB. */
  maxBufferBytes?: number;
}

export const DEFAULT_PROVIDER_FIRST_CHUNK_TIMEOUT_MS = 20_000;
export const DEFAULT_PROVIDER_STREAM_IDLE_TIMEOUT_MS = 60_000;
export const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 300_000;
export const DEFAULT_PROVIDER_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export class ProviderStreamBufferError extends Error {
  readonly providerApi: string;
  readonly maxBufferBytes: number;

  constructor(providerApi: string, maxBufferBytes: number) {
    super(`[${providerApi}] provider stream buffer exceeded ${maxBufferBytes} bytes`);
    this.name = 'ProviderStreamBufferError';
    this.providerApi = providerApi;
    this.maxBufferBytes = maxBufferBytes;
  }
}

interface ResolvedProviderTimeouts {
  firstChunkTimeoutMs: number;
  streamIdleTimeoutMs: number;
  requestTimeoutMs: number;
}

export class ProviderTimeoutError extends Error {
  readonly phase: ProviderTimeoutPhase;
  readonly timeoutMs: number;
  readonly providerApi: string;

  constructor(providerApi: string, phase: ProviderTimeoutPhase, timeoutMs: number) {
    super(`[${providerApi}] provider stream ${phase} timeout after ${timeoutMs}ms`);
    this.name = 'ProviderTimeoutError';
    this.providerApi = providerApi;
    this.phase = phase;
    this.timeoutMs = timeoutMs;
  }
}

export class ProviderHttpError extends Error {
  readonly status: number;
  readonly providerApi: string;
  readonly bodyText?: string;

  constructor(providerApi: string, status: number, message: string, bodyText?: string) {
    super(`[${providerApi}] HTTP ${status}: ${message}`);
    this.name = 'ProviderHttpError';
    this.providerApi = providerApi;
    this.status = status;
    this.bodyText = bodyText;
  }
}

export const PROVIDER_EMPTY_STREAM_MESSAGE =
  'Provider stream ended without assistant output or structured tool call.';

export class ProviderEmptyStreamError extends Error {
  readonly code = 'PROVIDER_STREAM_EMPTY' as const;
  readonly providerApi: string;

  constructor(providerApi: string, message = PROVIDER_EMPTY_STREAM_MESSAGE) {
    super(message);
    this.name = 'ProviderEmptyStreamError';
    this.providerApi = providerApi;
  }
}

export class ProviderWireFailureError extends Error {
  readonly providerApi: string;
  readonly wireCode?: string;
  readonly bodyText?: string;

  constructor(
    providerApi: string,
    message: string,
    options?: { code?: string; bodyText?: string },
  ) {
    super(`[${providerApi}] ${message}`);
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
  return error instanceof Error
    && error.name === 'ProviderEmptyStreamError'
    && (error as { code?: unknown }).code === 'PROVIDER_STREAM_EMPTY';
}

export interface ComposedSignal {
  signal: AbortSignal;
  dispose: () => void;
}

export function resolveProviderTimeouts(options: ProviderStreamTimeoutOptions = {}): ResolvedProviderTimeouts {
  return {
    firstChunkTimeoutMs: options.firstChunkTimeoutMs ?? DEFAULT_PROVIDER_FIRST_CHUNK_TIMEOUT_MS,
    streamIdleTimeoutMs: options.streamIdleTimeoutMs ?? DEFAULT_PROVIDER_STREAM_IDLE_TIMEOUT_MS,
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  };
}

export async function* parseSSE(
  response: Response,
  signal: AbortSignal | undefined,
  options: ProviderStreamReadOptions,
): AsyncGenerator<string> {
  if (!response.body) {
    throw new Error('parseSSE: response.body is null');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const timeouts = resolveProviderTimeouts(options);
  const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_PROVIDER_MAX_BUFFER_BYTES;
  let buffer = '';
  let hasReadChunk = false;

  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await readWithTimeout(
        reader,
        signal,
        options.providerApi,
        hasReadChunk ? 'idle' : 'first-byte',
        hasReadChunk ? timeouts.streamIdleTimeoutMs : timeouts.firstChunkTimeoutMs,
      );
      hasReadChunk = true;
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
        if (!line.startsWith('data:')) {
          continue;
        }
        const data = line.slice(5).trimStart();
        if (data === '[DONE]') {
          return;
        }
        if (data.length === 0) {
          continue;
        }
        yield data;
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
  const timeouts = resolveProviderTimeouts(options);
  const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_PROVIDER_MAX_BUFFER_BYTES;
  let buffer = '';
  let hasReadChunk = false;

  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await readWithTimeout(
        reader,
        signal,
        options.providerApi,
        hasReadChunk ? 'idle' : 'first-byte',
        hasReadChunk ? timeouts.streamIdleTimeoutMs : timeouts.firstChunkTimeoutMs,
      );
      hasReadChunk = true;
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
    ? (htmlTitle?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      || response.statusText
      || 'HTML error response')
    : bodyText ? bodyText.slice(0, 500) : response.statusText || 'request failed';
  throw new ProviderHttpError(providerApi, response.status, snippet, bodyText);
}

export function nowMs(): number {
  return Date.now();
}

export function composeAbortSignals(
  external: AbortSignal | undefined,
  internal: AbortSignal,
  timeoutOptions: (ProviderStreamTimeoutOptions & { providerApi: string }) | undefined = undefined,
): ComposedSignal {
  const controller = new AbortController();
  const providerApi = timeoutOptions?.providerApi ?? 'provider';
  const requestTimeoutMs = resolveProviderTimeouts(timeoutOptions).requestTimeoutMs;
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

  const timeoutId = Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0
    ? setTimeout(() => onAbort(new ProviderTimeoutError(providerApi, 'total', requestTimeoutMs)), requestTimeoutMs)
    : null;

  return {
    signal: controller.signal,
    dispose: () => {
      internal.removeEventListener('abort', internalAbort);
      external?.removeEventListener('abort', externalAbort);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    },
  };
}

export function normalizeError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(String(err));
}

function readWireRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
  providerApi: string,
  phase: ProviderTimeoutPhase,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return reader.read();
  }

  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      signal?.removeEventListener('abort', onAbort);
    };

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const onAbort = (): void => {
      finish(() => reject(abortErrorFromSignal(signal)));
    };

    if (signal?.aborted) {
      reject(abortErrorFromSignal(signal));
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });
    timeoutId = setTimeout(() => {
      const error = new ProviderTimeoutError(providerApi, phase, timeoutMs);
      void reader.cancel(error).catch(() => undefined);
      finish(() => reject(error));
    }, timeoutMs);

    reader.read()
      .then((result) => finish(() => resolve(result)))
      .catch((error) => finish(() => reject(error)));
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
