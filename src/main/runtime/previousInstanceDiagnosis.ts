import { crashDirectory, listCrashDumps, type CrashDump } from './crashFiles';
import { lifecycleLedger, type LifecycleRecord } from './LifecycleLedger';
import type { UserDataInstanceLockOwner } from './userDataInstanceLock';
import type {
  InterruptionCause,
  PreviousInstanceClassification,
  PreviousInstanceNotice,
} from '@shared/types/lifecycle';

export interface PreviousInstanceDiagnosis extends PreviousInstanceNotice {
  /** When the previous launch started (epoch ms), from its ledger record or its lock; null when neither says. */
  startedAt: number | null;
  /** Ledger lines that were not valid records; the classification stands on the valid ones. */
  damagedRecords: number;
  /** Set when the ledger could not be read at all; the classification then rests on the lock and crash files. */
  ledgerError?: string;
}

export interface PreviousInstanceInput {
  staleOwner: UserDataInstanceLockOwner;
  currentInstanceId: string;
  records: readonly LifecycleRecord[];
  damagedRecords: number;
  crashDumps: readonly CrashDump[];
  ledgerError?: string;
}

const timeOf = (record: LifecycleRecord): number => Date.parse(record.at);
const parsedTime = (text: string): number | null => {
  const value = Date.parse(text);
  return Number.isNaN(value) ? null : value;
};

/** The previous launch: the one its lock names, else the newest other launch the ledger saw start. */
function previousInstanceId(input: PreviousInstanceInput): string {
  if (input.staleOwner.instanceId) return input.staleOwner.instanceId;
  const started = input.records.filter(
    (record) => record.kind === 'instance_started' && record.instanceId !== input.currentInstanceId,
  );
  return started.at(-1)?.instanceId ?? '';
}

type Candidate = { classification: PreviousInstanceClassification; at: number; record: LifecycleRecord };

/** The ledger facts that can explain an end, each with its time; the latest one is the likeliest cause. */
function endingCandidates(records: readonly LifecycleRecord[]): Candidate[] {
  const candidates: Candidate[] = [];
  const exited = records.some((record) => record.kind === 'instance_exited');
  for (const record of records) {
    if (record.kind === 'fault' && record.fault === 'uncaughtException') {
      candidates.push({ classification: 'js-fatal', at: timeOf(record), record });
    } else if (record.kind === 'process_gone') {
      const classification = record.process === 'renderer' ? 'renderer-gone' : 'child-process-gone';
      candidates.push({ classification, at: timeOf(record), record });
    } else if (record.kind === 'shutdown_began' && !exited) {
      candidates.push({ classification: 'shutdown-interrupted', at: timeOf(record), record });
    }
  }
  return candidates;
}

/** Turns the launch started and never finished. */
function interruptedTurns(records: readonly LifecycleRecord[]): PreviousInstanceNotice['interruptedTurns'] {
  const finished = new Set(records.flatMap((record) => (record.kind === 'turn_finished' ? [record.turnId] : [])));
  return records.flatMap((record) =>
    record.kind === 'turn_started' && !finished.has(record.turnId)
      ? [{ sessionId: record.sessionId, turnId: record.turnId }]
      : [],
  );
}

/**
 * How a launch that left its lock behind most likely ended. A minidump written after it started that no recorded
 * child-process death accounts for means the main process itself crashed natively. Otherwise the latest recorded
 * fact that can end a launch decides: an uncaught exception, a renderer or other child process gone, or a shutdown
 * that began and never reached its exit. With none of these the process vanished without a trace: killed from
 * outside or a power loss.
 */
