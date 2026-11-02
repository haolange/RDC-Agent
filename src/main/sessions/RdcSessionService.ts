import type { RdcCliInvokerSettings } from '@shared/types/settings';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { DevicePreparationRequest, DevicePreparationResult } from '@shared/types/captureReplay';
import type { ReplayDeviceIssue } from '@shared/types/device';
import { replayDeviceService } from '../captures/ReplayDeviceService';
import { replayDeviceIssue, deviceInstallationIdentity, type DeviceInstallationIdentity } from '../captures/ReplayDeviceIssue';
import { RdcNativeFailure } from '../tools/RdcNativeProtocol';
import { ipcApprovalTokenService } from '../ipc/validation/IpcApprovalTokenService';
import { configuredRemotePreparationIdentity } from './RdcRemoteConnection';
import { storageAdapter } from './StorageAdapter';
import { replayHistoryStore } from '../captures/replay/ReplayHistoryStore';
import { hashCaptureFile } from '../captures/replay/captureContentHash';
import { verifyExternalCaptureReference } from '../captures/ExternalCaptureReference';
import type { SessionScope, OpenProjectInputRequest, OpenedCaptureState } from '@shared/types/session';
import type { CaptureReplayState, CaptureReplayApplyRequest, CaptureReplayBindingRequest } from '@shared/types/captureReplay';
import { RdcSessionRuntime, type RdcLifecycleOptions } from './RdcSessionRuntime';
import { getDelegatedChildSessionId, getRdcContextLease } from './RdcRuntimeContextRegistry';
import { shellInvocationService } from '../tools/ShellInvocationService';
import { beginRdcLifecycle, getRdcInteractionLock, runRdcOperation, subscribeRdcInteractionLock } from './RdcOperationCoordinator';
import { harvestOwnedRdcDaemons } from './OwnedRdcDaemonRegistry';
import { replayLivePreviewStore } from '../captures/replay/ReplayLivePreviewStore';
import { observeReplay, readReplayEvents } from './RdcReplayObservation';

const keyOf = (scope: SessionScope) => JSON.stringify([scope.projectId, scope.sessionId]);
interface Binding { runtime: RdcSessionRuntime; state: CaptureReplayState; deviceId: string | null;
  installationEvidence?: DeviceInstallationIdentity & { bindingIdentity: string };
  preparation?: { deviceId: string; baseGeneration: number; controller: AbortController; pending: Promise<DevicePreparationResult> };
  confirmation?: { token: string; name: string; generation: number; deviceId: string; kind: 'close_capture' | 'repair'; issue?: ReplayDeviceIssue; bindingIdentity?: string };
}
const empty = (scope: SessionScope): CaptureReplayState => ({ ...scope, generation: 0, revision: 0, operationId: null,
  phase: 'closed', preparation: { targetDeviceId: null, phase: 'idle', issue: null }, replayDeviceId: null, inputId: null, captureHash: null, contextId: null,
  requestedEventId: null, appliedEventId: null, imageEventId: null, events: [], targets: [], target: null,
  isFinalOutput: false, image: null, observation: null, devicePresentation: { status: 'not_applicable', eventId: null, textureId: null, sequence: null, reason: null }, warning: null, interactionLock: null, error: null });

