export type ProviderTimeoutPhase = 'first-byte' | 'idle' | 'total';

export interface ProviderStreamTimeoutOptions {
  firstChunkTimeoutMs?: number;
  streamIdleTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export interface ProviderStreamReadOptions extends ProviderStreamTimeoutOptions {
  providerApi: string;
}

export const DEFAULT_PROVIDER_FIRST_CHUNK_TIMEOUT_MS = 20_000;
export const DEFAULT_PROVIDER_STREAM_IDLE_TIMEOUT_MS = 60_000;
export const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 300_000;

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
  const snippet = bodyText ? bodyText.slice(0, 500) : response.statusText || 'request failed';
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
