import type { RdcOperationProgress } from '@shared/types/agentRuntime';
import type { RdcOperationFrame } from './RdcOperationWatcher';

/** Progress reaches the Working row at most this often; the last state before a pause is always delivered. */
export const RDC_PROGRESS_UPDATE_INTERVAL_MS = 1_000;

/** The partial result a shell `rdc` call reports while it runs; AgentEventBridge turns it into `tool.progress`. */
export interface RdcProgressUpdate {
  kind: 'rdc-operation-progress';
  progress: RdcOperationProgress;
}

export function isRdcProgressUpdate(value: unknown): value is RdcProgressUpdate {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { kind?: unknown }).kind === 'rdc-operation-progress' &&
    !!(value as { progress?: unknown }).progress
  );
}

/**
 * Folds an operation's frames into one current state and reports it at most once a second. Heartbeats only matter
 * when they change whether the operation is queued or running; progress and native-call frames are what make it
 * "not quiet", so only they move `lastProgressAt`.
 */
export function createRdcProgressReporter(operation: string, onUpdate: (update: RdcProgressUpdate) => void) {
  const startedAt = Date.now();
  let state: RdcOperationProgress = {
    operation,
    state: 'queued',
    stage: null,
    progressPct: null,
    nativeCall: null,
    startedAt,
    lastProgressAt: startedAt,
  };
  let lastSentAt = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = () => {
    timer = undefined;
    lastSentAt = Date.now();
    onUpdate({ kind: 'rdc-operation-progress', progress: state });
  };
  return {
    onFrame(frame: RdcOperationFrame): void {
      if (disposed) return;
      if (frame.kind === 'heartbeat') {
        if (frame.state === state.state) return;
        state = { ...state, state: frame.state };
      } else if (frame.kind === 'progress') {
        state = {
          ...state,
          state: 'running',
          operation: frame.operation,
          stage: frame.stage,
          progressPct: frame.progress_pct,
          lastProgressAt: Date.now(),
        };
      } else {
        state = { ...state, state: 'running', nativeCall: frame.name, lastProgressAt: Date.now() };
      }
      if (timer) return;
      const wait = RDC_PROGRESS_UPDATE_INTERVAL_MS - (Date.now() - lastSentAt);
      if (wait <= 0) send();
      else timer = setTimeout(send, wait);
    },
    /** The call settled: its final result replaces progress, so nothing more is reported. */
    dispose(): void {
      disposed = true;
      clearTimeout(timer);
    },
  };
}