export function diagnosePreviousInstance(input: PreviousInstanceInput): PreviousInstanceDiagnosis {
  const instanceId = previousInstanceId(input);
  const records = instanceId ? input.records.filter((record) => record.instanceId === instanceId) : [];
  const started = records.find((record) => record.kind === 'instance_started');
  const startedAt = started ? timeOf(started) : parsedTime(input.staleOwner.startTs);
  const crashFiles = startedAt === null ? 0 : input.crashDumps.filter((dump) => dump.mtimeMs >= startedAt).length;
  const childDeaths = records.filter((record) => record.kind === 'process_gone').length;
  const ending = endingCandidates(records)
    .sort((left, right) => left.at - right.at)
    .at(-1);
  const classification: PreviousInstanceClassification =
    crashFiles > childDeaths ? 'native-crash-suspected' : (ending?.classification ?? 'killed-or-power-loss-suspected');
  const last = records.at(-1);
  const gone = ending?.record.kind === 'process_gone' ? ending.record : null;
  return {
    classification,
    instanceId,
    pid: input.staleOwner.pid,
    startedAt,
    lastRecordAt: last ? timeOf(last) : null,
    lastRecord: last?.kind ?? null,
    ...(gone ? { process: gone.process, reason: gone.reason, exitCode: gone.exitCode } : {}),
    crashFiles,
    interruptedTurns: interruptedTurns(records),
    damagedRecords: input.damagedRecords,
    ...(input.ledgerError ? { ledgerError: input.ledgerError } : {}),
  };
}

/** Reads the ledger and the crash directory for the launch whose stale lock this one reclaimed. */
export function diagnosePreviousInstanceFromDisk(staleOwner: UserDataInstanceLockOwner): PreviousInstanceDiagnosis {
  let tail: ReturnType<typeof lifecycleLedger.tail> = { records: [], damaged: 0 };
  let ledgerError: string | undefined;
  try {
    tail = lifecycleLedger.tail();
  } catch (error) {
    ledgerError = lifecycleLedger.scrubText(error instanceof Error ? error.message : String(error));
  }
  let crashDumps: CrashDump[] = [];
  try {
    crashDumps = listCrashDumps(crashDirectory());
  } catch (error) {
    console.error('[RDC-Agent] crash files could not be listed for the previous-launch diagnosis:', error);
  }
  return diagnosePreviousInstance({
    staleOwner,
    currentInstanceId: lifecycleLedger.instanceId,
    records: tail.records,
    damagedRecords: tail.damaged,
    crashDumps,
    ledgerError,
  });
}

let diagnosis: PreviousInstanceDiagnosis | null = null;
let launchStartedAt = Number.POSITIVE_INFINITY;

/** Set once at startup, before any session, run or Task is read, by the launch that reclaimed the stale lock. */
export function adoptPreviousInstanceDiagnosis(value: PreviousInstanceDiagnosis | null, now = Date.now()): void {
  diagnosis = value;
  launchStartedAt = now;
}

export function previousInstanceDiagnosis(): PreviousInstanceDiagnosis | null {
  return diagnosis;
}

/**
 * Why a record started at `startedAt` (epoch ms) was left unfinished. Launches run one after another under the
 * instance lock, so a record started after the previous launch began and before this one is that launch's; anything
 * older belongs to an earlier launch whose end is not known here.
 */
export function interruptionCauseAt(startedAt: number): InterruptionCause {
  if (!diagnosis || diagnosis.startedAt === null) return 'unknown';
  return startedAt >= diagnosis.startedAt && startedAt < launchStartedAt ? diagnosis.classification : 'unknown';
}

/** Why a Task execution stamped with a launch's instance id was left unfinished. */
export function interruptionCauseOf(instanceId: string): InterruptionCause {
  return diagnosis?.instanceId && diagnosis.instanceId === instanceId ? diagnosis.classification : 'unknown';
}

/** The notice the renderer shows once at startup: the diagnosis without its bookkeeping. */
export function previousInstanceNotice(): PreviousInstanceNotice | null {
  if (!diagnosis) return null;
  const { startedAt: _startedAt, damagedRecords: _damaged, ledgerError: _error, ...notice } = diagnosis;
  return notice;
}
