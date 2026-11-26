import { errorCategory, isErrorCode, type ErrorCategory, type ErrorCode } from './errorCodes';

export type ErrorParams = Record<string, string | number>;

/**
 * What a failed IPC call carries back to the renderer: a registered code, its parameters, its failure class, and the
 * redacted technical message kept for "copy details". The renderer never shows `technical` as the message itself.
 */
export interface IpcErrorPayload {
  code: ErrorCode;
  params: ErrorParams;
  category: ErrorCategory;
  technical?: string;
}

export const IPC_ERROR_KEY = '__rdcIpcError' as const;

/** The value `invokeRegistry` returns for a failed call; success values are returned unwrapped. */
export interface IpcErrorResult {
  [IPC_ERROR_KEY]: IpcErrorPayload;
}

export interface AppErrorOptions {
  params?: ErrorParams;
  cause?: unknown;
}

/**
 * The one error type that crosses a boundary. The message keeps the `CODE: detail` form, so logs, tool results and
 * diagnostics read the same as before; callers branch on `code`, never on the message text.
 */
export class AppError extends Error {
  readonly params: ErrorParams;

  constructor(
    readonly code: ErrorCode,
    detail?: string,
    options: AppErrorOptions = {},
  ) {
    super(detail ? `${code}: ${detail}` : code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.params = options.params ?? {};
  }

  get category(): ErrorCategory {
    return errorCategory(this.code);
  }
}

/** The registered code a failure carries: from `AppError`, `RendererIpcError`, or a coded message (`CODE: detail`). */
export function errorCodeOf(error: unknown): ErrorCode | undefined {
  if (error instanceof AppError || error instanceof RendererIpcError) return error.code;
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : undefined;
  const code = message === undefined ? undefined : /^([A-Z][A-Z0-9_]{2,})(?::|$)/.exec(message)?.[1];
  return code && isErrorCode(code) ? code : undefined;
}

/** Maps any thrown value to the IPC payload; anything without a registered code is an `INTERNAL_ERROR`. */
export function toIpcErrorPayload(error: unknown, redact: (text: string) => string): IpcErrorPayload {
  const code = errorCodeOf(error) ?? 'INTERNAL_ERROR';
  const technical = redact(error instanceof Error ? error.message : String(error));
  return {
    code,
    params: error instanceof AppError ? error.params : {},
    category: errorCategory(code),
    ...(technical ? { technical } : {}),
  };
}

export function isIpcErrorResult(value: unknown): value is IpcErrorResult {
  return typeof value === 'object' && value !== null && IPC_ERROR_KEY in value;
}

/** A failed IPC call as the renderer sees it; built from the payload on the renderer side of the bridge. */
export class RendererIpcError extends Error {
  readonly code: ErrorCode;
  readonly params: ErrorParams;
  readonly category: ErrorCategory;
  readonly technical?: string;

  constructor(
    readonly channel: string,
    payload: IpcErrorPayload,
  ) {
    super(payload.technical ?? payload.code);
    this.name = 'RendererIpcError';
    this.code = payload.code;
    this.params = payload.params;
    this.category = payload.category;
    if (payload.technical) this.technical = payload.technical;
  }
}
