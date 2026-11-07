import { randomUUID } from 'node:crypto';
import type { CaptureRecoveryStatus, CaptureReplayBindingRequest, CaptureReplayState } from '@shared/types/captureReplay';
import type { SessionScope } from '@shared/types/session';
import { settingsService } from '../settings/settings-core/SettingsService';
import { storageAdapter } from '../sessions/store/StorageAdapter';
import { verifyPlanInput } from '../sessions/run/prepareInvestigationPlan';
import { rdcSessionService } from '../sessions';
import { replayDeviceService } from './captures/ReplayDeviceService';
import { acquireRdcPreparationLock, getRdcInteractionLock, ownsRdcInteractionLock, setRdcInteractionLock } from './RdcOperationCoordinator';
import { assertRdcContextLeaseOwnership, getRdcContextLease } from './RdcRuntimeContextRegistry';
import { listOwnedRdcDaemons } from './OwnedRdcDaemonRegistry';
import { rdcCliInvokerService } from './RdcCliInvokerService';
import { freezeRdcTurnBinding } from './RdcTurnBindings';
import { readRdcSwitchSnapshot } from './RdcSwitchSnapshot';
import { rdcLifecycleReceipts, sameRdcLifecyclePosition, type RdcLifecyclePoint } from './RdcLifecycleReceipts';
import { withRdcHostRuntimeEnv } from './withRdcHostRuntimeEnv';

function authorize(scope: SessionScope): void {
  if (storageAdapter.readSession(scope.sessionId)?.projectId !== scope.projectId) throw new Error('REPLAY_SCOPE_DENIED');
}

export function captureRecoveryStatus(scope: SessionScope): CaptureRecoveryStatus | null {
  authorize(scope);
  const pending = rdcLifecycleReceipts.pending(scope.sessionId, scope.projectId);
  if (!pending) return null;
  const original = pending.baseline.original;
  const fileName = original ? storageAdapter.getProjectById(scope.projectId)?.inputs.find(value => value.inputId === original.inputId)?.fileName : undefined;
  return { pendingCount: pending.count, original: original ? { inputId: original.inputId, fileName: fileName ?? original.inputId,
    deviceId: original.deviceId, eventId: original.native.eventId } : null };
}

