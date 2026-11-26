/** What started the app's shutdown: a closed window, a quit request, a process signal or an update. */
export const SHUTDOWN_CAUSES = ['window-close', 'before-quit', 'SIGINT', 'SIGTERM', 'update'] as const;
export type ShutdownCause = (typeof SHUTDOWN_CAUSES)[number];

/**
 * Why a running turn stopped: the person stopped it (Stop, edit and resend, a branch switch), the app was shutting
 * down, or the runtime cancelled it (a policy timeout or a parent abort).
 */
export const TURN_STOP_CAUSES = ['user', 'app-shutdown', 'runtime'] as const;
export type TurnStopCause = (typeof TURN_STOP_CAUSES)[number];

/** The minidumps kept on this machine (Settings › Crash files). */
export interface CrashFilesSummary {
  count: number;
  bytes: number;
}

/**
 * How the previous launch most likely ended when it left its instance lock behind, judged at the next launch from the
 * lock, its lifecycle ledger records and new minidumps. `killed-or-power-loss-suspected` is the honest "nothing was
 * recorded": the process vanished without a fault, a crash file or a shutdown.
 */
export const PREVIOUS_INSTANCE_CLASSIFICATIONS = [
  'js-fatal',
  'native-crash-suspected',
  'renderer-gone',
  'child-process-gone',
  'shutdown-interrupted',
  'killed-or-power-loss-suspected',
] as const;
export type PreviousInstanceClassification = (typeof PREVIOUS_INSTANCE_CLASSIFICATIONS)[number];

/** Why an interrupted record ended: the previous launch's classification, or `unknown` for an older launch. */
export type InterruptionCause = PreviousInstanceClassification | 'unknown';

/** What the startup notice and its "Copy details" say about a previous launch that did not end cleanly. */
export interface PreviousInstanceNotice {
  classification: PreviousInstanceClassification;
  /** The previous launch's lifecycle instance id; empty when neither its lock nor the ledger named it. */
  instanceId: string;
  pid: number;
  /** When its last ledger record was written (epoch ms), the closest known time to its end. */
  lastRecordAt: number | null;
  lastRecord: string | null;
  process?: string;
  reason?: string;
  exitCode?: number;
  crashFiles: number;
  /** Turns it started and never finished. */
  interruptedTurns: Array<{ sessionId: string | null; turnId: string }>;
}
