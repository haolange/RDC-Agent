import { rdcDigest } from './RdcExecutionReceipts';
import { RdcNativeFailure } from './RdcNativeProtocol';
import { getRdcContextLease, quarantineRdcContext, type RdcContextLease } from './RdcRuntimeContextRegistry';
import type { RdcRuntimeContext, SessionScope } from '@shared/types/session';

/** Freeze only the lease that owns this particular replay before an asynchronous observation. */
export function replayObservationLease(scope: SessionScope, owner: RdcRuntimeContext): RdcContextLease | null {
  const lease = getRdcContextLease(scope.sessionId);
  if (!lease || lease.ownerSessionId !== scope.sessionId || lease.ownerProjectId !== scope.projectId
    || lease.contextId !== owner.contextId || lease.runtimeContext.replaySessionId !== owner.replaySessionId
    || lease.runtimeContext.captureFileId !== owner.captureFileId || lease.runtimeContext.ownerLeaseId !== owner.ownerLeaseId) return null;
  return lease;
}

/** A fatal controller cannot safely be treated as a retryable image-export failure. */
export function quarantineFatalReplayFailure(scope: SessionScope, lease: RdcContextLease | null, error: unknown,
  operation: 'rd.session.get_replay_events' | 'rd.session.observe', args: Record<string, unknown>) {
  if (!(error instanceof RdcNativeFailure)
    || !['replay_fatal_error', 'replay_health_unavailable'].includes(error.nativeError.code)) return null;
  if (lease) quarantineRdcContext(scope.sessionId, lease.version,
    'Native replay health is uncertain; close or recover this capture before further execution.',
    { operation, argsFingerprint: rdcDigest(args), code: error.nativeError.code });
  return { code: error.nativeError.code, message: String(error), retry: 'close' as const };
}
