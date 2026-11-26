import { z } from 'zod';
import { AppError } from '@shared/errors/appError';

const processBirth = z
  .object({
    pid: z.number().int().positive().safe(),
    start_generation: z.string().regex(/^(?:windows-filetime:[1-9]\d*|linux-start-ticks:[a-f0-9-]{36}:[1-9]\d*)$/),
  })
  .strict();
export const RdcProcessIdentitySchema = z
  .object({
    status: z.literal('available'),
    daemon: processBirth,
    worker: processBirth,
  })
  .strict()
  .refine((value) => value.daemon.pid !== value.worker.pid);

export type RdcProcessIdentity = z.infer<typeof RdcProcessIdentitySchema>;
export function parseRdcProcessIdentity(value: unknown): RdcProcessIdentity {
  const parsed = RdcProcessIdentitySchema.safeParse(value);
  if (!parsed.success)
    throw new AppError('RDC_PROCESS_IDENTITY_REQUIRED', 'live daemon/worker process birth is unavailable or invalid.');
  return parsed.data;
}

/** Bounded: one entry per recently used daemon context (each opened replay gets a fresh context id). */
const MAX_OBSERVED_CONTEXTS = 64;
const observedByContext = new Map<string, RdcProcessIdentity>();

/**
 * Remember the process identity a successful canonical result reported for its daemon context. Every successful RDC
 * result passes through `parseRdcNativeResult`, so this is the latest daemon/worker the app saw complete work there.
 */
export function noteRdcProcessIdentity(contextId: string, value: unknown): void {
  const parsed = RdcProcessIdentitySchema.safeParse(value);
  if (!parsed.success) return;
  observedByContext.delete(contextId);
  observedByContext.set(contextId, parsed.data);
  if (observedByContext.size > MAX_OBSERVED_CONTEXTS) observedByContext.delete(observedByContext.keys().next().value!);
}

export function observedRdcProcessIdentity(contextId: string): RdcProcessIdentity | null {
  const value = observedByContext.get(contextId);
  return value ? structuredClone(value) : null;
}
