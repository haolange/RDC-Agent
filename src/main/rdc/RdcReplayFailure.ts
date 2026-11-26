import { AppError } from '@shared/errors/appError';
import { rdcFaultCode, RdcNativeFailure } from './RdcNativeProtocol';
import { getRdcContextLease, registerRdcFault, type RdcContextLease } from './RdcRuntimeContextRegistry';
import type { RdcRuntimeContext, SessionScope } from '@shared/types/session';

/** Freeze only the lease that owns this particular replay before an asynchronous observation. */
export function replayObservationLease(scope: SessionScope, owner: RdcRuntimeContext): RdcContextLease | null {
  const lease = getRdcContextLease(scope.sessionId);
  if (
    !lease ||
    lease.ownerSessionId !== scope.sessionId ||
    lease.ownerProjectId !== scope.projectId ||
    lease.contextId !== owner.contextId ||
    lease.runtimeContext.replaySessionId !== owner.replaySessionId ||
    lease.runtimeContext.captureFileId !== owner.captureFileId ||
    lease.runtimeContext.ownerLeaseId !== owner.ownerLeaseId
  )
    return null;
  return lease;
}

/** Failures whose native outcome is unknown even though no canonical RDC-Tool error describes them. */
const UNKNOWN_OUTCOME_CODES = new Set([
  'RDC_CLI_PROTOCOL',
  'RDC_CLI_FAILED',
  'RDC_CLI_OUTPUT_TRUNCATED',
  'RDC_DAEMON_UNRESPONSIVE',
]);

/**
 * A read or observation of the owning replay that failed without proof that nothing was attempted (RDC-Tool's
 * `effects_attempted:false` / `context_preserved:true`) leaves the replay uncertain: every such native failure and
 * every CLI protocol failure is registered as a fault of the lease, and the caller offers close/recover instead of a
 * retry. Anything else (an Agent-side validation of a result) is the caller's own failure.
 */
export function registerRdcReplayFailure(
  lease: RdcContextLease | null,
  error: unknown,
  operation: string,
  nativeArgs: unknown,
) {
  const uncertain =
    error instanceof RdcNativeFailure
      ? !error.effectsNotAttempted
      : error instanceof AppError && UNKNOWN_OUTCOME_CODES.has(error.code);
  if (!uncertain) return null;
  const cause = rdcFaultCode(error);
  if (lease)
    registerRdcFault({
      sessionId: lease.ownerSessionId,
      expectedVersion: lease.version,
      operation,
      nativeArgs,
      cause,
      reason: 'Native replay state is uncertain; close or recover this capture before further execution.',
    });
  return { code: cause, message: String(error), retry: 'close' as const };
}