/** A user click restores only the main-signed saved position; it never starts an Agent. */
export async function restorePreviousCapture(scope: CaptureReplayBindingRequest): Promise<CaptureReplayState> {
  authorize(scope);
  const initial = rdcLifecycleReceipts.pending(scope.sessionId, scope.projectId);
  if (!initial) throw new Error('RDC_RECOVERY_NOT_REQUIRED');
  const state = rdcSessionService.snapshotReplayForSession(scope);
  if (state.generation !== scope.bindingGeneration) throw new Error('RDC_BINDING_CHANGED: refresh the current capture state.');
  if (getRdcInteractionLock(scope.sessionId)) throw new Error('RDC_INTERACTION_LOCKED: stop the owning execution first.');
  const owner = `capture-restore-${randomUUID()}`;
  acquireRdcPreparationLock(scope.sessionId, owner);
  try {
    const guard = () => {
      authorize(scope);
      if (!ownsRdcInteractionLock(scope.sessionId, owner)) throw new Error('RDC_RECOVERY_OWNER_INVALID');
      const latest = rdcLifecycleReceipts.pending(scope.sessionId, scope.projectId);
      if (!latest || JSON.stringify(latest.ref) !== JSON.stringify(initial.ref)) throw new Error('RDC_RECOVERY_RECORD_CHANGED');
    };
    guard();
    assertPriorProcessesReleased(initial, state.contextId);
    const original = initial.baseline.original;
    const project = storageAdapter.getProjectById(scope.projectId);
    if (!project) throw new Error('RDC_CAPTURE_PROJECT_MISSING');
    const capture = original ? project.inputs.find(value => value.inputId === original.inputId) : undefined;
    const device = original ? replayDeviceService.getDeviceById(original.deviceId) : undefined;
    if (original && (!capture || capture.contentSha256 !== original.contentSha256
      || await verifyPlanInput(project, capture) !== original.contentSha256)) throw new Error('RDC_RECOVERY_INPUT_CHANGED');
    if (original && (!device || device.status !== 'online')) throw new Error('RDC_APPROVED_DEVICE_UNAVAILABLE');
    const deviceOwner = device ? rdcSessionService.getDeviceOwner(device.id) : null;
    if (deviceOwner && (deviceOwner.projectId !== scope.projectId || deviceOwner.sessionId !== scope.sessionId)) throw new Error('RDC_DEVICE_IN_USE');
    guard();

    const priorBinding = rdcSessionService.recoveryBinding(scope);
    const cli = priorBinding?.cli ?? withRdcHostRuntimeEnv(structuredClone(settingsService.getAll().tooling.rdcCli));
    const catalog = original ? (await rdcCliInvokerService.loadCatalog(cli, true)).tools : [];
    guard();
    let current = await observedPosition(scope);
    if (current && current.native.replacementCount && (!original || current.inputId !== original.inputId
      || current.contentSha256 !== original.contentSha256 || current.deviceId !== original.deviceId
      || current.native.replacementFingerprint !== original.native.replacementFingerprint)) {
      throw new Error('RDC_RECOVERY_REPLACEMENTS_ACTIVE: restore the current replacements before changing the replay.');
    }
    const sameInput = current && original && current.inputId === original.inputId && current.contentSha256 === original.contentSha256
      && current.deviceId === original.deviceId && current.native.replacementFingerprint === original.native.replacementFingerprint;
    if (original?.native.replacementCount && !sameInput) throw new Error('RDC_ORIGINAL_REPLACEMENTS_UNRESTORABLE');
    if (!sameInput && rdcSessionService.snapshotReplayForSession(scope).contextId) {
      if (!priorBinding) throw new Error('RDC_RECOVERY_OWNER_INVALID');
      const latest = rdcSessionService.snapshotReplayForSession(scope);
      if (!await rdcSessionService.clearOpenedCaptureForSession(scope, { binding: priorBinding, expectedGeneration: latest.generation })) {
        throw new Error('RDC_RECOVERY_CLOSE_UNCONFIRMED');
      }
      guard(); current = null;
    }
    if (original && !sameInput) {
      const closed = rdcSessionService.snapshotReplayForSession(scope);
      const newBinding = freezeRdcTurnBinding(cli, catalog, null);
      const prepared = await rdcSessionService.prepareAgentDevice({ ...scope, deviceId: device!.id, bindingGeneration: closed.generation },
        { binding: newBinding, turnId: owner, assertAuthorized: guard });
      if (!prepared.success) throw new Error(`RDC_RECOVERY_DEVICE_UNAVAILABLE: ${prepared.error?.code ?? 'device preparation did not complete'}`);
      guard();
      const liveDevice = replayDeviceService.getDeviceById(device!.id);
      if (!liveDevice || liveDevice.status !== 'online' || liveDevice.type !== device!.type || liveDevice.serial !== device!.serial) {
        throw new Error('RDC_APPROVED_DEVICE_CHANGED');
      }
      await rdcSessionService.openProjectInput({ projectId: scope.projectId, sessionId: scope.sessionId, inputId: capture!.inputId,
        filePath: capture!.filePath, replayDevice: liveDevice }, { binding: newBinding, expectedGeneration: prepared.state.generation,
        expectedCaptureSha256: original.contentSha256 });
      guard(); current = await observedPosition(scope);
    }
    if (original && !sameRdcLifecyclePosition(current, original)) {
      const binding = rdcSessionService.recoveryBinding(scope); const latest = rdcSessionService.snapshotReplayForSession(scope);
      if (!binding) throw new Error('RDC_RECOVERY_OWNER_INVALID');
      await rdcSessionService.restoreAgentPosition({ ...scope, bindingGeneration: latest.generation, eventId: original.native.eventId,
        target: original.target, isFinalOutput: original.isFinalOutput }, { binding, turnId: owner });
      guard(); current = await observedPosition(scope);
    }
    if (!sameRdcLifecyclePosition(current, original)) throw new Error('RDC_RESTORE_UNCONFIRMED');
    const { event: _event, original: _original, ...base } = initial.baseline;
    rdcLifecycleReceipts.write({ ...base, event: 'resolved', operationId: randomUUID(), recordedAt: Date.now(), baseline: initial.ref, observed: current });
  } finally { setRdcInteractionLock(scope.sessionId, owner, false); }
  return rdcSessionService.snapshotReplayForSession(scope);
}

async function observedPosition(scope: SessionScope): Promise<RdcLifecyclePoint | null> {
  const state = rdcSessionService.snapshotReplayForSession(scope);
  const lease = getRdcContextLease(scope.sessionId);
  if (!state.contextId && !lease && !rdcSessionService.snapshotOpenedCaptureForSession(scope)) return null;
  // A quarantined context can be closed by this explicit user action, but cannot be claimed as an observed position.
  if (lease?.quarantineReason || state.phase === 'error') return null;
  const owner = assertRdcContextLeaseOwnership(scope); const opened = rdcSessionService.snapshotOpenedCaptureForSession(scope);
  const binding = rdcSessionService.recoveryBinding(scope);
  if (!owner || !opened || !binding || state.phase !== 'ready' || !state.inputId || !state.captureHash || !state.replayDeviceId || !state.observation
    || state.contextId !== owner.contextId || opened.contextId !== owner.contextId || opened.inputId !== state.inputId) {
    throw new Error('RDC_RECOVERY_IDENTITY_UNVERIFIED');
  }
  const native = await readRdcSwitchSnapshot({ ...scope, binding });
  if (native.eventId !== state.appliedEventId) throw new Error('RDC_RECOVERY_IDENTITY_UNVERIFIED');
  return { inputId: state.inputId, contentSha256: state.captureHash, deviceId: state.replayDeviceId,
    native, target: state.target, isFinalOutput: state.isFinalOutput };
}

function assertPriorProcessesReleased(pending: NonNullable<ReturnType<typeof rdcLifecycleReceipts.pending>>, currentContext: string | null): void {
  if (listOwnedRdcDaemons().some(record => record.ownerPid !== process.pid)) throw new Error('RDC_RECOVERY_OLD_OWNER_UNCONFIRMED');
  for (const identity of pending.identities) {
    if (identity.stopped || identity.contextId === currentContext) continue;
    for (const birth of [identity.processIdentity.daemon, identity.processIdentity.worker]) {
      try { process.kill(birth.pid, 0); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') continue; }
      throw new Error('RDC_RECOVERY_OLD_PROCESS_UNCONFIRMED: an earlier daemon or worker may still be alive.');
    }
  }
}
