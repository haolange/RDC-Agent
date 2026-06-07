/**
 * Provider 内部共用工具：SSE / NDJSON 解析、HTTP 错误归一化。
 *
 * 仅供 `src/main/agent-runtime/providers/**` 内部消费，
 * 不对外导出（`providers/index.ts` 不 re-export）。
 */

/**
 * 解析 SSE (Server-Sent Events) 流，按行 yield `data:` 后的 payload。
 *
 * - 自动剥离 `data: ` 前缀；
 * - 收到 `[DONE]` 立即结束；
 * - 支持 `signal.aborted` 中途退出；
 * - 多行（事件块）形式不在此处解析，仅做按行流式拆分。
 */
export async function* parseSSE(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  if (!response.body) {
    throw new Error('parseSSE: response.body is null');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        break;
      }
      const { done, value } = await reader.read();
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
      /* ignore: stream already cancelled */
    }
  }
}

/**
 * 解析 NDJSON / JSON-lines 流（如 Ollama），按行 yield 每个 JSON 字符串。
 *
 * 仅做行拆分，不做 JSON parse；调用方再行解析以捕获单行错误。
 */
export async function* parseJsonLines(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  if (!response.body) {
    throw new Error('parseJsonLines: response.body is null');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        break;
      }
      const { done, value } = await reader.read();
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
      /* ignore */
    }
  }
}

/**
 * Provider 网络 / API 错误的统一类型。
 *
 * 上层可以根据 `status` 识别 401/429/5xx 等情况，
 * 而不需要再对 fetch 的原始 Response 做 ad-hoc 判断。
 */
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

/** 把非 2xx 响应转换为 `ProviderHttpError`，尽量带上响应体片段。 */
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

/** 当前时间戳（毫秒），独立函数便于测试时打桩。 */
export function nowMs(): number {
  return Date.now();
}

export interface ComposedSignal {
  signal: AbortSignal;
  dispose: () => void;
}

/**
 * 将外部 signal 与内部 stream signal 合成为单一 signal。
 *
 * 任意一方触发 abort 都会让合成 signal 立即 abort，
 * 便于把 stream.signal 与 options.signal 同时透传给 fetch。
 */
export function composeAbortSignals(
  external: AbortSignal | undefined,
  internal: AbortSignal,
): ComposedSignal {
  const controller = new AbortController();
  const onAbort = (reason: unknown): void => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };

  if (internal.aborted) {
    onAbort(internal.reason);
  } else {
    internal.addEventListener('abort', () => onAbort(internal.reason), { once: true });
  }

  if (external) {
    if (external.aborted) {
      onAbort(external.reason);
    } else {
      external.addEventListener('abort', () => onAbort(external.reason), { once: true });
    }
  }

  return {
    signal: controller.signal,
    dispose: () => {
      // listeners are { once: true }; nothing to clean up.
    },
  };
}

/** 标准化任意 thrown value 为 Error。 */
export function normalizeError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(String(err));
}
