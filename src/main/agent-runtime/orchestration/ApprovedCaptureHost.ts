import path from 'node:path';
import type { ExecutionOffer } from '@shared/types/executionOffer';
import type { InvestigationPlanContract } from '@shared/types/planInvestigation';
import type { ExperimentRecord } from '@shared/types/renderdocInvestigation';
import { assertRdcContextLeaseOwnership, getDelegatedChildSessionId, getRdcContextLease, quarantineRdcContext } from '../../rdc/RdcRuntimeContextRegistry';
import { rdcCliInvokerService } from '../../rdc/RdcCliInvokerService';
import { rdcLifecycleReceipts, type RdcLifecyclePoint } from '../../rdc/RdcLifecycleReceipts';
import { readRdcRecoverySnapshot, readRdcSwitchSnapshot } from '../../rdc/RdcSwitchSnapshot';
import { ownsRdcInteractionLock } from '../../rdc/RdcOperationCoordinator';
import { selectedProbeDeviceId } from '../../rdc/RdcProbeLifecycle';
import { replayDeviceService } from '../../rdc/captures/ReplayDeviceService';
import { rdcSessionService } from '../../sessions';
import { storageAdapter } from '../../sessions/store/StorageAdapter';
import { planArtifactWriter } from '../../sessions/run/sessionPlanArtifact';
import { approvedInvestigationContract } from '../../sessions/run/approvedInvestigationContract';
import { assertApprovedExecutionCurrent } from '../../sessions/run/handoffSkills';
import { verifyPlanInput } from '../../sessions/run/prepareInvestigationPlan';
import { investigationArtifactService } from '../../investigation/InvestigationArtifactService';
import { runtimePermissionStateService } from '../permissions/RuntimePermissionStateService';
import { TaskRegistry, createSessionTaskStore } from '../tasks';
import { listActiveDelegations } from './DirectTaskTurnLifecycle';
import { prepareRdcRuntimeEpoch } from './RdcRuntimeReprepare';
import { joinFaultedRdcChild } from './RdcRecoveryChildren';
import type { TurnHandle } from './TurnCoordinator';
import type { ApprovedCaptureHost } from './ApprovedCaptureController';

type Destination = { inputId: string; contentSha256: string; deviceId: string };
const equalPath = (a: string, b: string) => process.platform === 'win32'
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

