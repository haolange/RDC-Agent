import { randomUUID } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
import { settingsService } from '../settings/settings-core/SettingsService';
import { projectWorkspaceStore, sessionRecordStore } from '../sessions/store/sessionStores';
import { probeProcess } from '../platform/process';
import { lifecycleLedger } from '../runtime/LifecycleLedger';
import { verifyPlanInput } from './prepareInvestigationPlan';
import { rdcSessionService } from './RdcSessionService';
import { replayDeviceService } from './captures/ReplayDeviceService';
import {
  acquireRdcPreparationLock,
  getRdcInteractionLock,
  ownsRdcInteractionLock,
  setRdcInteractionLock,
} from './RdcOperationCoordinator';
import { assertRdcContextLeaseOwnership, getRdcContextLease } from './RdcRuntimeContextRegistry';
import {
  listOwnedRdcDaemons,
  ownsRdcContextDaemon,
  rdcContextProcessesExited,
  releaseFaultedRdcContext,
  type RdcContextProcesses,
} from './OwnedRdcDaemonRegistry';
import { rdcCliInvokerService } from './RdcCliInvokerService';
import { freezeRdcTurnBinding } from './RdcTurnBindings';
import { readRdcSwitchSnapshot } from './RdcSwitchSnapshot';
import { readRdcContextStatus } from './RdcContextStatus';
import { classifyRecovery } from './RdcRecoveryClassification';
import { observedRdcProcessIdentity } from './RdcProcessIdentity';
import { rdcLifecycleReceipts, sameRdcLifecyclePosition, type RdcLifecyclePoint } from './RdcLifecycleReceipts';
import { withRdcHostRuntimeEnv } from './withRdcHostRuntimeEnv';
import type { SessionScope } from '@shared/types/session';
import type { RdcCliInvokerSettings } from '@shared/types/settings';
import type { ReplayDeviceEntry } from '@shared/types/device';
import type { RdcTurnBinding } from './RdcTurnBindings';
import type {
  CaptureRecoveryStatus,
  CaptureReplayBindingRequest,
  CaptureReplayState,
} from '@shared/types/captureReplay';

function authorize(scope: SessionScope): void {
  if (sessionRecordStore.readSession(scope.sessionId)?.projectId !== scope.projectId)
    throw new AppError('REPLAY_SCOPE_DENIED');
}

export function captureRecoveryStatus(scope: SessionScope): CaptureRecoveryStatus | null {
  authorize(scope);
  const pending = rdcLifecycleReceipts.pending(scope.sessionId, scope.projectId);
  if (!pending) return null;
  const original = pending.baseline.original;
  const fileName = original
    ? projectWorkspaceStore.getProjectById(scope.projectId)?.inputs.find((value) => value.inputId === original.inputId)
        ?.fileName
    : undefined;
  return {
    pendingCount: pending.count,
    original: original
      ? {
          inputId: original.inputId,
          fileName: fileName ?? original.inputId,
          deviceId: original.deviceId,
          eventId: original.native.eventId,
        }
      : null,
  };
}

/** Who recovers a session's replay: a person from Capture, or the owning turn before its model starts. */
export type CaptureRecoveryAuthority = { kind: 'user'; bindingGeneration: number } | { kind: 'turn'; turnId: string };

/** A user click recovers the session's replay; it never starts an Agent. */
export async function restorePreviousCapture(scope: CaptureReplayBindingRequest): Promise<CaptureReplayState> {
  return recoverSessionCapture(scope, { kind: 'user', bindingGeneration: scope.bindingGeneration });
}

/** The replay needs a rebuild: its lease is quarantined, or an opened capture failed into the error phase. */
export function sessionCaptureFaulted(scope: SessionScope): boolean {
  return (
    Boolean(getRdcContextLease(scope.sessionId)?.quarantineReason) ||
    (rdcSessionService.snapshotReplayForSession(scope).phase === 'error' &&
      rdcSessionService.snapshotOpenedCaptureForSession(scope) !== null)
  );
}

/**
 * Brings a session's replay back to a known, usable position. An unresolved signed baseline, whichever plan signed
 * it, is restored and resolved; otherwise a faulted replay is rebuilt on the same input and device. A person runs
 * this from Capture under its own lock; the owning turn runs it under the turn's lock before its model starts.
 */
