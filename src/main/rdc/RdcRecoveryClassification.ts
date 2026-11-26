import { z } from 'zod';
import type { RdcContextStatus } from './RdcContextStatus';
import type { RdcProcessIdentity } from './RdcProcessIdentity';

const exitedWorker = z.strictObject({
  pid: z.number().int().positive(),
  start_generation: z.string().min(1),
  reason: z.string(),
  traceId: z.string(),
  requestId: z.string(),
  stackLogPath: z.string(),
});
/** The admission decision every recovery entry takes, signed into the recovery intent it governs. */
export const RdcRecoveryClassificationSchema = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('keep'), reason: z.literal('verified-processes-live') }),
  z.strictObject({
    decision: z.literal('rebuild'),
    reason: z.enum(['worker-exited', 'replay-requires-restart']),
    /** Workers that served the verified lineage and whose exit RDC-Tool confirmed, oldest first. */
    lost: z.strictObject({ workers: z.array(exitedWorker) }),
  }),
  z.strictObject({
    decision: z.literal('quarantined'),
    code: z.enum([
      'RDC_RECOVERY_PROCESS_UNEXPLAINED',
      'RDC_RECOVERY_BUDGET_EXHAUSTED',
      'RDC_DEVICE_ACTION_UNCONFIRMED',
    ]),
    reason: z.string().min(1),
  }),
]);
export type RdcRecoveryClassification = z.infer<typeof RdcRecoveryClassificationSchema>;
type ExitedWorker = z.infer<typeof exitedWorker>;
type Birth = { pid: number; start_generation: string };

/** Recovery attempts allowed per approved input, content and device, counted from signed receipts across turns. */
export const RDC_RECOVERY_ATTEMPT_LIMIT = 2;

const same = (left: Birth, right: Birth) => left.pid === right.pid && left.start_generation === right.start_generation;
const unexplained = (reason: string): RdcRecoveryClassification => ({
  decision: 'quarantined',
  code: 'RDC_RECOVERY_PROCESS_UNEXPLAINED',
  reason,
});

/**
 * The identity chain from the last verified daemon/worker to what the read-only context status reports now.
 *
 * - keep: the verified daemon and worker are alive and the replay session is live without `requires_restart`.
 * - rebuild: the verified daemon is alive, and every worker change since the verified worker is explained by an exit
 *   receipt (a `worker_lifecycle` exit with `exit_confirmed`, or the session's `worker_exit`) of exactly that worker
 *   (pid + start_generation); the replay session is waiting for a restart.
 * - quarantined: anything else is RDC_RECOVERY_PROCESS_UNEXPLAINED; a spent attempt budget or a device action still
 *   pending its confirmation stop recovery before the chain is even read.
 *
 * `budget` is null for the user's own explicit restore, which a person starts and is not counted.
 */
export function classifyRecovery(input: {
  verified: RdcProcessIdentity;
  replaySessionId: string;
  status: RdcContextStatus;
  deviceActionPending: boolean;
  budget: { attempts: number; limit: number } | null;
}): RdcRecoveryClassification {
  const { verified, status } = input;
  if (input.budget && input.budget.attempts >= input.budget.limit)
    return {
      decision: 'quarantined',
      code: 'RDC_RECOVERY_BUDGET_EXHAUSTED',
      reason: `${input.budget.attempts} of ${input.budget.limit} recovery attempts already used.`,
    };
  if (input.deviceActionPending)
    return { decision: 'quarantined', code: 'RDC_DEVICE_ACTION_UNCONFIRMED', reason: 'a device action is pending.' };
  if (status.source !== 'daemon') return unexplained('the context daemon did not answer the status read.');
  if (status.daemon.state !== 'alive' || !same(status.daemon, verified.daemon))
    return unexplained('the live daemon is not the verified daemon.');
  const session = status.sessions.find((value) => value.session_id === input.replaySessionId);
  if (!session) return unexplained('the replay session is not in the context status.');
  const chain = workerChain(verified.worker, status);
  if (!chain) return unexplained('a worker change has no confirmed exit receipt of the verified worker.');
  const exit = session.recovery.worker_exit;
  if (!chain.length) {
    if (session.is_live && !session.recovery.requires_restart)
      return { decision: 'keep', reason: 'verified-processes-live' };
    // The verified worker still runs, so only a confirmed exit of an earlier worker can explain the lost replay.
    if (
      session.recovery.requires_restart &&
      exit &&
      !same({ pid: exit.pid, start_generation: exit.birth }, verified.worker)
    )
      return {
        decision: 'rebuild',
        reason: 'replay-requires-restart',
        lost: { workers: [exitRecord({ pid: exit.pid, start_generation: exit.birth }, status, exit)] },
      };
    return unexplained('the replay needs a restart but no earlier worker exit explains it.');
  }
  if (!session.recovery.requires_restart || session.is_live)
    return unexplained('the worker changed but the replay session still claims to be live.');
  return { decision: 'rebuild', reason: 'worker-exited', lost: { workers: chain } };
}

/**
 * The exited workers from the verified one to the current one, or null when a change is not explained. An empty chain
 * means the verified worker is the live worker.
 */
function workerChain(start: Birth, status: RdcContextStatus): ExitedWorker[] | null {
  const lifecycle = status.worker_lifecycle;
  const exit = status.sessions.map((value) => value.recovery.worker_exit).filter((value) => value !== null);
  const chain: ExitedWorker[] = [];
  let current = start;
  let from = 0;
  for (;;) {
    if (status.worker.state === 'alive' && same(status.worker, current)) return chain;
    const exitedAt = lifecycle.findIndex(
      (entry, index) =>
        index >= from && entry.event === 'exited' && entry.exit_confirmed === true && same(entry, current),
    );
    const sessionExit = exit.find((value) => same({ pid: value.pid, start_generation: value.birth }, current));
    if (exitedAt < 0 && !sessionExit) return null;
    chain.push(exitRecord(current, status, sessionExit));
    // Only a lifecycle exit has a place in the history from which the next started worker can be read.
    const next =
      exitedAt < 0 ? -1 : lifecycle.findIndex((entry, index) => index > exitedAt && entry.event === 'started');
    if (next < 0)
      return status.worker.state !== 'alive' && (status.worker.pid === 0 || same(status.worker, current))
        ? chain
        : null;
    current = lifecycle[next]!;
    from = next + 1;
  }
}

function exitRecord(
  worker: Birth,
  status: RdcContextStatus,
  sessionExit?: { reason: string; trace_id: string; request_id: string; stack_log: { path: string } },
): ExitedWorker {
  const entry = status.worker_lifecycle.find((value) => value.event === 'exited' && same(value, worker));
  return {
    pid: worker.pid,
    start_generation: worker.start_generation,
    reason: sessionExit?.reason ?? entry?.reason ?? '',
    traceId: sessionExit?.trace_id ?? entry?.trace_id ?? '',
    requestId: sessionExit?.request_id ?? entry?.request_id ?? '',
    stackLogPath: sessionExit?.stack_log.path ?? entry?.stack_log?.path ?? '',
  };
}