/** Concrete main-process adapter; every destination is re-resolved from the owning project. */
export function createApprovedCaptureHost(input: {
  sessionId: string; projectId: string; offer: ExecutionOffer;
  contract: InvestigationPlanContract; turn: TurnHandle;
}): ApprovedCaptureHost {
  const scope = { sessionId: input.sessionId, projectId: input.projectId };
  const captureScope = input.contract.captureScope;
  if (!captureScope || captureScope.projectId !== input.projectId || input.offer.targetAgentId !== 'general') {
    throw new Error('RDC_CAPTURE_SCOPE_INVALID: an approved owning General capture scope is required.');
  }
  const assertOwningTurn = () => {
    if (!input.turn.isLive(input.turn.generation) || !ownsRdcInteractionLock(input.sessionId, input.turn.turnId)) {
      throw new Error('RDC_CAPTURE_OWNER_INVALID: the owning active turn lock is required.');
    }
  };
  const assertPlan = () => {
    assertOwningTurn();
    assertApprovedExecutionCurrent(input.sessionId, 'general', input.offer);
    const markdown = planArtifactWriter.readMarkdown(input.sessionId, input.offer.plan.uri, input.offer.plan.hash).markdown;
    const current = approvedInvestigationContract(input.offer, markdown);
    if (JSON.stringify(current) !== JSON.stringify(input.contract)) throw new Error('APPROVED_PLAN_CHANGED: capture scope changed after preparation.');
  };
  const project = () => {
    if (storageAdapter.readSession(input.sessionId)?.projectId !== input.projectId) throw new Error('RDC_CAPTURE_OWNER_INVALID');
    const value = storageAdapter.getProjectById(input.projectId);
    if (!value) throw new Error('RDC_CAPTURE_PROJECT_MISSING');
    return value;
  };
  const resolve = async (destination: Destination) => {
    assertOwningTurn();
    const value = project();
    const capture = value.inputs.find(item => item.inputId === destination.inputId);
    if (!capture || capture.contentSha256 !== destination.contentSha256 || destination.deviceId !== captureScope.deviceId
      || await verifyPlanInput(value, capture) !== destination.contentSha256) throw new Error('RDC_APPROVED_CAPTURE_CHANGED: the registered input no longer matches its frozen bytes.');
    const state = rdcSessionService.snapshotReplayForSession(scope);
    if (selectedProbeDeviceId(state) !== destination.deviceId) throw new Error('RDC_APPROVED_DEVICE_CHANGED');
    const device = replayDeviceService.getDeviceById(destination.deviceId);
    if (!device || device.status !== 'online') throw new Error('RDC_APPROVED_DEVICE_UNAVAILABLE');
    assertOwningTurn();
    return { capture, device };
  };
  return {
    assertPlan,
    assertNoPendingRecovery() {
      if (rdcLifecycleReceipts.pending(input.sessionId, input.projectId)) {
        throw new Error('RDC_PREVIOUS_RESTORE_REQUIRED: restore the previous investigation position through Capture first.');
      }
    },
    prepareReceipts: () => rdcLifecycleReceipts.prepare(),
    async quiescent(mode) {
      assertOwningTurn();
      if (getDelegatedChildSessionId(input.sessionId) || (mode !== 'recovery' && (await listActiveDelegations(input.sessionId)).length)) {
        throw new Error('RDC_SWITCH_CHILD_ACTIVE: join delegated executions before changing capture.');
      }
      const entries = investigationArtifactService.list(input.sessionId, { kind: 'experiment' });
      for (const entry of entries.filter(value => value.status === 'ready' || value.status === 'draft')) {
        const record = investigationArtifactService.readRecord(input.sessionId, entry.artifactId).record as ExperimentRecord;
        if (record.status === 'running' || record.status === 'polluted') {
          throw new Error(`RDC_SWITCH_EXPERIMENT_OPEN: close experiment ${record.experimentId} before changing capture.`);
        }
      }
    },
    async snapshot(binding, signal) {
      assertOwningTurn();
      const state = rdcSessionService.snapshotReplayForSession(scope);
      const lease = getRdcContextLease(input.sessionId);
      const opened = rdcSessionService.snapshotOpenedCaptureForSession(scope);
      if (!lease && !opened && !binding.identity && !state.inputId) return null;
      if (!lease || !opened || !binding.identity || state.phase !== 'ready' || !state.inputId || !state.captureHash
        || !state.replayDeviceId || !state.observation || opened.status !== 'open' || opened.inputId !== state.inputId
        || opened.deviceId !== state.replayDeviceId || lease.runtimeContext.deviceId !== state.replayDeviceId
        || opened.contextId !== lease.contextId || opened.captureFileId !== lease.runtimeContext.captureFileId
        || opened.replaySessionId !== lease.runtimeContext.replaySessionId) throw new Error('RDC_SWITCH_STATE_UNVERIFIED: current replay projection is incomplete or inconsistent.');
      const destination = { inputId: state.inputId, contentSha256: state.captureHash, deviceId: state.replayDeviceId };
      const resolved = await resolve(destination);
      if (!equalPath(opened.filePath, resolved.capture.filePath)) throw new Error('RDC_SWITCH_STATE_UNVERIFIED: opened capture path differs from the registered input.');
      const native = await readRdcSwitchSnapshot({ ...scope, binding, signal });
      assertOwningTurn();
      if (native.eventId !== state.appliedEventId) throw new Error('RDC_SWITCH_STATE_UNVERIFIED: native and displayed event positions differ.');
      return { ...destination, native, target: state.target, isFinalOutput: state.isFinalOutput } satisfies RdcLifecyclePoint;
    },
    async verifyDestination(destination) { await resolve(destination); },
    async open(destination, binding, signal, onStopped) {
      const { capture, device } = await resolve(destination);
      assertPlan();
      const state = rdcSessionService.snapshotReplayForSession(scope);
      await rdcSessionService.openProjectInput({ ...scope, inputId: capture.inputId, filePath: capture.filePath, replayDevice: device }, {
        binding, signal, expectedGeneration: state.generation, expectedCaptureSha256: destination.contentSha256,
        onDaemonStopped: receipt => onStopped(receipt.contextId),
      });
    },
    async close(binding, signal, onStopped) {
      assertPlan();
      const state = rdcSessionService.snapshotReplayForSession(scope);
      if (!await rdcSessionService.clearOpenedCaptureForSession(scope, { binding, signal, expectedGeneration: state.generation,
        onDaemonStopped: receipt => onStopped(receipt.contextId) })) throw new Error('RDC_RESTORE_CLOSE_UNCONFIRMED');
    },
    async restorePosition(point, binding, signal) {
      assertPlan();
      const state = rdcSessionService.snapshotReplayForSession(scope);
      await rdcSessionService.restoreAgentPosition({ ...scope, bindingGeneration: state.generation, eventId: point.native.eventId,
        target: point.target, isFinalOutput: point.isFinalOutput }, { binding, turnId: input.turn.turnId, signal });
    },
    recoveryGuard(expectedRevision) {
      assertPlan();
      return () => {
        assertPlan();
        if (runtimePermissionStateService.getSnapshot().revision !== expectedRevision) throw new Error('RDC_RECOVERY_PERMISSION_CHANGED');
      };
    },
    async joinRecoveryChild(signal) { await joinFaultedRdcChild(input.sessionId, input.turn, signal); },
    async inspectRecovery(point, binding, signal) {
      assertPlan();
      const lease = getRdcContextLease(input.sessionId);
      const state = rdcSessionService.snapshotReplayForSession(scope);
      const opened = rdcSessionService.snapshotOpenedCaptureForSession(scope);
      if (!lease?.quarantineReason || !lease.quarantineCause || lease.contextId !== point.native.contextId
        || lease.version !== point.native.leaseVersion || lease.runtimeContext.replaySessionId !== point.native.replaySessionId
        || lease.runtimeContext.captureFileId !== point.native.captureFileId || state.inputId !== point.inputId
        || state.captureHash !== point.contentSha256 || state.replayDeviceId !== point.deviceId || state.preparation.issue?.deviceAction
        || !opened || opened.inputId !== point.inputId || opened.contextId !== lease.contextId) {
        throw new Error('RDC_RECOVERY_IDENTITY_UNVERIFIED: the current failure does not match the last verified capture.');
      }
      const resolved = await resolve(destinationOf(point));
      if (!equalPath(opened.filePath, resolved.capture.filePath)) throw new Error('RDC_RECOVERY_IDENTITY_UNVERIFIED: input path changed.');
      const observed = await readRdcRecoverySnapshot({ ...scope, binding, signal });
      if (observed.contextId !== point.native.contextId || observed.leaseVersion !== point.native.leaseVersion
        || observed.replaySessionId !== point.native.replaySessionId || observed.captureFileId !== point.native.captureFileId
        || JSON.stringify(observed.processIdentity) !== JSON.stringify(point.native.processIdentity)) {
        throw new Error('RDC_RECOVERY_PROCESS_CHANGED: the live daemon or worker is not the last verified process.');
      }
      return { cause: lease.quarantineCause, observed };
    },
    async reopenAfterFailure(destination, binding, signal, onStopped, guard) {
      guard();
      const { capture, device } = await resolve(destination);
      const old = rdcSessionService.snapshotReplayForSession(scope);
      if (!await rdcSessionService.clearOpenedCaptureForSession(scope, { binding, signal, expectedGeneration: old.generation,
        onDaemonStopped: receipt => onStopped(receipt.contextId) })) throw new Error('RDC_RECOVERY_CLOSE_UNCONFIRMED');
      guard(); signal?.throwIfAborted();
      const closed = rdcSessionService.snapshotReplayForSession(scope);
      const prepared = await rdcSessionService.prepareAgentDevice({ ...scope, deviceId: device.id, bindingGeneration: closed.generation },
        { binding, turnId: input.turn.turnId, signal, assertAuthorized: guard });
      if (!prepared.success) throw new Error(`RDC_RECOVERY_DEVICE_UNAVAILABLE: ${prepared.error?.code ?? 'device preparation did not complete'}`);
      guard(); signal?.throwIfAborted();
      const currentDevice = replayDeviceService.getDeviceById(device.id);
      if (!currentDevice || currentDevice.status !== 'online' || currentDevice.type !== device.type || currentDevice.serial !== device.serial) {
        throw new Error('RDC_APPROVED_DEVICE_CHANGED');
      }
      await rdcSessionService.openProjectInput({ ...scope, inputId: capture.inputId, filePath: capture.filePath, replayDevice: currentDevice }, {
        binding, signal, expectedGeneration: prepared.state.generation, expectedCaptureSha256: destination.contentSha256,
      });
      guard();
    },
    async reprepare(previous, signal) {
      assertPlan();
      signal?.throwIfAborted();
      assertOwningTurn();
      const lease = getRdcContextLease(input.sessionId);
      if (lease && !assertRdcContextLeaseOwnership(scope)) throw new Error('RDC_REPREPARE_OWNER_INVALID');
      const catalog = lease ? (await rdcCliInvokerService.loadCatalog(previous.binding.cli, true)).tools : previous.binding.definitions;
      signal?.throwIfAborted();
      const after = getRdcContextLease(input.sessionId);
      if ((lease?.version ?? null) !== (after?.version ?? null) || (lease?.contextId ?? null) !== (after?.contextId ?? null)) {
        throw new Error('RDC_REPREPARE_OWNER_INVALID: lease changed during catalog verification.');
      }
      return prepareRdcRuntimeEpoch({ ...scope, permissionRevision: runtimePermissionStateService.getSnapshot().revision,
        previousPlan: previous.plan, previousPrompt: previous.prompt, previousBinding: previous.binding, lease, catalog });
    },
    async appendEpoch(epoch) {
      await new TaskRegistry(createSessionTaskStore(input.sessionId)).appendRuntimeEpochForTurn(input.turn.turnId, input.turn.generation, epoch);
    },
    writeReceipt: receipt => rdcLifecycleReceipts.write(receipt),
    quarantineChanged(previous, _reason, force) {
      const lease = getRdcContextLease(input.sessionId);
      if (lease && (force || !previous || lease.contextId !== previous.native.contextId || lease.version !== previous.native.leaseVersion)) {
        quarantineRdcContext(input.sessionId, lease.version, 'Capture transition did not finish with verified identity and receipts.');
      }
    },
  };
}

function destinationOf(point: RdcLifecyclePoint): Destination {
  return { inputId: point.inputId, contentSha256: point.contentSha256, deviceId: point.deviceId };
}
