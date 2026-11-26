import { AppError } from '@shared/errors/appError';
import { samePath } from '../../platform/paths';
import { getDelegatedChildSessionId, getRdcContextLease } from '../../rdc/RdcRuntimeContextRegistry';
import { rdcSessionService } from '../../rdc/RdcSessionService';
import { readRdcContextStatus, rdcRecoveryObservation } from '../../rdc/RdcContextStatus';
import type { RdcLifecyclePoint } from '../../rdc/RdcLifecycleReceipts';
import type { RdcTurnBinding } from '../../rdc/RdcTurnBindings';
import type { RecoveryFacts } from './ApprovedCaptureController';

type Destination = { inputId: string; contentSha256: string; deviceId: string };

/**
 * What recovery may act on: the quarantined owning lease, still the one `point` verified, its projection, the frozen
 * input and the read-only context status. Nothing here starts a worker or changes the replay.
 */
export async function inspectQuarantinedCapture(input: {
  sessionId: string;
  projectId: string;
  point: RdcLifecyclePoint;
  binding: RdcTurnBinding;
  signal?: AbortSignal;
  resolve: (destination: Destination) => Promise<{ capture: { filePath: string } }>;
}): Promise<RecoveryFacts> {
  const { point, binding } = input;
  const scope = { sessionId: input.sessionId, projectId: input.projectId };
  const lease = getRdcContextLease(input.sessionId);
  const state = rdcSessionService.snapshotReplayForSession(scope);
  const opened = rdcSessionService.snapshotOpenedCaptureForSession(scope);
  const identity = binding.identity;
  if (
    !lease?.quarantineReason ||
    !lease.quarantineCause ||
    lease.delegatedFrom ||
    getDelegatedChildSessionId(input.sessionId) ||
    lease.ownerSessionId !== input.sessionId ||
    lease.ownerProjectId !== input.projectId ||
    lease.contextId !== point.native.contextId ||
    lease.version !== point.native.leaseVersion ||
    lease.runtimeContext.replaySessionId !== point.native.replaySessionId ||
    lease.runtimeContext.captureFileId !== point.native.captureFileId ||
    identity?.contextId !== lease.contextId ||
    identity.version !== lease.version ||
    identity.ownerSessionId !== input.sessionId ||
    state.inputId !== point.inputId ||
    state.captureHash !== point.contentSha256 ||
    state.replayDeviceId !== point.deviceId ||
    state.preparation.issue?.deviceAction ||
    !opened ||
    opened.inputId !== point.inputId ||
    opened.contextId !== lease.contextId
  ) {
    throw new AppError(
      'RDC_RECOVERY_IDENTITY_UNVERIFIED',
      'the current failure does not match the last verified capture.',
    );
  }
  const resolved = await input.resolve({
    inputId: point.inputId,
    contentSha256: point.contentSha256,
    deviceId: point.deviceId,
  });
  if (!samePath(opened.filePath, resolved.capture.filePath))
    throw new AppError('RDC_RECOVERY_IDENTITY_UNVERIFIED', 'input path changed.');
  const status = await readRdcContextStatus({
    contextId: lease.contextId,
    settings: binding.cli,
    signal: input.signal,
  });
  const after = getRdcContextLease(input.sessionId);
  if (
    after?.version !== lease.version ||
    after.contextId !== lease.contextId ||
    JSON.stringify(after.quarantineCause) !== JSON.stringify(lease.quarantineCause)
  )
    throw new AppError('RDC_RECOVERY_IDENTITY_UNVERIFIED', 'the quarantined binding changed during observation.');
  const observed = rdcRecoveryObservation(status, point.native.replaySessionId);
  const verified = point.native.processIdentity;
  if (
    observed.daemon.state !== 'alive' ||
    observed.worker.state !== 'alive' ||
    observed.daemon.pid !== verified.daemon.pid ||
    observed.daemon.start_generation !== verified.daemon.start_generation ||
    observed.worker.pid !== verified.worker.pid ||
    observed.worker.start_generation !== verified.worker.start_generation
  )
    throw new AppError('RDC_RECOVERY_PROCESS_CHANGED', 'the live daemon or worker is not the last verified process.');
  return { cause: lease.quarantineCause, observed };
}
