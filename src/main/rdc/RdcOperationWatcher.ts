import { z } from 'zod';
import { AppError } from '@shared/errors/appError';
import { recordRdcOperationStarted, recordRdcOperationTerminal } from './rdcOperationLedger';
import type { CLIResult, ShellInvocationRequest, ShellInvocationService } from '../tools/ShellInvocationService';

/**
 * Commands that do no operation work (daemon start/stop/status/cancel, context clear/status, version, tools list,
 * doctor) keep a fixed wall: long enough for RDC-Tool's 30 s daemon start lock, daemon readiness and a confirmed stop.
 * Before an operation's first frame its CLI is doing exactly that control work, so the same bound applies there.
 */
export const RDC_CONTROL_TIMEOUT_MS = 60_000;
/** `daemon cancel` waits for the request to settle: RDC-Tool's 10 s cancel grace plus its stuck-worker path. */
export const RDC_CANCEL_TIMEOUT_MS = 30_000;
/** The daemon sends a heartbeat every 2 s and the CLI itself gives up after 15 s of silence; this is the CLI's limit. */
export const RDC_HEARTBEAT_GAP_MS = 20_000;
/** After the cancel receipt, the exec CLI gets this long to print its envelope and close before it is killed. */
export const RDC_CANCEL_CLOSE_GRACE_MS = 5_000;

const RequestId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u);
/** The NDJSON frames `call --progress-stream` writes to stderr (RDC-Tool public contract, execution budget). */
export const RdcOperationFrameSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('heartbeat'),
    request_id: RequestId,
    ts_ms: z.number(),
    state: z.enum(['queued', 'running']),
  }),
  z.strictObject({
    kind: z.literal('progress'),
    request_id: RequestId,
    trace_id: z.string(),
    operation: z.string(),
    stage: z.string(),
    message: z.string(),
    progress_pct: z.number().nullable(),
    details: z.record(z.string(), z.unknown()),
    ts_ms: z.number(),
  }),
  z.strictObject({
    kind: z.literal('native_call'),
    request_id: RequestId,
    trace_id: z.string(),
    name: z.string(),
    phase: z.enum(['enter', 'exit']),
    ts_ms: z.number(),
  }),
]);
export type RdcOperationFrame = z.infer<typeof RdcOperationFrameSchema>;

const CancelEnvelopeSchema = z.object({
  ok: z.literal(true),
  result_kind: z.literal('rdc_tool.daemon.cancel'),
  data: z.object({
    request_id: RequestId,
    trace_id: z.string(),
    outcome: z.enum(['cancelled', 'completed', 'terminated', 'not_found']),
    worker_exit: z
      .object({
        pid: z.number().nullable(),
        start_generation: z.string().nullable(),
        reason: z.string().nullable(),
        exit_confirmed: z.boolean(),
      })
      .optional(),
    settled_at_ms: z.number(),
  }),
});

/** What `daemon cancel` answered, or why its answer is unknown. */
export type RdcCancellation =
  | {
      status: 'settled';
      outcome: 'cancelled' | 'completed' | 'terminated' | 'not_found';
      traceId: string;
      workerExit?: {
        pid: number | null;
        startGeneration: string | null;
        reason: string | null;
        exitConfirmed: boolean;
      };
      settledAtMs: number;
    }
  | { status: 'unconfirmed'; reason: string };

export interface RdcOperationResult extends CLIResult {
  /** Present when the caller aborted: the cancel receipt this result was settled with. */
  cancellation?: RdcCancellation;
}

function readCancellation(result: CLIResult, requestId: string): RdcCancellation {
  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    return { status: 'unconfirmed', reason: `daemon cancel exited ${result.exitCode} without a canonical result` };
  }
  const parsed = CancelEnvelopeSchema.safeParse(value);
  if (!parsed.success || parsed.data.data.request_id !== requestId)
    return {
      status: 'unconfirmed',
      reason: `daemon cancel exited ${result.exitCode} without a receipt for the request`,
    };
  const receipt = parsed.data.data;
  return {
    status: 'settled',
    outcome: receipt.outcome,
    traceId: receipt.trace_id,
    ...(receipt.worker_exit
      ? {
          workerExit: {
            pid: receipt.worker_exit.pid,
            startGeneration: receipt.worker_exit.start_generation,
            reason: receipt.worker_exit.reason,
            exitConfirmed: receipt.worker_exit.exit_confirmed,
          },
        }
      : {}),
    settledAtMs: receipt.settled_at_ms,
  };
}

