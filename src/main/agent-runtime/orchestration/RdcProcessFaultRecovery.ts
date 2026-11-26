import { AppError } from '@shared/errors/appError';
import type { ErrorCode } from '@shared/errors/errorCodes';
import type { AgentPermissionMode } from '@shared/types/settings';
import type { InvestigationContentRef } from '@shared/types/renderdocInvestigation';
import type { RdcNativeFailure } from '../../rdc/RdcNativeProtocol';
import type { RdcRecoveryClassification } from '../../rdc/RdcRecoveryClassification';
import type { ApprovedCaptureController } from './ApprovedCaptureController';

/** Process failures whose worker RDC-Tool stopped or lost; the fault is already registered on the owning lease. */
const REBUILDABLE_FAULTS = new Set(['RDC_OPERATION_STUCK', 'RDC_WORKER_LOST']);

/** What the runtime did about a stuck or lost worker, reported beside the failed call. */
export type RdcProcessFaultOutcome =
  | {
      status: 'rebuilt';
      receipt: InvestigationContentRef;
      current: { inputId: string; deviceId: string; eventId: number };
      newBaselineRequired: true;
    }
  | { status: 'recovery-available'; action: 'capture_recover'; decision: 'keep' | 'rebuild' }
  | { status: 'blocked'; code: string; reason: string; stopsTurn: boolean };

/** Ends an autonomous turn whose stuck replay could not be rebuilt, under the blocker's own code. */
export class RdcRecoveryBlockedError extends AppError {
  constructor(code: ErrorCode, reason: string) {
    super(code, reason);
    this.name = 'RdcRecoveryBlockedError';
  }
}

/**
 * The post-call step for a stuck or lost worker on an approved capture. Under full access or auto-review the runtime
 * acts as the model would with capture_recover: when the shared admission says rebuild, it prepares and recovers
 * (signing the same receipts) so the turn continues on the rebuilt replay; any other decision or failure blocks the
 * turn with that specific code. Under any other mode it only reports the decision and offers capture_recover, which
 * then goes through approval like any recovery.
 */
export async function settleRdcProcessFault(input: {
  error: RdcNativeFailure;
  control: ApprovedCaptureController | undefined;
  permission: { mode: AgentPermissionMode; revision: number };
  runExclusive: <T>(operation: () => Promise<T>) => Promise<T>;
  signal?: AbortSignal;
}): Promise<RdcProcessFaultOutcome | null> {
  const { control, signal } = input;
  if (!control || !REBUILDABLE_FAULTS.has(input.error.code)) return null;
  const autonomous = input.permission.mode === 'full-access' || input.permission.mode === 'auto-review';
  let classification: RdcRecoveryClassification;
  try {
    classification = await control.classifyFault(signal);
  } catch (error) {
    return blocked(error, autonomous);
  }
  if (classification.decision === 'quarantined')
    return { status: 'blocked', code: classification.code, reason: classification.reason, stopsTurn: autonomous };
  if (!autonomous)
    return { status: 'recovery-available', action: 'capture_recover', decision: classification.decision };
  try {
    await control.prepareRecovery(input.permission.revision, signal);
    const recovered = await input.runExclusive(() => control.recover(signal));
    return {
      status: 'rebuilt',
      receipt: recovered.receipt,
      current: {
        inputId: recovered.current.inputId,
        deviceId: recovered.current.deviceId,
        eventId: recovered.current.native.eventId,
      },
      newBaselineRequired: true,
    };
  } catch (error) {
    return blocked(error, true);
  }
}

function blocked(error: unknown, stopsTurn: boolean): RdcProcessFaultOutcome {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    (error instanceof AppError ? error.code : /^[A-Z][A-Z0-9_]{0,127}/u.exec(message)?.[0]) ??
    'RDC_RECOVERY_RESULT_UNVERIFIED';
  return { status: 'blocked', code, reason: message, stopsTurn };
}