export async function recoverSessionCapture(
  scope: SessionScope,
  authority: CaptureRecoveryAuthority,
): Promise<CaptureReplayState> {
  authorize(scope);
  const pending = rdcLifecycleReceipts.pending(scope.sessionId, scope.projectId);
  if (!pending && !sessionCaptureFaulted(scope)) throw new AppError('RDC_RECOVERY_NOT_REQUIRED');
  const owner = authority.kind === 'turn' ? authority.turnId : `capture-restore-${randomUUID()}`;
  if (authority.kind === 'user') {
    if (rdcSessionService.snapshotReplayForSession(scope).generation !== authority.bindingGeneration)
      throw new AppError('RDC_BINDING_CHANGED', 'refresh the current capture state.');
    if (getRdcInteractionLock(scope.sessionId))
      throw new AppError('RDC_INTERACTION_LOCKED', 'stop the owning execution first.');
    acquireRdcPreparationLock(scope.sessionId, owner);
  }
  try {
    const guard = () => {
      authorize(scope);
      if (!ownsRdcInteractionLock(scope.sessionId, owner)) throw new AppError('RDC_RECOVERY_OWNER_INVALID');
      const latest = rdcLifecycleReceipts.pending(scope.sessionId, scope.projectId);
      if (JSON.stringify(latest?.ref ?? null) !== JSON.stringify(pending?.ref ?? null))
        throw new AppError('RDC_RECOVERY_RECORD_CHANGED');
    };
    guard();
    if (pending) await restorePendingBaseline(scope, pending, owner, guard);
    else await rebuildFaultedCapture(scope, owner, guard);
  } finally {
    if (authority.kind === 'user') setRdcInteractionLock(scope.sessionId, owner, false);
  }
  return rdcSessionService.snapshotReplayForSession(scope);
}

type PendingBaseline = NonNullable<ReturnType<typeof rdcLifecycleReceipts.pending>>;
type Destination = { inputId: string; contentSha256: string; deviceId: string };

/** The registered input still has the recorded bytes and its device is online and not held by another session. */
async function recoveryTarget(
  scope: SessionScope,
  destination: Destination,
): Promise<{ capture: { inputId: string; filePath: string }; device: ReplayDeviceEntry }> {
  const project = projectWorkspaceStore.getProjectById(scope.projectId);
  if (!project) throw new AppError('RDC_CAPTURE_PROJECT_MISSING');
  const capture = project.inputs.find((value) => value.inputId === destination.inputId);
  if (
    !capture ||
    capture.contentSha256 !== destination.contentSha256 ||
    (await verifyPlanInput(project, capture)) !== destination.contentSha256
  )
    throw new AppError('RDC_RECOVERY_INPUT_CHANGED');
  const device = replayDeviceService.getDeviceById(destination.deviceId);
  if (!device || device.status !== 'online') throw new AppError('RDC_APPROVED_DEVICE_UNAVAILABLE');
  const deviceOwner = rdcSessionService.getDeviceOwner(device.id);
  if (deviceOwner && (deviceOwner.projectId !== scope.projectId || deviceOwner.sessionId !== scope.sessionId))
    throw new AppError('RDC_DEVICE_IN_USE');
  return { capture, device };
}

/** Restore the signed original position of an unresolved baseline and close its chain with a `resolved` receipt. */
async function restorePendingBaseline(
  scope: SessionScope,
  initial: PendingBaseline,
  owner: string,
  guard: () => void,
): Promise<void> {
  assertPriorProcessesReleased(initial, rdcSessionService.snapshotReplayForSession(scope).contextId);
  const original = initial.baseline.original;
  const target = original ? await recoveryTarget(scope, original) : null;
  guard();
  const priorBinding = rdcSessionService.recoveryBinding(scope);
  const cli =
    priorBinding?.cli ?? withRdcHostRuntimeEnv(structuredClone(settingsService.snapshot().user.tooling.rdcCli));
  const catalog = original ? (await rdcCliInvokerService.loadCatalog(cli, true)).tools : [];
  const exitedProcesses = await admitQuarantinedContext(scope, cli, initial.identities);
  guard();
  let current = await observedPosition(scope);
  if (
    current &&
    current.native.replacementCount &&
    (!original ||
      current.inputId !== original.inputId ||
      current.contentSha256 !== original.contentSha256 ||
      current.deviceId !== original.deviceId ||
      current.native.replacementFingerprint !== original.native.replacementFingerprint)
  ) {
    throw new AppError(
      'RDC_RECOVERY_REPLACEMENTS_ACTIVE',
      'restore the current replacements before changing the replay.',
    );
  }
  const sameInput =
    current &&
    original &&
    current.inputId === original.inputId &&
    current.contentSha256 === original.contentSha256 &&
    current.deviceId === original.deviceId &&
    current.native.replacementFingerprint === original.native.replacementFingerprint;
  if (original?.native.replacementCount && !sameInput) throw new AppError('RDC_ORIGINAL_REPLACEMENTS_UNRESTORABLE');
  if (!sameInput && rdcSessionService.snapshotReplayForSession(scope).contextId) {
    if (!priorBinding) throw new AppError('RDC_RECOVERY_OWNER_INVALID');
    await closeFaultedReplay(scope, priorBinding, exitedProcesses);
    guard();
    current = null;
  }
  if (original && target && !sameInput) {
    await reopenInput(scope, { destination: original, ...target, cli, catalog, owner, guard });
    current = await observedPosition(scope);
  }
  if (original && !sameRdcLifecyclePosition(current, original)) {
    const binding = rdcSessionService.recoveryBinding(scope);
    const latest = rdcSessionService.snapshotReplayForSession(scope);
    if (!binding) throw new AppError('RDC_RECOVERY_OWNER_INVALID');
    await rdcSessionService.restoreAgentPosition(
      {
        ...scope,
        bindingGeneration: latest.generation,
        eventId: original.native.eventId,
        target: original.target,
        isFinalOutput: original.isFinalOutput,
      },
      { binding, turnId: owner },
    );
    guard();
    current = await observedPosition(scope);
  }
  if (!sameRdcLifecyclePosition(current, original)) throw new AppError('RDC_RESTORE_UNCONFIRMED');
  const { event: _event, original: _original, ...base } = initial.baseline;
  rdcLifecycleReceipts.write({
    ...base,
    event: 'resolved',
    operationId: randomUUID(),
    recordedAt: Date.now(),
    baseline: initial.ref,
    observed: current,
  });
}