/** A line that claims to be a frame (a JSON object with `kind`) must be one; anything else is plain stderr. */
function frameOf(line: string): { frame: RdcOperationFrame } | { invalid: string } | null {
  if (!line.startsWith('{')) return null;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('kind' in value)) return null;
  const parsed = RdcOperationFrameSchema.safeParse(value);
  return parsed.success ? { frame: parsed.data } : { invalid: z.prettifyError(parsed.error) };
}

export interface RdcWatchedOperation {
  shell: ShellInvocationService;
  /** The exec CLI, already carrying `--no-progress-ms`, `--request-id` and `--progress-stream`. */
  invocation: Omit<ShellInvocationRequest, 'timeoutMs' | 'abortSignal' | 'onStderrLine'>;
  operation: string;
  requestId: string;
  contextId?: string;
  /** Runs `daemon cancel --request-id` for this request under its own control deadline. */
  cancel: () => Promise<CLIResult>;
  signal?: AbortSignal;
  onProgress?: (frame: RdcOperationFrame) => void;
}

/**
 * One RDC operation run through `call`: no process wall, because RDC-Tool's watchdog bounds silent work by the frozen
 * no-progress budget. The watcher only checks that the CLI is alive (frames keep arriving), publishes the frames, and
 * turns an abort into a cancellation the daemon settles: cancel, await the receipt, give the exec CLI a short grace to
 * print its envelope, and only then kill it.
 */
export async function watchRdcOperation(input: RdcWatchedOperation): Promise<RdcOperationResult> {
  input.signal?.throwIfAborted();
  const kill = new AbortController();
  const plainStderr: string[] = [];
  // Mutated by the stream, the liveness timer and the cancel sequence while the exec CLI runs.
  const state = {
    lastFrameAt: Date.now(),
    sawFrame: false,
    closed: false,
    failure: null as AppError | null,
    cancelling: null as Promise<RdcCancellation> | null,
  };
  let closeExec!: () => void;
  const execClosed = new Promise<void>((resolve) => {
    closeExec = resolve;
  });

  const onStderrLine = (line: string) => {
    const parsed = frameOf(line);
    if (!parsed) {
      plainStderr.push(line);
      return;
    }
    if ('invalid' in parsed || parsed.frame.request_id !== input.requestId) {
      state.failure ??= new AppError(
        'RDC_CLI_PROTOCOL',
        `invalid progress frame for ${input.operation}: ${'invalid' in parsed ? parsed.invalid : 'foreign request_id'}`,
      );
      return;
    }
    state.sawFrame = true;
    state.lastFrameAt = Date.now();
    input.onProgress?.(parsed.frame);
  };
  const settleCancellation = async (): Promise<RdcCancellation> => {
    const receipt = await input.cancel().then(
      (result) => readCancellation(result, input.requestId),
      (error: unknown) => ({ status: 'unconfirmed' as const, reason: String(error) }),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      execClosed,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, RDC_CANCEL_CLOSE_GRACE_MS);
      }),
    ]);
    clearTimeout(timer);
    if (!state.closed) kill.abort();
    return receipt;
  };
  const cancel = () => {
    state.cancelling ??= settleCancellation();
  };
  const liveness = setInterval(() => {
    const silence = Date.now() - state.lastFrameAt;
    const limit = state.sawFrame ? RDC_HEARTBEAT_GAP_MS : RDC_CONTROL_TIMEOUT_MS;
    if (state.closed || kill.signal.aborted || silence <= limit) return;
    const seconds = Math.round(silence / 1000);
    state.failure ??= new AppError(
      'RDC_DAEMON_UNRESPONSIVE',
      `the RDC CLI sent no frame for ${seconds} s while ${input.operation} was pending; outcome unknown.`,
      { params: { operation: input.operation, seconds } },
    );
    kill.abort();
  }, 1_000);
  input.signal?.addEventListener('abort', cancel, { once: true });
  const identity = { operation: input.operation, requestId: input.requestId, contextId: input.contextId };
  recordRdcOperationStarted(identity);
  try {
    const result = await input.shell.invoke({
      ...input.invocation,
      timeoutMs: null,
      abortSignal: kill.signal,
      onStderrLine,
    });
    state.closed = true;
    closeExec();
    const cancellation = state.cancelling ? await state.cancelling : undefined;
    if (state.failure) throw state.failure;
    recordRdcOperationTerminal(identity, result);
    return { ...result, stderr: plainStderr.join('\n'), ...(cancellation ? { cancellation } : {}) };
  } catch (error) {
    recordRdcOperationTerminal(identity, error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    clearInterval(liveness);
    input.signal?.removeEventListener('abort', cancel);
  }
}
