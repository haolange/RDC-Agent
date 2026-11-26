import { AppError } from '@shared/errors/appError';
import { samePath } from '../../platform/paths';
import { getDelegatedChildSessionId, getRdcContextLease } from '../../rdc/RdcRuntimeContextRegistry';
import { rdcSessionService } from '../../rdc/RdcSessionService';
import { replayDeviceService } from '../../rdc/captures/ReplayDeviceService';
import { readRdcContextStatus, rdcRecoveryObservation } from '../../rdc/RdcContextStatus';
import { classifyRecovery, RDC_RECOVERY_ATTEMPT_LIMIT } from '../../rdc/RdcRecoveryClassification';
import { rdcLifecycleReceipts } from '../../rdc/RdcLifecycleReceipts';
import type { ReplayDeviceEntry } from '@shared/types/device';
import type { RdcLifecyclePoint } from '../../rdc/RdcLifecycleReceipts';
import type { RdcTurnBinding } from '../../rdc/RdcTurnBindings';
import type { RecoveryFacts } from './ApprovedCaptureController';

type Destination = { inputId: string; contentSha256: string; deviceId: string };

/**
 * What recovery may act on: the quarantined owning lease, still the one `point` verified, its projection, the frozen
 * input and the read-only context status, classified by the shared `classifyRecovery` admission. Nothing here starts a
 * worker or changes the replay; the caller signs the decision into its intent before acting on it.
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
    !opened ||
    opened.inputId !== point.inputId ||
    opened.contextId !== lease.contextId
  ) {
    throw new AppError(
      'RDC_RECOVERY_IDENTITY_UNVERIFIED',
      'the current failure does not match the last verified capture.',
    );
  }
  const destination = { inputId: point.inputId, contentSha256: point.contentSha256, deviceId: point.deviceId };
  const resolved = await input.resolve(destination);
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
  const classification = classifyRecovery({
    verified: point.native.processIdentity,
    replaySessionId: point.native.replaySessionId,
    status,
    deviceActionPending: !!state.preparation.issue?.deviceAction,
    budget: {
      attempts: rdcLifecycleReceipts.recoveryAttempts(input.sessionId, input.projectId, destination).attempts,
      limit: RDC_RECOVERY_ATTEMPT_LIMIT,
    },
  });
  return { cause: lease.quarantineCause, observed, classification };
}

/** Clear the quarantined context, confirm its daemon stopped, then prepare the same device and reopen the same input. */
export async function reopenQuarantinedCapture(input: {
  sessionId: string;
  projectId: string;
  turnId: string;
  destination: Destination;
  resolved: { capture: { inputId: string; filePath: string }; device: ReplayDeviceEntry };
  binding: RdcTurnBinding;
  signal: AbortSignal | undefined;
  onStopped: (contextId: string) => void;
  guard: () => void;
}): Promise<void> {
  const { binding, signal, guard } = input;
  const { capture, device } = input.resolved;
  const scope = { sessionId: input.sessionId, projectId: input.projectId };
  const old = rdcSessionService.snapshotReplayForSession(scope);
  if (
    !(await rdcSessionService.clearOpenedCaptureForSession(scope, {
      binding,
      signal,
      expectedGeneration: old.generation,
      onDaemonStopped: (receipt) => input.onStopped(receipt.contextId),
    }))
  )
    throw new AppError('RDC_RECOVERY_CLOSE_UNCONFIRMED');
  guard();
  signal?.throwIfAborted();
  const closed = rdcSessionService.snapshotReplayForSession(scope);
  const prepared = await rdcSessionService.prepareAgentDevice(
    { ...scope, deviceId: device.id, bindingGeneration: closed.generation },
    { binding, turnId: input.turnId, signal, assertAuthorized: guard },
  );
  if (!prepared.success)
    throw new AppError(
      'RDC_RECOVERY_DEVICE_UNAVAILABLE',
      prepared.error?.code ?? 'device preparation did not complete',
    );
  guard();
  signal?.throwIfAborted();
  const currentDevice = replayDeviceService.getDeviceById(device.id);
  if (
    !currentDevice ||
    currentDevice.status !== 'online' ||
    currentDevice.type !== device.type ||
    currentDevice.serial !== device.serial
  )
    throw new AppError('RDC_APPROVED_DEVICE_CHANGED');
  await rdcSessionService.openProjectInput(
    { ...scope, inputId: capture.inputId, filePath: capture.filePath, replayDevice: currentDevice },
    {
      binding,
      signal,
      expectedGeneration: prepared.state.generation,
      expectedCaptureSha256: input.destination.contentSha256,
    },
  );
  guard();
}
