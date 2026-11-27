import { AppError } from '@shared/errors/appError';
import { samePath } from '../../platform/paths';
import {
  assertRdcContextLeaseOwnership,
  getDelegatedChildSessionId,
  getRdcContextLease,
  quarantinedRdcContextLease,
  registerRdcFault,
} from '../../rdc/RdcRuntimeContextRegistry';
import { rdcCliInvokerService } from '../../rdc/RdcCliInvokerService';
import { rdcLifecycleReceipts, type RdcLifecyclePoint } from '../../rdc/RdcLifecycleReceipts';
import { readRdcSwitchSnapshot } from '../../rdc/RdcSwitchSnapshot';
import { ownsRdcInteractionLock } from '../../rdc/RdcOperationCoordinator';
import { selectedProbeDeviceId } from '../../rdc/RdcProbeLifecycle';
import { replayDeviceService } from '../../rdc/captures/ReplayDeviceService';
import { rdcSessionService } from '../../rdc/RdcSessionService';
import { projectWorkspaceStore, sessionRecordStore } from '../../sessions/store/sessionStores';
import { planArtifactWriter } from '../../sessions/run/sessionPlanArtifact';
import { approvedInvestigationContract } from '../../sessions/run/approvedInvestigationContract';
import { assertApprovedExecutionCurrent } from '../../sessions/run/handoffSkills';
import { verifyPlanInput } from '../../rdc/prepareInvestigationPlan';
import { investigationArtifactService } from '../../investigation/InvestigationArtifactService';
import { runtimePermissionStateService } from '../../runtime/RuntimePermissionStateService';
import { TaskRegistry, createSessionTaskStore } from '../tasks';
import { listActiveDelegations } from './DirectTaskTurnLifecycle';
import { prepareRdcRuntimeEpoch } from './RdcRuntimeReprepare';
import { joinFaultedRdcChild } from './RdcRecoveryChildren';
import { inspectQuarantinedCapture, reopenQuarantinedCapture } from './ApprovedCaptureRecovery';
import type { ExperimentRecord } from '@shared/types/renderdocInvestigation';
import type { InvestigationPlanContract } from '../../sessions/run/investigationPlanContract';
import type { ExecutionOffer } from '../../sessions/run/executionOffer';
import type { TurnHandle } from './TurnCoordinator';
import type { ApprovedCaptureHost } from './ApprovedCaptureController';

type Destination = { inputId: string; contentSha256: string; deviceId: string };

