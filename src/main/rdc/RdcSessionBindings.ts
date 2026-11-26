import { AppError } from '@shared/errors/appError';
import { ipcApprovalTokenService } from '../runtime/IpcApprovalTokenService';
import { shellInvocationService } from '../tools/ShellInvocationService';
import { RdcSessionRuntime, type RdcLifecycleOptions } from './RdcSessionRuntime';
import { getDelegatedChildSessionId, getRdcContextLease } from './RdcRuntimeContextRegistry';
import { beginRdcLifecycle, getRdcInteractionLock, runRdcOperation } from './RdcOperationCoordinator';
import { freezeRdcTurnBinding, type RdcTurnBinding } from './RdcTurnBindings';
import { replayLivePreviewStore } from './captures/replay/ReplayLivePreviewStore';
import type { DeviceInstallationIdentity } from './captures/ReplayDeviceIssue';
import type { CaptureReplayState } from '@shared/types/captureReplay';
import type { SessionScope } from '@shared/types/session';
import type { DevicePreparationResult } from '@shared/types/captureReplay';

export const keyOf = (scope: SessionScope) => JSON.stringify([scope.projectId, scope.sessionId]);
export interface RdcReplayBinding {
  runtime: RdcSessionRuntime;
  state: CaptureReplayState;
  deviceId: string | null;
  installationEvidence?: DeviceInstallationIdentity & { bindingIdentity: string };
  preparation?: {
    deviceId: string;
    baseGeneration: number;
    controller: AbortController;
    pending: Promise<DevicePreparationResult>;
  };
  confirmation?: { token: string; name: string; generation: number; deviceId: string; kind: 'close_capture' };
}
export const closedReplayState = (scope: SessionScope): CaptureReplayState => ({
  ...scope,
  generation: 0,
  revision: 0,
  operationId: null,
  phase: 'closed',
  preparation: { targetDeviceId: null, phase: 'idle', issue: null },
  replayDeviceId: null,
  inputId: null,
  captureHash: null,
  contextId: null,
  requestedEventId: null,
  appliedEventId: null,
  imageEventId: null,
  events: [],
  targets: [],
  target: null,
  isFinalOutput: false,
  image: null,
  observation: null,
  devicePresentation: { status: 'not_applicable', eventId: null, textureId: null, sequence: null, reason: null },
  warning: null,
  interactionLock: null,
  error: null,
});

/**
 * RdcSessionBindings — the per-session replay bindings and the primitives every RDC session
 * operation shares: interaction locks and generation checks, state publication, the per-scope
 * serial lifecycle queue, device reservations and binding close.
 */