/** Rebuild a faulted replay with no signed baseline to return to: same input, same device, a fresh context. */
async function rebuildFaultedCapture(scope: SessionScope, owner: string, guard: () => void): Promise<void> {
  const state = rdcSessionService.snapshotReplayForSession(scope);
  if (!state.inputId || !state.captureHash || !state.replayDeviceId)
    throw new AppError('RDC_RECOVERY_IDENTITY_UNVERIFIED', 'the faulted replay names no input or device.');
  const destination = { inputId: state.inputId, contentSha256: state.captureHash, deviceId: state.replayDeviceId };
  const target = await recoveryTarget(scope, destination);
  guard();
  const priorBinding = rdcSessionService.recoveryBinding(scope);
  if (!priorBinding) throw new AppError('RDC_RECOVERY_OWNER_INVALID');
  const catalog = (await rdcCliInvokerService.loadCatalog(priorBinding.cli, true)).tools;
  const exitedProcesses = await admitQuarantinedContext(scope, priorBinding.cli, []);
  guard();
  await closeFaultedReplay(scope, priorBinding, exitedProcesses);
  guard();
  await reopenInput(scope, { destination, ...target, cli: priorBinding.cli, catalog, owner, guard });
}

async function closeFaultedReplay(
  scope: SessionScope,
  binding: RdcTurnBinding,
  exitedProcesses: RdcContextProcesses | undefined,
): Promise<void> {
  const latest = rdcSessionService.snapshotReplayForSession(scope);
  if (
    !(await rdcSessionService.clearOpenedCaptureForSession(scope, {
      binding,
      expectedGeneration: latest.generation,
      exitedProcesses,
    }))
  )
    throw new AppError('RDC_RECOVERY_CLOSE_UNCONFIRMED');
}

/** Reopen the input on its device under a fresh binding; the caller observes the reopened position. */
async function reopenInput(
  scope: SessionScope,
  input: {
    destination: Destination;
    capture: { inputId: string; filePath: string };
    device: ReplayDeviceEntry;
    cli: RdcCliInvokerSettings;
    catalog: readonly Record<string, unknown>[];
    owner: string;
    guard: () => void;
  },
): Promise<void> {
  const { destination, capture, device, guard } = input;
  const closed = rdcSessionService.snapshotReplayForSession(scope);
  const newBinding = freezeRdcTurnBinding(input.cli, input.catalog, null);
  const prepared = await rdcSessionService.prepareAgentDevice(
    {
      projectId: scope.projectId,
      sessionId: scope.sessionId,
      deviceId: device.id,
      bindingGeneration: closed.generation,
    },
    { binding: newBinding, turnId: input.owner, assertAuthorized: guard },
  );
  if (!prepared.success)
    throw new AppError(
      'RDC_RECOVERY_DEVICE_UNAVAILABLE',
      prepared.error?.code ?? 'device preparation did not complete',
    );
  guard();
  const liveDevice = replayDeviceService.getDeviceById(device.id);
  if (
    !liveDevice ||
    liveDevice.status !== 'online' ||
    liveDevice.type !== device.type ||
    liveDevice.serial !== device.serial
  )
    throw new AppError('RDC_APPROVED_DEVICE_CHANGED');
  await rdcSessionService.openProjectInput(
    {
      projectId: scope.projectId,
      sessionId: scope.sessionId,
      inputId: capture.inputId,
      filePath: capture.filePath,
      replayDevice: liveDevice,
    },
    {
      binding: newBinding,
      expectedGeneration: prepared.state.generation,
      expectedCaptureSha256: destination.contentSha256,
    },
  );
  guard();
}