/** Per-session application ownership. Device reservations survive uncertain native close. */
export class RdcSessionService {
  private readonly bindings = new Map<string, Binding>();
  private readonly blockedInputs = new Set<string>();
  private readonly devices = new Map<string, string>();
  private readonly listeners = new Set<(state: CaptureReplayState) => void>();
  private readonly lifecycle = new Map<string, Promise<unknown>>();
  constructor() {
    subscribeRdcInteractionLock(sessionId => {
      for (const binding of this.bindings.values()) if (binding.state.sessionId === sessionId) this.publish(binding, {});
    });
    replayDeviceService.subscribe(snapshot => {
      for (const binding of this.bindings.values()) {
        if (!binding.deviceId || !['ready', 'checking', 'installing', 'starting', 'verifying'].includes(binding.state.preparation.phase)) continue;
        if (binding.state.preparation.targetDeviceId !== binding.deviceId) continue;
        const device = snapshot.devices.find(value => value.id === binding.deviceId);
        // A failed discovery query is not evidence that an existing connection disappeared.
        if (device && !['missing', 'offline', 'unauthorized'].includes(device.adbState ?? 'unknown')) continue;
        binding.preparation?.controller.abort(); this.revokePreparationConfirmation(binding);
        if (binding.state.preparation.issue?.deviceAction) {
          // Discovery can cancel verification, but cannot settle a device-side package mutation.
          this.publish(binding, { preparation: { ...binding.state.preparation, phase: 'failed' } });
          continue;
        }
        const issue: ReplayDeviceIssue = { code: device?.adbState === 'unauthorized' ? 'remote_unauthorized' : 'remote_device_offline',
          stage: 'checking', diagnostic: 'The selected ADB device is no longer available.', recovery: 'retry' };
        this.publish(binding, { preparation: { ...binding.state.preparation, phase: 'failed', issue },
          ...(binding.state.inputId ? { phase: 'error' as const, image: null, observation: null, imageEventId: null,
            error: { code: issue.code, message: issue.diagnostic, retry: 'close' as const, issue } } : {}) });
        // A live Agent/native owner retains its reservation until its normal cancellation/join has settled.
        if (!this.lock(binding)) void this.serial(binding.state, async () => {
          try { await this.closeBinding(binding.state, binding, {}); this.publish(binding, { contextId: null }); }
          catch (error) { this.publish(binding, { preparation: { ...binding.state.preparation, phase: 'failed',
            issue: binding.state.preparation.issue?.deviceAction ? binding.state.preparation.issue : replayDeviceIssue(error) } }); }
        });
      }
    });
  }
  subscribe(listener: (state: CaptureReplayState) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  getDeviceOwner(deviceId: string): SessionScope | null {
    const key = this.devices.get(deviceId);
    if (!key) return null;
    const [projectId, sessionId] = JSON.parse(key) as [string, string];
    return { projectId, sessionId };
  }
  private binding(scope: SessionScope): Binding {
    if (!scope.sessionId?.trim() || !scope.projectId?.trim()) throw new Error('RDC_SCOPE_REQUIRED');
    const key = keyOf(scope); let binding = this.bindings.get(key);
    if (!binding) { binding = { runtime: new RdcSessionRuntime(), state: empty(scope), deviceId: null }; this.bindings.set(key, binding); }
    return binding;
  }
  private lock(binding: Binding): string | null {
    const contextId = binding.runtime.getContextId();
    return getRdcInteractionLock(binding.state.sessionId)
      ?? (getDelegatedChildSessionId(binding.state.sessionId) ? 'delegated_execution' : null)
      ?? (contextId && shellInvocationService.hasUnconfirmedProcesses(contextId) ? 'native_exit_unconfirmed' : null);
  }
  private assertInteraction(binding: Binding, options: RdcLifecycleOptions = {}): void {
    // Frozen probe lifecycle runs inside the owning Agent execution, not a human command.
    const lock = this.lock(binding);
    if (lock && !(options.binding && lock === 'agent_running')) throw new Error(`RDC_INTERACTION_LOCKED: ${lock}`);
  }
  private assertGeneration(binding: Binding, expected: number | undefined): void {
    if (expected !== undefined && binding.state.generation !== expected) throw new Error('RDC_BINDING_CHANGED: refresh the current capture state.');
  }
  private assertPreparationGeneration(binding: Binding, expected: number, confirmed = false): void {
    if (!confirmed && binding.preparation && expected >= binding.preparation.baseGeneration && expected <= binding.state.generation) return;
    this.assertGeneration(binding, expected);
  }
  private assertReplayAvailable(binding: Binding): void {
    if (getRdcContextLease(binding.state.sessionId)?.quarantineReason) {
      this.publish(binding, { phase: 'error', error: { code: 'RDC_CONTEXT_QUARANTINED', message: 'Replay outcome is uncertain; close and reopen the capture.', retry: 'close' } });
      throw new Error('RDC_CONTEXT_QUARANTINED');
    }
    if (!['ready', 'applying'].includes(binding.state.phase)) throw new Error('RDC_REPLAY_BUSY');
  }
  private publish(binding: Binding, patch: Partial<CaptureReplayState>): void {
    if (['ready', 'applying'].includes(patch.phase ?? binding.state.phase)
      && getRdcContextLease(binding.state.sessionId)?.quarantineReason) {
      patch = { ...patch, phase: 'error', devicePresentation: undefined,
        error: { code: 'RDC_CONTEXT_QUARANTINED', message: 'Replay outcome is uncertain; close and reopen the capture.', retry: 'close' } };
    }
    if (!patch.devicePresentation && (patch.error || (patch.phase && patch.phase !== 'ready'))) {
      patch.devicePresentation = binding.deviceId
        ? { status: 'unavailable', eventId: null, textureId: null, sequence: null, reason: patch.error?.code ?? 'observation_pending' }
        : { status: 'not_applicable', eventId: null, textureId: null, sequence: null, reason: null };
    }
    binding.state = { ...binding.state, ...patch, revision: binding.state.revision + 1, interactionLock: this.lock(binding) };
    for (const listener of this.listeners) listener(structuredClone(binding.state));
  }
  private serial<T>(scope: SessionScope, fn: () => Promise<T>): Promise<T> {
    const release = beginRdcLifecycle(scope.sessionId);
    const key = keyOf(scope); const pending = (this.lifecycle.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn).finally(release);
    this.lifecycle.set(key, pending);
    void pending.finally(() => { if (this.lifecycle.get(key) === pending) this.lifecycle.delete(key); }).catch(() => undefined);
    return pending;
  }
  snapshotReplayForSession(scope: SessionScope): CaptureReplayState {
    const binding = this.binding(scope); return structuredClone({ ...binding.state, interactionLock: this.lock(binding) });
  }
  snapshotContextForSession(scope: SessionScope) { return this.bindings.get(keyOf(scope))?.runtime.snapshotContextForSession(scope) ?? null; }
  snapshotOpenedCaptureForSession(scope: SessionScope) { return this.bindings.get(keyOf(scope))?.runtime.snapshotOpenedCaptureForSession(scope) ?? null; }
  private revokePreparationConfirmation(binding: Binding): void {
    if (binding.confirmation) ipcApprovalTokenService.revoke(binding.confirmation.token);
    binding.confirmation = undefined;
  }
  private preparationConfirmation(binding: Binding, deviceId: string, kind: 'close_capture' | 'repair', issue?: ReplayDeviceIssue, bindingIdentity?: string): DevicePreparationResult {
    this.revokePreparationConfirmation(binding);
    const name = createHash('sha256').update(JSON.stringify({ scope: keyOf(binding.state), generation: binding.state.generation,
      deviceId, contextId: binding.runtime.getContextId(), captureHash: binding.state.captureHash, issue: issue?.repair, bindingIdentity })).digest('hex');
    const token = ipcApprovalTokenService.issue({ action: 'device.prepare', scope: 'project', projectRoot: binding.state.projectId, name });
    binding.confirmation = { token, name, generation: binding.state.generation, deviceId, kind, issue, bindingIdentity };
    return { success: false, state: this.snapshotReplayForSession(binding.state), confirmation: { token, kind, ...(issue ? { issue } : {}) } };
  }
  async prepareDevice(request: DevicePreparationRequest): Promise<DevicePreparationResult> {
    const scope = { projectId: request.projectId, sessionId: request.sessionId };
    const binding = this.binding(scope);
    this.assertInteraction(binding); this.assertPreparationGeneration(binding, request.bindingGeneration, Boolean(request.confirmationToken));
    const recoveringIssue = binding.state.preparation.issue?.deviceAction ? binding.state.preparation.issue : null;
    if (recoveringIssue && (request.deviceId !== binding.state.preparation.targetDeviceId || request.confirmationToken || !binding.installationEvidence)) {
      return { success: false, state: this.snapshotReplayForSession(scope), error: recoveringIssue };
    }
    const device = replayDeviceService.getDeviceById(request.deviceId);
    if (!device) throw new Error('RDC_DEVICE_NOT_FOUND');
    const owner = device.type === 'android' ? this.devices.get(device.id) : null;
    if (owner && owner !== keyOf(scope)) throw new Error('RDC_DEVICE_IN_USE');
    if (binding.preparation?.deviceId === device.id && !request.confirmationToken) return binding.preparation.pending;
    if (!request.confirmationToken && binding.runtime.snapshotOpenedCaptureForSession(scope) && binding.state.replayDeviceId === device.id
      && (device.type === 'local' || binding.state.preparation.phase === 'ready')) {
      return { success: true, state: this.snapshotReplayForSession(scope) };
    }
    let repairFingerprint: string | undefined;
    let expectedBindingIdentity: string | undefined;
    let closeConfirmed = false;
    if (request.confirmationToken) {
      const confirmation = binding.confirmation;
      if (!confirmation || confirmation.token !== request.confirmationToken || confirmation.deviceId !== device.id
        || confirmation.generation !== request.bindingGeneration) {
        this.revokePreparationConfirmation(binding);
        throw new Error('RDC_DEVICE_CONFIRMATION_STALE');
      }
      if (confirmation.kind === 'repair') {
        const identity = await configuredRemotePreparationIdentity();
        this.assertInteraction(binding); this.assertGeneration(binding, request.bindingGeneration);
        if (binding.confirmation !== confirmation || !confirmation.bindingIdentity || identity !== confirmation.bindingIdentity) {
          this.revokePreparationConfirmation(binding);
          throw new Error('RDC_DEVICE_CONFIRMATION_STALE: native CLI or catalog changed.');
        }
      }
      binding.confirmation = undefined;
      if (!ipcApprovalTokenService.consume({ token: request.confirmationToken, action: 'device.prepare', scope: 'project',
        projectRoot: scope.projectId, name: confirmation.name })) throw new Error('RDC_DEVICE_CONFIRMATION_STALE');
      closeConfirmed = confirmation.kind === 'close_capture';
      repairFingerprint = confirmation.issue?.repair?.fingerprint;
      expectedBindingIdentity = confirmation.bindingIdentity;
    } else if (binding.runtime.snapshotOpenedCaptureForSession(scope)
      && (binding.state.replayDeviceId !== device.id || binding.state.preparation.phase !== 'ready')) {
      return Promise.resolve(this.preparationConfirmation(binding, device.id, 'close_capture'));
    }
    if (binding.runtime.snapshotOpenedCaptureForSession(scope)
      && (binding.state.replayDeviceId !== device.id || binding.state.preparation.phase !== 'ready') && !closeConfirmed) throw new Error('RDC_DEVICE_CLOSE_CONFIRMATION_REQUIRED');
    this.revokePreparationConfirmation(binding);
    const baseGeneration = binding.preparation?.baseGeneration ?? binding.state.generation;
    binding.preparation?.controller.abort();
    const controller = new AbortController();
    const generation = binding.state.generation + 1;
    let unconfirmedIssue: ReplayDeviceIssue | undefined;
    let installationIdentity: DeviceInstallationIdentity | undefined;
    let installationVerified = !recoveringIssue;
    this.publish(binding, { generation, operationId: randomUUID(), error: null, preparation: { targetDeviceId: device.id, phase: 'checking', issue: recoveringIssue } });
    const pending = this.serial(scope, async (): Promise<DevicePreparationResult> => {
      const current = () => binding.state.generation === generation && !controller.signal.aborted;
      try {
        if (!current()) return { success: false, state: this.snapshotReplayForSession(scope) };
        this.assertInteraction(binding);
        if (recoveringIssue) {
          const evidence = binding.installationEvidence!;
          const inspected = await binding.runtime.inspectReplayDeviceInstallation(scope, device, {
            signal: controller.signal, expectedBindingIdentity: evidence.bindingIdentity,
          });
          if (!current()) throw controller.signal.reason ?? new Error('RDC_DEVICE_PREPARATION_CANCELLED');
          if (inspected.deviceSerial !== evidence.deviceSerial || inspected.packageName !== evidence.packageName || inspected.apkSha256 !== evidence.apkSha256) {
            throw new Error('RDC_REMOTE_INSTALLATION_IDENTITY_CHANGED');
          }
          if (inspected.state !== 'clear') throw new Error(inspected.diagnostic ?? 'RDC_REMOTE_INSTALLATION_STILL_UNCONFIRMED');
          installationVerified = true;
          expectedBindingIdentity = evidence.bindingIdentity;
          binding.installationEvidence = undefined;
          this.publish(binding, { preparation: { targetDeviceId: device.id, phase: 'checking', issue: null } });
        }
        const previousTarget = binding.deviceId;
        if (!binding.runtime.isPreparedFor(scope, device.id)) {
          await this.closeBinding(scope, binding, {});
          this.publish(binding, { phase: 'closed', contextId: null, replayDeviceId: null, inputId: null, captureHash: null,
            image: null, observation: null, requestedEventId: null, appliedEventId: null, imageEventId: null, events: [], targets: [], target: null });
        } else if (previousTarget && previousTarget !== device.id) throw new Error('RDC_DEVICE_BINDING_MISMATCH');
        if (!current()) return { success: false, state: this.snapshotReplayForSession(scope) };
        if (device.type === 'android') {
          // Other sessions may have completed their cleanup while this queue was awaiting native close.
          // The final ownership check and reservation are one synchronous admission step.
          const currentOwner = this.devices.get(device.id);
          if (currentOwner && currentOwner !== keyOf(scope)) throw new Error('RDC_DEVICE_IN_USE');
          this.devices.set(device.id, keyOf(scope)); binding.deviceId = device.id;
        }
        await binding.runtime.prepareReplayDevice(scope, device, { signal: controller.signal, repairFingerprint, expectedBindingIdentity,
          onPreparationStage: phase => {
            if (current() && binding.state.preparation.phase !== phase) this.publish(binding, { preparation: { ...binding.state.preparation, phase } });
          },
          onInstallation: installation => {
            if (binding.preparation?.controller === controller && binding.state.preparation.targetDeviceId === device.id) {
              this.publish(binding, { preparation: { ...binding.state.preparation, installation } });
            }
          },
          onDeviceAction: (issue, identity) => { unconfirmedIssue = issue; installationIdentity = identity; },
        });
        if (!current()) throw controller.signal.reason ?? new Error('RDC_DEVICE_PREPARATION_CANCELLED');
        this.publish(binding, { contextId: binding.runtime.getContextId(), preparation: { targetDeviceId: device.id, phase: 'ready', issue: null } });
        return { success: true, state: this.snapshotReplayForSession(scope) };
      } catch (error) {
        const bindingIdentity = binding.runtime.getPreparationBindingIdentity();
        let issue = unconfirmedIssue ?? replayDeviceIssue(error);
        if (!issue.deviceAction && binding.state.preparation.issue?.deviceAction) issue = binding.state.preparation.issue;
        if (!issue.deviceAction && !installationVerified && recoveringIssue) issue = recoveringIssue;
        if (issue.deviceAction) {
          const identity = installationIdentity ?? (error instanceof RdcNativeFailure ? deviceInstallationIdentity(error.nativeError.details) : undefined);
          if (identity && bindingIdentity) binding.installationEvidence = { ...identity, bindingIdentity };
          // An unresolved device-side mutation survives cancellation and invalidates queued replacement intents.
          binding.preparation?.controller.abort(); this.revokePreparationConfirmation(binding);
          this.publish(binding, { generation: binding.state.generation + 1,
            preparation: { targetDeviceId: device.id, phase: 'failed', issue } });
          await this.closeBinding(scope, binding, {});
          this.publish(binding, { contextId: binding.runtime.getContextId() });
          return { success: false, state: this.snapshotReplayForSession(scope), error: issue };
        }
        // A cancelled consumer cannot release a newer context: this serial section owns cleanup until it exits.
        try { await this.closeBinding(scope, binding, {}); }
        catch (cleanupError) {
          if (binding.state.generation === generation) this.publish(binding, { preparation: { targetDeviceId: device.id, phase: 'failed', issue: replayDeviceIssue(cleanupError) } });
          throw cleanupError;
        }
        if (!current()) return { success: false, state: this.snapshotReplayForSession(scope) };
        if (issue.repair && issue.repair.deviceSerial !== device.serial) issue = {
          code: 'RDC_REMOTE_REPAIR_IDENTITY_MISMATCH', stage: issue.stage,
          diagnostic: 'Native repair assessment does not belong to the selected device.', recovery: 'configure_tools',
        };
        this.publish(binding, { contextId: null, preparation: { targetDeviceId: device.id, phase: issue.repair ? 'needs_action' : 'failed', issue } });
        if (issue.repair) return this.preparationConfirmation(binding, device.id, 'repair', issue, bindingIdentity ?? undefined);
        return { success: false, state: this.snapshotReplayForSession(scope), error: issue };
      }
    }).finally(() => { if (binding.preparation?.controller === controller) binding.preparation = undefined; });
    binding.preparation = { deviceId: device.id, baseGeneration, controller, pending };
    return pending;
  }
  async cancelDevicePreparation(request: CaptureReplayBindingRequest): Promise<DevicePreparationResult> {
    const binding = this.binding(request); this.assertInteraction(binding); this.assertPreparationGeneration(binding, request.bindingGeneration);
    if (binding.runtime.snapshotOpenedCaptureForSession(request)) {
      if (binding.confirmation) {
        this.revokePreparationConfirmation(binding);
        return { success: true, state: this.snapshotReplayForSession(request) };
      }
      throw new Error('RDC_CAPTURE_CLOSE_REQUIRED');
    }
    binding.preparation?.controller.abort(); this.revokePreparationConfirmation(binding);
    if (!binding.state.preparation.issue?.deviceAction) this.publish(binding, { generation: binding.state.generation + 1,
      preparation: { ...binding.state.preparation, phase: 'cancelled', issue: null } });
    return this.serial(request, async () => {
      if (!binding.runtime.snapshotOpenedCaptureForSession(request)) await this.closeBinding(request, binding, {});
      this.publish(binding, { contextId: binding.runtime.getContextId() });
      const issue = binding.state.preparation.issue;
      return { success: !issue?.deviceAction, state: this.snapshotReplayForSession(request), ...(issue?.deviceAction ? { error: issue } : {}) };
    });
  }
  openProjectInput(request: OpenProjectInputRequest, options: RdcLifecycleOptions = {}): Promise<OpenedCaptureState> {
    if (!request.sessionId) return Promise.reject(new Error('RDC_SCOPE_REQUIRED'));
    const scope = { projectId: request.projectId, sessionId: request.sessionId };
    return this.serial(scope, async () => {
      const binding = this.binding(scope); this.assertInteraction(binding, options);
      this.assertGeneration(binding, options.expectedGeneration);
      if (binding.state.preparation.issue?.deviceAction) throw new Error('RDC_DEVICE_ACTION_UNCONFIRMED');
      if (this.blockedInputs.has(JSON.stringify([scope.projectId, request.inputId]))) throw new Error('RDC_INPUT_REMOVING');
      const key = keyOf(scope); const remoteId = request.replayDevice.type === 'android' ? request.replayDevice.id : null;
      const deviceOwner = remoteId ? this.devices.get(remoteId) : null;
      if (deviceOwner && deviceOwner !== key) throw new Error(`RDC_DEVICE_IN_USE: ${deviceOwner}`);
      const reusePrepared = Boolean(remoteId && binding.state.preparation.phase === 'ready'
        && binding.state.preparation.targetDeviceId === remoteId && binding.runtime.isPreparedFor(scope, remoteId));
      if (remoteId && !reusePrepared) throw new Error('RDC_DEVICE_NOT_PREPARED');
      if (remoteId) this.devices.set(remoteId, key);
      this.publish(binding, { phase: 'validating', operationId: randomUUID(), generation: binding.state.generation + 1, error: null });
      try {
        const project = storageAdapter.getProjectById(scope.projectId);
        const reference = project?.inputs?.find(input => input.inputId === request.inputId && input.source === 'external_reference');
        if (reference && reference.filePath !== request.filePath) throw new Error('CAPTURE_REFERENCE_INVALID_PATH');
        const verifyInput = async () => {
          if (!reference) return hashCaptureFile(request.filePath);
          const verified = await verifyExternalCaptureReference(reference);
          return { sha256: verified.contentSha256! };
        };
        const hashed = await verifyInput();
        this.assertInteraction(binding, options);
        if (!reusePrepared) await this.closeBinding(scope, binding, options, remoteId);
        this.publish(binding, { captureHash: hashed.sha256, contextId: reusePrepared ? binding.runtime.getContextId() : null,
          replayDeviceId: null, image: null, observation: null, imageEventId: null, appliedEventId: null, requestedEventId: null, events: [], targets: [], target: null });
        if (project) await replayHistoryStore.saveSelection(project.rootPath, scope.sessionId, { inputId: request.inputId, captureSha256: hashed.sha256, deviceId: request.replayDevice.id });
        this.assertInteraction(binding, options);
        binding.deviceId = remoteId;
        if (remoteId) this.devices.set(remoteId, key);
        this.publish(binding, { phase: remoteId ? 'connecting' : 'opening', inputId: request.inputId });
        const opened = await binding.runtime.openProjectInput(request, { ...options, onStage: phase => this.publish(binding, { phase }) });
        let verified: { sha256: string };
        try { verified = await verifyInput(); }
        catch (error) {
          this.publish(binding, { captureHash: null, image: null, imageEventId: null });
          await this.closeBinding(scope, binding, options);
          throw error;
        }
        if (verified.sha256 !== hashed.sha256) {
          this.publish(binding, { captureHash: null, image: null, imageEventId: null });
          await this.closeBinding(scope, binding, options);
          throw new Error('CAPTURE_CHANGED_DURING_OPEN: source bytes changed; reopen the current capture.');
        }
        this.publish(binding, { phase: 'loading_image', contextId: opened.contextId, replayDeviceId: request.replayDevice.id });
        const owner = opened.runtimeContext;
        if (owner) {
          try {
            await runRdcOperation(owner.contextId, async () => {
              this.publish(binding, { events: await readReplayEvents(owner, binding.runtime.getCliSettings()) });
              this.publish(binding, await observeReplay(owner, { final_output: true }, binding.runtime.getCliSettings(), {
                sessionId: scope.sessionId, generation: binding.state.generation,
              }));
            });
          } catch (error) { this.publish(binding, { error: { code: 'RDC_IMAGE_FAILED', message: String(error), retry: 'image' } }); }
        }
        this.publish(binding, { phase: 'ready' });
        return opened;
      } catch (error) {
        // Do not release a reservation if the native lifecycle still owns a context.
        if (remoteId && this.devices.get(remoteId) === key && (!binding.runtime.getContextId() || binding.deviceId !== remoteId)) this.devices.delete(remoteId);
        const issue = replayDeviceIssue(error);
        this.publish(binding, { phase: 'error', contextId: binding.runtime.getContextId(),
          ...(remoteId ? { preparation: { targetDeviceId: remoteId, phase: 'failed', issue } } : {}),
          error: { code: 'RDC_OPEN_FAILED', message: String(error), retry: 'open', issue } });
        throw error;
      }
    });
  }
  private async closeBinding(scope: SessionScope, binding: Binding, options: RdcLifecycleOptions, retainedDeviceId: string | null = null): Promise<boolean> {
    const contextId = binding.runtime.getContextId();
    const close = () => { this.assertInteraction(binding, options); return binding.runtime.clearOpenedCaptureForSession(scope, options); };
    const closed = contextId ? await runRdcOperation(contextId, close) : await close();
    if (!binding.state.preparation.issue?.deviceAction) {
      if (binding.deviceId && binding.deviceId !== retainedDeviceId && this.devices.get(binding.deviceId) === keyOf(scope)) this.devices.delete(binding.deviceId);
      binding.deviceId = null;
    }
    await replayLivePreviewStore.clear(scope.sessionId);
    return closed;
  }
  async clearOpenedCaptureForSession(scope: SessionScope, options: RdcLifecycleOptions = {}): Promise<boolean> {
    const binding = this.binding(scope); this.assertInteraction(binding, options);
    this.assertGeneration(binding, options.expectedGeneration);
    binding.preparation?.controller.abort(); this.revokePreparationConfirmation(binding);
    return this.serial(scope, async () => {
      this.assertInteraction(binding, options);
      this.assertGeneration(binding, options.expectedGeneration);
      const operationId = randomUUID();
      this.publish(binding, { phase: 'closing', operationId, error: null });
      try {
        const closed = await this.closeBinding(scope, binding, options);
        if (binding.state.preparation.issue?.deviceAction) {
          this.publish(binding, { contextId: binding.runtime.getContextId(), phase: 'closed', operationId });
          throw new Error('RDC_DEVICE_ACTION_UNCONFIRMED: verify the device installation before closing or deleting its session.');
        }
        this.publish(binding, { ...empty(scope), operationId, generation: binding.state.generation + 1 });
        return closed;
      } catch (error) {
        const issue = binding.state.preparation.issue;
        this.publish(binding, { phase: 'error', error: { code: issue?.deviceAction ? 'RDC_DEVICE_ACTION_UNCONFIRMED' : 'RDC_CLOSE_FAILED',
          message: String(error), retry: 'close', ...(issue?.deviceAction ? { issue } : {}) } }); throw error;
      }
    });
  }
  async rebindInput(projectId: string, oldInputId: string, input: import('@shared/types/session').ProjectInputRecord): Promise<void> {
    const hash = input.source === 'external_reference'
      ? { sha256: (await verifyExternalCaptureReference(input)).contentSha256! }
      : await hashCaptureFile(input.filePath);
    for (const binding of this.bindings.values()) {
      if (binding.state.projectId !== projectId || binding.state.inputId !== oldInputId || binding.state.captureHash !== hash.sha256) continue;
      binding.runtime.rebindInput(input.inputId, input.filePath);
      this.publish(binding, { inputId: input.inputId });
      const project = storageAdapter.getProjectById(projectId);
      if (project) await replayHistoryStore.saveSelection(project.rootPath, binding.state.sessionId, {
        inputId: input.inputId, captureSha256: hash.sha256, deviceId: binding.state.replayDeviceId ?? undefined,
      });
    }
  }
  async blockInputOperations<T>(projectId: string, inputId: string, operation: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([projectId, inputId]);
    if (this.blockedInputs.has(key)) throw new Error('RDC_INPUT_REMOVING');
    this.blockedInputs.add(key);
    try {
      await Promise.allSettled([...this.lifecycle.values()]);
      return await operation();
    } finally { this.blockedInputs.delete(key); }
  }
  listBindingsForProject(projectId: string) {
    return [...this.bindings.values()].filter(binding => binding.state.projectId === projectId).map(binding => ({
      scope: { projectId, sessionId: binding.state.sessionId }, inputId: binding.state.inputId,
      captureHash: binding.state.captureHash, phase: binding.state.phase, interactionLock: this.lock(binding), contextId: binding.runtime.getContextId(),
    }));
  }
  async closeMatchingCaptures(projectId: string, inputId: string): Promise<void> {
    const matches = this.listBindingsForProject(projectId).filter(binding => binding.inputId === inputId);
    if (matches.some(binding => binding.interactionLock)) throw new Error('RDC_INTERACTION_LOCKED: stop associated sessions first.');
    for (const binding of matches) await this.clearOpenedCaptureForSession(binding.scope);
  }
  async closeAll(): Promise<void> {
    const results = await Promise.allSettled([...this.bindings.values()].map(binding => this.clearOpenedCaptureForSession(binding.state)));
    const harvest = await harvestOwnedRdcDaemons();
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length || harvest.failed.length) {
      throw new Error(`RDC_CLOSE_FAILED: ${failures.length + harvest.failed.length} session resources remain owned.`);
    }
  }
  async switchActiveCapture(scope: CaptureReplayBindingRequest, captureId: string): Promise<void> {
    await this.serial(scope, async () => {
      const binding = this.binding(scope); this.assertInteraction(binding); this.assertGeneration(binding, scope.bindingGeneration);
      await binding.runtime.switchActiveCapture(captureId);
    });
  }
  async applyEventForSession(request: CaptureReplayApplyRequest): Promise<CaptureReplayState> {
    const binding = this.binding(request); this.assertInteraction(binding);
    this.assertGeneration(binding, request.bindingGeneration); this.assertReplayAvailable(binding);
    if (!binding.state.events.some(event => event.eventId === request.eventId)) throw new Error('RDC_EVENT_INVALID');
    const operationId = randomUUID();
    this.publish(binding, { requestedEventId: request.eventId, operationId });
    return this.observe(request, { event_id: request.eventId, ...(request.target ? { target: { texture_id: request.target.textureId, rt_index: request.target.outputSlot } } : {}) }, true, undefined, false, operationId);
  }
  async refreshFrameForSession(scope: CaptureReplayBindingRequest): Promise<CaptureReplayState> {
    const binding = this.binding(scope); this.assertGeneration(binding, scope.bindingGeneration);
    this.assertReplayAvailable(binding); return this.observe(scope, {}, true);
  }
  async observeAgentOperation(scope: SessionScope, operationId: string, toolCallId: string, frozenCli?: RdcCliInvokerSettings, alreadySerialized = false): Promise<void> {
    if (!this.snapshotOpenedCaptureForSession(scope)) return;
    const generation = this.binding(scope).state.generation;
    const state = await this.observe(scope, {}, false, frozenCli, alreadySerialized);
    if (this.binding(scope).state.generation !== generation) return;
    const project = storageAdapter.getProjectById(scope.projectId);
    if (!project || !state.captureHash || (state.appliedEventId === null && !state.error)) return;
    const summary = `${operationId}${state.appliedEventId === null ? '' : ` · EID ${state.appliedEventId}`}${state.target ? ` · ${state.target.textureId}` : ''}${state.observation ? ` · ${state.observation.modificationState}` : ''}`;
    try {
      const imageBytes = state.image ? await replayLivePreviewStore.read(scope.sessionId) : undefined;
      await replayHistoryStore.append({ projectRoot: project.rootPath, sessionId: scope.sessionId, captureSha256: state.captureHash }, {
        eventId: state.appliedEventId, operationId, summary, toolCallId,
        modificationState: state.observation?.modificationState, nativeRevision: state.observation?.nativeRevision,
        displayParameters: state.observation?.displayParameters,
        resourceId: state.target?.textureId, bindingGeneration: state.generation,
        ...(state.error ? { failure: `${state.error.code}: ${state.error.message}` } : {}),
      }, imageBytes);
      if (this.binding(scope).state.generation === generation) this.publish(this.binding(scope), {});
    } catch (error) {
      if (this.binding(scope).state.generation === generation) this.publish(this.binding(scope), {
        error: { code: 'REPLAY_SAVE_FAILED', message: String(error), retry: null } });
    }
  }
  private async observe(scope: SessionScope, args: Record<string, unknown>, human: boolean, frozenCli?: RdcCliInvokerSettings, alreadySerialized = false, operationId = randomUUID()): Promise<CaptureReplayState> {
    const binding = this.binding(scope); if (human) this.assertInteraction(binding);
    const owner = binding.runtime.snapshotOpenedCaptureForSession(scope)?.runtimeContext;
    if (!owner) throw new Error('RDC_NOT_OPEN');
    const generation = binding.state.generation;
    const operation = async () => {
      if (generation !== binding.state.generation) return;
      if (human) { this.assertInteraction(binding); this.assertReplayAvailable(binding); }
      // A queued slider request superseded by a newer position must not mutate the context.
      if (args.event_id !== undefined && args.event_id !== binding.state.requestedEventId) return;
      this.publish(binding, { phase: 'applying', operationId, error: null });
      try {
        const observed = await observeReplay(owner, args, frozenCli ?? binding.runtime.getCliSettings(), {
          sessionId: scope.sessionId, generation,
        });
        if (generation === binding.state.generation) this.publish(binding, { ...observed, operationId,
          ...(!human ? { requestedEventId: observed.appliedEventId ?? null } : {}), phase: 'ready' });
      }
      catch (error) { if (generation === binding.state.generation) this.publish(binding, { operationId, ...(!human ? { requestedEventId: null } : {}), image: null, observation: null, imageEventId: null, appliedEventId: null, target: null, targets: [], isFinalOutput: false, phase: 'ready', error: { code: 'RDC_OBSERVE_FAILED', message: String(error), retry: 'image' } }); }
    };
    if (alreadySerialized) await operation(); else await runRdcOperation(owner.contextId, operation);
    return this.snapshotReplayForSession(scope);
  }
}