export class RdcSessionBindings {
  protected readonly bindings = new Map<string, RdcReplayBinding>();
  protected readonly blockedInputs = new Set<string>();
  protected readonly devices = new Map<string, string>();
  protected readonly listeners = new Set<(state: CaptureReplayState) => void>();
  protected readonly lifecycle = new Map<string, Promise<unknown>>();
  subscribe(listener: (state: CaptureReplayState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  getDeviceOwner(deviceId: string): SessionScope | null {
    const key = this.devices.get(deviceId);
    if (!key) return null;
    // A device is reserved only under the key of a binding, and bindings are never removed.
    const { projectId, sessionId } = this.bindings.get(key)!.state;
    return { projectId, sessionId };
  }
  protected binding(scope: SessionScope): RdcReplayBinding {
    if (!scope.sessionId.trim() || !scope.projectId.trim()) throw new AppError('RDC_SCOPE_REQUIRED');
    const key = keyOf(scope);
    let binding = this.bindings.get(key);
    if (!binding) {
      binding = { runtime: new RdcSessionRuntime(), state: closedReplayState(scope), deviceId: null };
      this.bindings.set(key, binding);
    }
    return binding;
  }
  protected lock(binding: RdcReplayBinding): string | null {
    const contextId = binding.runtime.getContextId();
    return (
      getRdcInteractionLock(binding.state.sessionId) ??
      (getDelegatedChildSessionId(binding.state.sessionId) ? 'delegated_execution' : null) ??
      (contextId && shellInvocationService.hasUnconfirmedProcesses(contextId) ? 'native_exit_unconfirmed' : null)
    );
  }
  protected assertInteraction(binding: RdcReplayBinding, options: RdcLifecycleOptions = {}): void {
    // Frozen probe lifecycle runs inside the owning Agent execution, not a human command.
    const lock = this.lock(binding);
    if (lock && !(options.binding && lock === 'agent_running')) throw new AppError('RDC_INTERACTION_LOCKED', lock);
  }
  protected assertGeneration(binding: RdcReplayBinding, expected: number | undefined): void {
    if (expected !== undefined && binding.state.generation !== expected)
      throw new AppError('RDC_BINDING_CHANGED', 'refresh the current capture state.');
  }
  protected assertPreparationGeneration(binding: RdcReplayBinding, expected: number, confirmed = false): void {
    if (
      !confirmed &&
      binding.preparation &&
      expected >= binding.preparation.baseGeneration &&
      expected <= binding.state.generation
    )
      return;
    this.assertGeneration(binding, expected);
  }
  protected assertReplayAvailable(binding: RdcReplayBinding): void {
    if (getRdcContextLease(binding.state.sessionId)?.quarantineReason) {
      this.publish(binding, {
        phase: 'error',
        error:
          binding.state.error?.retry === 'close'
            ? binding.state.error
            : {
                code: 'RDC_CONTEXT_QUARANTINED',
                message: 'Replay outcome is uncertain; close and reopen the capture.',
                retry: 'close',
              },
      });
      throw new AppError('RDC_CONTEXT_QUARANTINED');
    }
    if (!['ready', 'applying'].includes(binding.state.phase)) throw new AppError('RDC_REPLAY_BUSY');
  }
  protected publish(binding: RdcReplayBinding, patch: Partial<CaptureReplayState>): void {
    if (
      ['ready', 'applying'].includes(patch.phase ?? binding.state.phase) &&
      getRdcContextLease(binding.state.sessionId)?.quarantineReason
    ) {
      patch = {
        ...patch,
        phase: 'error',
        devicePresentation: undefined,
        error: {
          code: 'RDC_CONTEXT_QUARANTINED',
          message: 'Replay outcome is uncertain; close and reopen the capture.',
          retry: 'close',
        },
      };
    }
    if (!patch.devicePresentation && (patch.error || (patch.phase && patch.phase !== 'ready'))) {
      patch.devicePresentation = binding.deviceId
        ? {
            status: 'unavailable',
            eventId: null,
            textureId: null,
            sequence: null,
            reason: patch.error?.code ?? 'observation_pending',
          }
        : { status: 'not_applicable', eventId: null, textureId: null, sequence: null, reason: null };
    }
    binding.state = {
      ...binding.state,
      ...patch,
      revision: binding.state.revision + 1,
      interactionLock: this.lock(binding),
    };
    for (const listener of this.listeners) listener(structuredClone(binding.state));
  }
  protected serial<T>(scope: SessionScope, fn: () => Promise<T>): Promise<T> {
    const release = beginRdcLifecycle(scope.sessionId);
    const key = keyOf(scope);
    const pending = (this.lifecycle.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(fn)
      .finally(release);
    this.lifecycle.set(key, pending);
    void pending
      .finally(() => {
        if (this.lifecycle.get(key) === pending) this.lifecycle.delete(key);
      })
      .catch(() => undefined);
    return pending;
  }
  snapshotReplayForSession(scope: SessionScope): CaptureReplayState {
    const binding = this.binding(scope);
    return structuredClone({ ...binding.state, interactionLock: this.lock(binding) });
  }
  snapshotContextForSession(scope: SessionScope) {
    return this.bindings.get(keyOf(scope))?.runtime.snapshotContextForSession(scope) ?? null;
  }
  snapshotOpenedCaptureForSession(scope: SessionScope) {
    return this.bindings.get(keyOf(scope))?.runtime.snapshotOpenedCaptureForSession(scope) ?? null;
  }
  /** Main-only binding of the currently owned context, including a quarantined one. */
  recoveryBinding(scope: SessionScope): RdcTurnBinding | null {
    const owner = this.bindings.get(keyOf(scope));
    const contextId = owner?.runtime.getContextId();
    if (!owner || !contextId) return null;
    if (owner.runtime.snapshotContextForSession(scope)?.contextId !== contextId)
      throw new AppError('RDC_RECOVERY_OWNER_INVALID');
    const cli = owner.runtime.getCliSettings();
    const lease = getRdcContextLease(scope.sessionId);
    if (
      !cli ||
      (lease &&
        (lease.ownerSessionId !== scope.sessionId ||
          lease.ownerProjectId !== scope.projectId ||
          lease.contextId !== contextId))
    ) {
      throw new AppError('RDC_RECOVERY_OWNER_INVALID');
    }
    return freezeRdcTurnBinding(cli, [], lease);
  }
  protected revokePreparationConfirmation(binding: RdcReplayBinding): void {
    if (binding.confirmation) ipcApprovalTokenService.revoke(binding.confirmation.token);
    binding.confirmation = undefined;
  }
  protected async closeBinding(
    scope: SessionScope,
    binding: RdcReplayBinding,
    options: RdcLifecycleOptions,
    retainedDeviceId: string | null = null,
  ): Promise<boolean> {
    const contextId = binding.runtime.getContextId();
    const close = () => {
      this.assertInteraction(binding, options);
      return binding.runtime.clearOpenedCaptureForSession(scope, options);
    };
    const closed = contextId ? await runRdcOperation(contextId, close) : await close();
    if (!binding.state.preparation.issue?.deviceAction) {
      if (
        binding.deviceId &&
        binding.deviceId !== retainedDeviceId &&
        this.devices.get(binding.deviceId) === keyOf(scope)
      )
        this.devices.delete(binding.deviceId);
      binding.deviceId = null;
    }
    await replayLivePreviewStore.clear(scope.sessionId);
    return closed;
  }
  listBindingsForProject(projectId: string) {
    return [...this.bindings.values()]
      .filter((binding) => binding.state.projectId === projectId)
      .map((binding) => ({
        scope: { projectId, sessionId: binding.state.sessionId },
        inputId: binding.state.inputId,
        captureHash: binding.state.captureHash,
        phase: binding.state.phase,
        interactionLock: this.lock(binding),
        contextId: binding.runtime.getContextId(),
      }));
  }
}