/**
 * A quarantined current context is closed only after the shared recovery admission explains its processes against
 * the last identity main verified for it. A person starts this restore, so it is not counted against an attempt budget.
 * Returns the processes a daemon-side rebuild left gone, which the close then confirms instead of stopping them.
 */
async function admitQuarantinedContext(
  scope: SessionScope,
  cli: RdcCliInvokerSettings,
  recorded: PendingBaseline['identities'],
): Promise<RdcContextProcesses | undefined> {
  const lease = getRdcContextLease(scope.sessionId);
  if (!lease?.quarantineReason) return undefined;
  const verified =
    observedRdcProcessIdentity(lease.contextId) ??
    recorded.filter((value) => value.contextId === lease.contextId).at(-1)?.processIdentity;
  const replaySessionId = lease.runtimeContext.replaySessionId;
  if (!verified || !replaySessionId)
    throw new AppError('RDC_RECOVERY_PROCESS_UNEXPLAINED', 'no verified process identity for the quarantined context.');
  const status = await readRdcContextStatus({ contextId: lease.contextId, settings: cli });
  const classification = classifyRecovery({
    verified,
    replaySessionId,
    status,
    deviceActionPending: !!rdcSessionService.snapshotReplayForSession(scope).preparation.issue?.deviceAction,
    budget: null,
    processesExited: rdcContextProcessesExited(verified),
    ownsDaemon: ownsRdcContextDaemon(lease.contextId),
  });
  lifecycleLedger.record({
    kind: 'recovery_step',
    sessionId: scope.sessionId,
    step: 'user-restore-classified',
    decision: classification.decision,
    reason: classification.reason,
    ...(classification.decision === 'quarantined' ? { errorCode: classification.code } : {}),
  });
  if (classification.decision === 'quarantined') throw new AppError(classification.code, classification.reason);
  return releaseFaultedRdcContext(lease.contextId, classification, verified);
}

async function observedPosition(scope: SessionScope): Promise<RdcLifecyclePoint | null> {
  const state = rdcSessionService.snapshotReplayForSession(scope);
  const lease = getRdcContextLease(scope.sessionId);
  if (!state.contextId && !lease && !rdcSessionService.snapshotOpenedCaptureForSession(scope)) return null;
  // A quarantined context can be closed by this explicit user action, but cannot be claimed as an observed position.
  if (lease?.quarantineReason || state.phase === 'error') return null;
  const owner = assertRdcContextLeaseOwnership(scope);
  const opened = rdcSessionService.snapshotOpenedCaptureForSession(scope);
  const binding = rdcSessionService.recoveryBinding(scope);
  if (
    !owner ||
    !opened ||
    !binding ||
    state.phase !== 'ready' ||
    !state.inputId ||
    !state.captureHash ||
    !state.replayDeviceId ||
    !state.observation ||
    state.contextId !== owner.contextId ||
    opened.contextId !== owner.contextId ||
    opened.inputId !== state.inputId
  ) {
    throw new AppError('RDC_RECOVERY_IDENTITY_UNVERIFIED');
  }
  const native = await readRdcSwitchSnapshot({ ...scope, binding });
  if (native.eventId !== state.appliedEventId) throw new AppError('RDC_RECOVERY_IDENTITY_UNVERIFIED');
  return {
    inputId: state.inputId,
    contentSha256: state.captureHash,
    deviceId: state.replayDeviceId,
    native,
    target: state.target,
    isFinalOutput: state.isFinalOutput,
  };
}

function assertPriorProcessesReleased(
  pending: NonNullable<ReturnType<typeof rdcLifecycleReceipts.pending>>,
  currentContext: string | null,
): void {
  if (listOwnedRdcDaemons().some((record) => record.ownerPid !== process.pid))
    throw new AppError('RDC_RECOVERY_OLD_OWNER_UNCONFIRMED');
  for (const identity of pending.identities) {
    if (identity.stopped || identity.contextId === currentContext) continue;
    // pid + birth: a reused pid is a different process, and an unreadable identity is never proof of exit.
    for (const birth of [identity.processIdentity.daemon, identity.processIdentity.worker]) {
      if (probeProcess({ pid: birth.pid, birth: birth.start_generation }) === 'exited') continue;
      throw new AppError('RDC_RECOVERY_OLD_PROCESS_UNCONFIRMED', 'an earlier daemon or worker may still be alive.');
    }
  }
}