/** Concrete main-process adapter; every destination is re-resolved from the owning project. */
export function createApprovedCaptureHost(input: {
  sessionId: string;
  projectId: string;
  offer: ExecutionOffer;
  contract: InvestigationPlanContract;
  turn: TurnHandle;
}): ApprovedCaptureHost {
  const scope = { sessionId: input.sessionId, projectId: input.projectId };
  const captureScope = input.contract.captureScope;
  if (!captureScope || captureScope.projectId !== input.projectId || input.offer.targetAgentId !== 'general') {
    throw new AppError('RDC_CAPTURE_SCOPE_INVALID', 'an approved owning General capture scope is required.');
  }
  const assertOwningTurn = () => {
    if (!input.turn.isLive(input.turn.generation) || !ownsRdcInteractionLock(input.sessionId, input.turn.turnId)) {
      throw new AppError('RDC_CAPTURE_OWNER_INVALID', 'the owning active turn lock is required.');
    }
  };
  const assertPlan = () => {
    assertOwningTurn();
    assertApprovedExecutionCurrent(input.sessionId, 'general', input.offer);
    const markdown = planArtifactWriter.readMarkdown(
      input.sessionId,
      input.offer.plan.uri,
      input.offer.plan.hash,
    ).markdown;
    const current = approvedInvestigationContract(input.offer, markdown);
    if (JSON.stringify(current) !== JSON.stringify(input.contract))
      throw new AppError('APPROVED_PLAN_CHANGED', 'capture scope changed after preparation.');
  };
  const project = () => {
    if (sessionRecordStore.readSession(input.sessionId)?.projectId !== input.projectId)
      throw new AppError('RDC_CAPTURE_OWNER_INVALID');
    const value = projectWorkspaceStore.getProjectById(input.projectId);
    if (!value) throw new AppError('RDC_CAPTURE_PROJECT_MISSING');
    return value;
  };
  const resolve = async (destination: Destination) => {
    assertOwningTurn();
    const value = project();
    const capture = value.inputs.find((item) => item.inputId === destination.inputId);
    if (
      !capture ||
      capture.contentSha256 !== destination.contentSha256 ||
      destination.deviceId !== captureScope.deviceId ||
      (await verifyPlanInput(value, capture)) !== destination.contentSha256
    )
      throw new AppError('RDC_APPROVED_CAPTURE_CHANGED', 'the registered input no longer matches its frozen bytes.');
    const state = rdcSessionService.snapshotReplayForSession(scope);
    if (selectedProbeDeviceId(state) !== destination.deviceId) throw new AppError('RDC_APPROVED_DEVICE_CHANGED');
    const device = replayDeviceService.getDeviceById(destination.deviceId);
    if (!device || device.status !== 'online') throw new AppError('RDC_APPROVED_DEVICE_UNAVAILABLE');
    assertOwningTurn();
    return { capture, device };
  };
  return {
    assertPlan,
    pendingRecord: () => rdcLifecycleReceipts.pending(input.sessionId, input.projectId),
    quarantinedContext() {
      const lease = quarantinedRdcContextLease(scope);
      return lease ? { contextId: lease.contextId, leaseVersion: lease.version } : null;
    },
    prepareReceipts: () => rdcLifecycleReceipts.prepare(),
    async quiescent(mode) {
      assertOwningTurn();
      if (
        getDelegatedChildSessionId(input.sessionId) ||
        (mode !== 'recovery' && (await listActiveDelegations(input.sessionId)).length)
      ) {
        throw new AppError('RDC_SWITCH_CHILD_ACTIVE', 'join delegated executions before changing capture.');
      }
      const open = openExperiments(input.sessionId);
      // Recovery cannot wait for the model to close them: they are interrupted by the replay process itself.
      if (open.length && mode !== 'recovery')
        throw new AppError(
          'RDC_SWITCH_EXPERIMENT_OPEN',
          `close experiment ${open[0]!.experimentId} before changing capture.`,
        );
      return { openExperiments: open };
    },
    async snapshot(binding, signal) {
      const state = await rdcSessionService.currentAgentObservation(scope, binding.cli);
      assertOwningTurn();
      const lease = getRdcContextLease(input.sessionId);
      const opened = rdcSessionService.snapshotOpenedCaptureForSession(scope);
      if (!lease && !opened && !binding.identity && !state.inputId) return null;
      if (
        !lease ||
        !opened ||
        !binding.identity ||
        state.phase !== 'ready' ||
        !state.inputId ||
        !state.captureHash ||
        !state.replayDeviceId ||
        !state.observation ||
        opened.status !== 'open' ||
        opened.inputId !== state.inputId ||
        opened.deviceId !== state.replayDeviceId ||
        lease.runtimeContext.deviceId !== state.replayDeviceId ||
        opened.contextId !== lease.contextId ||
        opened.captureFileId !== lease.runtimeContext.captureFileId ||
        opened.replaySessionId !== lease.runtimeContext.replaySessionId
      )
        throw new AppError('RDC_SWITCH_STATE_UNVERIFIED', 'current replay projection is incomplete or inconsistent.');
      const destination = { inputId: state.inputId, contentSha256: state.captureHash, deviceId: state.replayDeviceId };
      const resolved = await resolve(destination);
      if (!samePath(opened.filePath, resolved.capture.filePath))
        throw new AppError('RDC_SWITCH_STATE_UNVERIFIED', 'opened capture path differs from the registered input.');
      const native = await readRdcSwitchSnapshot({ ...scope, binding, signal });
      assertOwningTurn();
      if (native.eventId !== state.appliedEventId)
        throw new AppError('RDC_SWITCH_STATE_UNVERIFIED', 'native and displayed event positions differ.');
      return {
        ...destination,
        native,
        target: state.target,
        isFinalOutput: state.isFinalOutput,
      } satisfies RdcLifecyclePoint;
    },
    async verifyDestination(destination) {
      await resolve(destination);
    },
    async open(destination, binding, signal, onStopped) {
      const { capture, device } = await resolve(destination);
      assertPlan();
      const state = rdcSessionService.snapshotReplayForSession(scope);
      await rdcSessionService.openProjectInput(
        { ...scope, inputId: capture.inputId, filePath: capture.filePath, replayDevice: device },
        {
          binding,
          signal,
          expectedGeneration: state.generation,
          expectedCaptureSha256: destination.contentSha256,
          onDaemonStopped: (receipt) => onStopped(receipt.contextId),
        },
      );
    },
    async close(binding, signal, onStopped) {
      assertPlan();
      const state = rdcSessionService.snapshotReplayForSession(scope);
      if (
        !(await rdcSessionService.clearOpenedCaptureForSession(scope, {
          binding,
          signal,
          expectedGeneration: state.generation,
          onDaemonStopped: (receipt) => onStopped(receipt.contextId),
        }))
      )
        throw new AppError('RDC_RESTORE_CLOSE_UNCONFIRMED');
    },
    async restorePosition(point, binding, signal) {
      assertPlan();
      const state = rdcSessionService.snapshotReplayForSession(scope);
      await rdcSessionService.restoreAgentPosition(
        {
          ...scope,
          bindingGeneration: state.generation,
          eventId: point.native.eventId,
          target: point.target,
          isFinalOutput: point.isFinalOutput,
        },
        { binding, turnId: input.turn.turnId, signal },
      );
    },
    recoveryGuard(expectedRevision) {
      assertPlan();
      return () => {
        assertPlan();
        if (runtimePermissionStateService.getSnapshot().revision !== expectedRevision)
          throw new AppError('RDC_RECOVERY_PERMISSION_CHANGED');
      };
    },
    async joinRecoveryChild(signal) {
      await joinFaultedRdcChild(input.sessionId, input.turn, signal);
    },
    async inspectRecovery(point, binding, signal) {
      assertPlan();
      return inspectQuarantinedCapture({ ...scope, point, binding, signal, resolve });
    },
    async reopenAfterFailure(destination, binding, signal, onStopped, guard) {
      guard();
      const resolved = await resolve(destination);
      await reopenQuarantinedCapture({
        ...scope,
        turnId: input.turn.turnId,
        destination,
        resolved,
        binding,
        signal,
        onStopped,
        guard,
      });
    },
    async reprepare(previous, signal) {
      assertPlan();
      signal?.throwIfAborted();
      assertOwningTurn();
      const lease = getRdcContextLease(input.sessionId);
      if (lease && !assertRdcContextLeaseOwnership(scope)) throw new AppError('RDC_REPREPARE_OWNER_INVALID');
      const catalog = lease
        ? (await rdcCliInvokerService.loadCatalog(previous.binding.cli, true)).tools
        : previous.binding.definitions;
      signal?.throwIfAborted();
      const after = getRdcContextLease(input.sessionId);
      if (
        (lease?.version ?? null) !== (after?.version ?? null) ||
        (lease?.contextId ?? null) !== (after?.contextId ?? null)
      ) {
        throw new AppError('RDC_REPREPARE_OWNER_INVALID', 'lease changed during catalog verification.');
      }
      return prepareRdcRuntimeEpoch({
        ...scope,
        permissionRevision: runtimePermissionStateService.getSnapshot().revision,
        previousPlan: previous.plan,
        previousPrompt: previous.prompt,
        previousBinding: previous.binding,
        lease,
        catalog,
      });
    },
    async appendEpoch(epoch) {
      await new TaskRegistry(createSessionTaskStore(input.sessionId)).appendRuntimeEpochForTurn(
        input.turn.turnId,
        input.turn.generation,
        epoch,
      );
    },
    writeReceipt: (receipt) => rdcLifecycleReceipts.write(receipt),
    quarantineChanged(previous, failure, force) {
      const lease = getRdcContextLease(input.sessionId);
      if (
        lease &&
        (force ||
          !previous ||
          lease.contextId !== previous.native.contextId ||
          lease.version !== previous.native.leaseVersion)
      ) {
        registerTransitionFault(input.sessionId, lease.version, previous, failure.cause);
      }
    },
  };
}

