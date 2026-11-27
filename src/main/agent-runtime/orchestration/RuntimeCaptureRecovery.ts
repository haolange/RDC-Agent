import { AppError } from '@shared/errors/appError';
import { captureExitFor, type ApprovedCaptureController } from './ApprovedCaptureController';
import type { CaptureExit } from '@shared/types/captureReplay';
import type { ErrorCode } from '@shared/errors/errorCodes';
import type { InvestigationContentRef } from '@shared/types/renderdocInvestigation';

/** What the runtime did about a replay one tool call left quarantined, reported beside that call's result. */
export type RuntimeCaptureRecovery =
  | {
      status: 'rebuilt';
      receipt: InvestigationContentRef;
      current: { inputId: string; deviceId: string; eventId: number };
      newBaselineRequired: true;
    }
  | { status: 'blocked'; code: string; reason: string; exit: CaptureExit };

/** Ends a turn whose replay the host could not recover before the model started, under the recovery's own code. */
export class RdcRecoveryBlockedError extends AppError {
  constructor(code: ErrorCode, reason: string) {
    super(code, reason);
    this.name = 'RdcRecoveryBlockedError';
  }
}

/**
 * The host's own step after a call that left the owning approved replay quarantined: it recovers the replay as
 * capture_recover would, under the shared classification and with the same signed receipts, so the turn continues
 * on the rebuilt replay. A recovery it cannot make is reported with the exit that can make it; the turn goes on.
 */
export async function recoverQuarantinedCapture(input: {
  control: ApprovedCaptureController;
  permissionRevision: number;
  runExclusive: <T>(operation: () => Promise<T>) => Promise<T>;
  signal?: AbortSignal;
}): Promise<RuntimeCaptureRecovery> {
  const { control, signal } = input;
  try {
    await control.prepareRecovery(input.permissionRevision, signal);
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
    const message = error instanceof Error ? error.message : String(error);
    const code =
      (error instanceof AppError ? error.code : /^[A-Z][A-Z0-9_]{0,127}/u.exec(message)?.[0]) ??
      'RDC_RECOVERY_RESULT_UNVERIFIED';
    return { status: 'blocked', code, reason: message, exit: captureExitFor(code) };
  }
}
