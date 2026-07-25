/**
 * Reusable IPC payload validation middleware (Zod + size / count / length limits).
 * Prefer wiring sensitive channels first; remaining handlers can adopt the same helper later.
 */
import { z, type ZodTypeAny } from 'zod';

export class IpcValidationError extends Error {
  readonly code = 'IPC_VALIDATION_ERROR' as const;

  constructor(message: string) {
    super(message);
    this.name = 'IpcValidationError';
  }
}

export interface ParseIpcArgsOptions {
  /** Max JSON-serialized byte length of the args array. Default 256 KiB. */
  maxBytes?: number;
  label?: string;
  /** Pad args with undefined up to this length (for optional trailing IPC parameters). */
  padTo?: number;
}

const DEFAULT_MAX_BYTES = 256 * 1024;

export function assertIpcPayloadBytes(value: unknown, maxBytes: number, label = 'IPC payload'): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? 'null';
  } catch {
    throw new IpcValidationError(`${label} is not JSON-serializable.`);
  }
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > maxBytes) {
    throw new IpcValidationError(`${label} exceeds ${maxBytes} bytes (got ${bytes}).`);
  }
}

export function parseIpcArgs<T extends ZodTypeAny>(
  schema: T,
  args: unknown[],
  options: ParseIpcArgsOptions = {},
): z.infer<T> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const label = options.label ?? 'IPC args';
  const padded = typeof options.padTo === 'number' ? padIpcArgs(args, options.padTo) : args;
  assertIpcPayloadBytes(padded, maxBytes, label);
  const result = schema.safeParse(padded);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new IpcValidationError(`${label} schema violation: ${detail}`);
  }
  return result.data;
}

/** Pad trailing optional IPC args with undefined so Zod optional tuple slots accept arity-0 calls. */
export function padIpcArgs(args: unknown[], length: number): unknown[] {
  const next = args.slice(0, length);
  while (next.length < length) next.push(undefined);
  return next;
}

/** Bound string helpers for IPC schemas. */
export function ipcString(maxLength: number, label = 'string'): z.ZodString {
  return z.string().max(maxLength, `${label} exceeds ${maxLength} characters`);
}

export function ipcNonEmptyString(maxLength: number, label = 'string'): z.ZodString {
  return ipcString(maxLength, label).min(1, `${label} is required`);
}

/** Opaque id: alphanumeric + common separators, fail-closed on path traversal chars. */
export function ipcId(maxLength = 128, label = 'id'): z.ZodString {
  return ipcNonEmptyString(maxLength, label).regex(
    /^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/,
    `${label} has invalid format`,
  );
}

export function ipcStringArray(maxItems: number, maxItemLength: number, label = 'array'): z.ZodArray<z.ZodString> {
  return z
    .array(ipcString(maxItemLength, `${label} item`))
    .max(maxItems, `${label} exceeds ${maxItems} items`);
}