/** Experiments the model left running or polluted on the current replay. */
function openExperiments(sessionId: string): Array<{ experimentId: string; status: 'running' | 'polluted' }> {
  return investigationArtifactService
    .list(sessionId, { kind: 'experiment' })
    .filter((value) => value.status === 'ready' || value.status === 'draft')
    .map((entry) => investigationArtifactService.readRecord(sessionId, entry.artifactId).record as ExperimentRecord)
    .filter(
      (record): record is ExperimentRecord & { status: 'running' | 'polluted' } =>
        record.status === 'running' || record.status === 'polluted',
    )
    .map((record) => ({ experimentId: record.experimentId, status: record.status }));
}

/** A capture transition that did not finish verified leaves its owning lease uncertain. */
function registerTransitionFault(
  sessionId: string,
  expectedVersion: number,
  previous: RdcLifecyclePoint | null,
  cause: string,
): void {
  registerRdcFault({
    sessionId,
    expectedVersion,
    operation: 'capture_transition',
    nativeArgs: previous ? destinationOf(previous) : null,
    cause,
    reason: 'Capture transition did not finish with verified identity and receipts.',
  });
}

function destinationOf(point: RdcLifecyclePoint): Destination {
  return { inputId: point.inputId, contentSha256: point.contentSha256, deviceId: point.deviceId };
}
