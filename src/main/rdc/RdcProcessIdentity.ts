import { z } from 'zod';
import { AppError } from '@shared/errors/appError';

const processBirth = z.object({
  pid: z.number().int().positive().safe(),
  start_generation: z.string().regex(/^(?:windows-filetime:[1-9]\d*|linux-start-ticks:[a-f0-9-]{36}:[1-9]\d*)$/),
}).strict();
export const RdcProcessIdentitySchema = z.object({
  status: z.literal('available'), daemon: processBirth, worker: processBirth,
}).strict().refine(value => value.daemon.pid !== value.worker.pid);

export type RdcProcessIdentity = z.infer<typeof RdcProcessIdentitySchema>;
export function parseRdcProcessIdentity(value: unknown): RdcProcessIdentity {
  const parsed = RdcProcessIdentitySchema.safeParse(value);
  if (!parsed.success) throw new AppError('RDC_PROCESS_IDENTITY_REQUIRED', 'live daemon/worker process birth is unavailable or invalid.');
  return parsed.data;
}
