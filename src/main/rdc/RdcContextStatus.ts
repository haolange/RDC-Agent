import { z } from 'zod';
import { AppError } from '@shared/errors/appError';
import { parseRdcNativeResult } from './RdcNativeProtocol';
import { rdcCliInvokerService } from './RdcCliInvokerService';
import type { RdcCliInvokerSettings } from '@shared/types/settings';
import type { CLIResult } from '../tools/ShellInvocationService';

/** What RDC-Tool's OS probe says about a recorded process (`absent`: nothing was recorded). */
const Liveness = z.enum(['alive', 'exited', 'unknown', 'absent']);
const processView = {
  state: Liveness,
  pid: z.number().int().nonnegative(),
  start_generation: z.string(),
  reason: z.string().optional(),
};
const LifecycleEntrySchema = z.strictObject({
  event: z.enum(['started', 'exited']),
  pid: z.number().int().nonnegative(),
  start_generation: z.string(),
  at_ms: z.number().int().nonnegative(),
  reason: z.string().optional(),
  code: z.string().optional(),
  exit_confirmed: z.boolean().optional(),
  trace_id: z.string().optional(),
  request_id: z.string().optional(),
  stack_log: z.strictObject({ path: z.string() }).optional(),
});
/** A confirmed worker exit recorded on a quarantined replay session; RDC-Tool writes it only once the exit is seen. */
const WorkerExitSchema = z.strictObject({
  pid: z.number().int().positive(),
  birth: z.string().min(1),
  reason: z.string(),
  trace_id: z.string(),
  request_id: z.string(),
  stack_log: z.strictObject({ path: z.string(), tail: z.string() }),
});
const SessionSchema = z.strictObject({
  session_id: z.string(),
  capture_file_id: z.string(),
  rdc_path: z.string(),
  backend_type: z.string(),
  state: z.string(),
  is_live: z.boolean(),
  frame_index: z.number().int(),
  active_event_id: z.number().int(),
  recovery: z.strictObject({
    status: z.string(),
    requires_restart: z.boolean(),
    last_error: z.string(),
    worker_exit: WorkerExitSchema.nullable(),
  }),
});

/**
 * `rdc-tool context status` (result kind `rdc_tool.context.status`, RDC-Tool public contract): the daemon and worker
 * identities as the OS reports them now, the bounded worker lifecycle and each replay session's recovery state. It is
 * read-only: it never starts a daemon or a worker and never writes state, so recovery can read it before deciding.
 */
export const RdcContextStatusSchema = z.strictObject({
  context_id: z.string().min(1),
  source: z.enum(['daemon', 'state_files']),
  daemon: z.strictObject({
    ...processView,
    started_at: z.string().optional(),
    last_activity_at: z.string().optional(),
  }),
  worker: z.strictObject({ ...processView, log_path: z.string() }),
  active_operation: z.record(z.string(), z.unknown()),
  worker_lifecycle: z.array(LifecycleEntrySchema),
  backend: z.string(),
  current_session_id: z.string(),
  current_capture_file_id: z.string(),
  session_locator: z.strictObject({
    rdc_path: z.string(),
    session_id: z.string(),
    frame_index: z.number().int(),
    active_event_id: z.number().int(),
  }),
  sessions: z.array(SessionSchema),
  recovery: z.record(z.string(), z.unknown()),
  preview: z.record(z.string(), z.unknown()),
  notes: z.string(),
  focus: z.record(z.string(), z.unknown()),
  queued_request_ids: z.array(z.string()).optional(),
});
export type RdcContextStatus = z.infer<typeof RdcContextStatusSchema>;

/** Read the context's status through the CLI control path; never `call`, so no worker is started. */
export async function readRdcContextStatus(input: {
  contextId: string;
  settings: RdcCliInvokerSettings;
  signal?: AbortSignal;
  execute?: (args: string[], settings: RdcCliInvokerSettings, signal?: AbortSignal) => Promise<CLIResult>;
}): Promise<RdcContextStatus> {
  input.signal?.throwIfAborted();
  const args = ['status', '--daemon-context', input.contextId];
  const result = await (input.execute
    ? input.execute(args, input.settings, input.signal)
    : rdcCliInvokerService.executeCLI('context', args, { settings: input.settings, abortSignal: input.signal }));
  input.signal?.throwIfAborted();
  const envelope = parseRdcNativeResult(result, input.contextId, 'rdc_tool.context.status');
  const parsed = RdcContextStatusSchema.safeParse(envelope.data);
  if (!parsed.success)
    throw new AppError('RDC_CLI_PROTOCOL', `invalid context status: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

const processSummary = z.strictObject({
  state: Liveness,
  pid: z.number().int().nonnegative(),
  start_generation: z.string(),
});
/** The part of a status a recovery receipt keeps: identities, liveness and the replay session's exit receipt. */
export const RdcRecoveryObservationSchema = z.strictObject({
  source: z.enum(['daemon', 'state_files']),
  daemon: processSummary,
  worker: processSummary,
  replaySession: z
    .strictObject({
      isLive: z.boolean(),
      requiresRestart: z.boolean(),
      workerExit: z
        .strictObject({
          pid: z.number().int().positive(),
          startGeneration: z.string().min(1),
          reason: z.string(),
          traceId: z.string(),
          requestId: z.string(),
          stackLogPath: z.string(),
        })
        .nullable(),
    })
    .nullable(),
});
export type RdcRecoveryObservation = z.infer<typeof RdcRecoveryObservationSchema>;

export function rdcRecoveryObservation(status: RdcContextStatus, replaySessionId: string): RdcRecoveryObservation {
  const session = status.sessions.find((value) => value.session_id === replaySessionId);
  const exit = session?.recovery.worker_exit;
  return {
    source: status.source,
    daemon: { state: status.daemon.state, pid: status.daemon.pid, start_generation: status.daemon.start_generation },
    worker: { state: status.worker.state, pid: status.worker.pid, start_generation: status.worker.start_generation },
    replaySession: session
      ? {
          isLive: session.is_live,
          requiresRestart: session.recovery.requires_restart,
          workerExit: exit
            ? {
                pid: exit.pid,
                startGeneration: exit.birth,
                reason: exit.reason,
                traceId: exit.trace_id,
                requestId: exit.request_id,
                stackLogPath: exit.stack_log.path,
              }
            : null,
        }
      : null,
  };
}
