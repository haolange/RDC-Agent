import type { RdxCliInvokerSettings } from '@shared/types/settings';
import { randomUUID } from 'node:crypto';
import { storageAdapter } from './StorageAdapter';
import { replayHistoryStore } from '../captures/replay/ReplayHistoryStore';
import { hashCaptureFile } from '../captures/replay/captureContentHash';
import type { SessionScope, OpenProjectInputRequest, OpenedCaptureState } from '@shared/types/session';
import type { CaptureReplayState, CaptureReplayApplyRequest, CaptureReplayBindingRequest } from '@shared/types/captureReplay';
import { RdxSessionRuntime, type RdxLifecycleOptions } from './RdxSessionRuntime';
import { getDelegatedChildSessionId, getRdxContextLease } from './RdxRuntimeContextRegistry';
import { shellInvocationService } from '../tools/ShellInvocationService';
import { beginRdxLifecycle, getRdxInteractionLock, runRdxOperation, subscribeRdxInteractionLock } from './RdxOperationCoordinator';
import { harvestOwnedRdxDaemons } from './OwnedRdxDaemonRegistry';
import { replayLivePreviewStore } from '../captures/replay/ReplayLivePreviewStore';
import { observeReplay, readReplayEvents } from './RdxReplayObservation';

const keyOf = (scope: SessionScope) => JSON.stringify([scope.projectId, scope.sessionId]);
interface Binding { runtime: RdxSessionRuntime; state: CaptureReplayState; deviceId: string | null }
const empty = (scope: SessionScope): CaptureReplayState => ({ ...scope, generation: 0, revision: 0, operationId: null,
  phase: 'closed', replayDeviceId: null, inputId: null, captureHash: null, contextId: null,
  requestedEventId: null, appliedEventId: null, imageEventId: null, events: [], targets: [], target: null,
  isFinalOutput: false, image: null, observation: null, agentObservation: null, devicePresentation: { status: 'not_applicable', eventId: null, textureId: null, sequence: null, reason: null }, warning: null, interactionLock: null, error: null });

/** Per-session application ownership. Device reservations survive uncertain native close. */
export class RdxSessionService {
  private readonly bindings = new Map<string, Binding>();
  private readonly blockedInputs = new Set<string>();
  private readonly devices = new Map<string, string>();
  private readonly listeners = new Set<(state: CaptureReplayState) => void>();
  private readonly lifecycle = new Map<string, Promise<unknown>>();
  constructor() {
    subscribeRdxInteractionLock(sessionId => {
      for (const binding of this.bindings.values()) if (binding.state.sessionId === sessionId) this.publish(binding, {});
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
    if (!scope.sessionId?.trim() || !scope.projectId?.trim()) throw new Error('RDX_SCOPE_REQUIRED');
    const key = keyOf(scope); let binding = this.bindings.get(key);
    if (!binding) { binding = { runtime: new RdxSessionRuntime(), state: empty(scope), deviceId: null }; this.bindings.set(key, binding); }
    return binding;
  }
  private lock(binding: Binding): string | null {
    const contextId = binding.runtime.getContextId();
    return getRdxInteractionLock(binding.state.sessionId)
      ?? (getDelegatedChildSessionId(binding.state.sessionId) ? 'delegated_execution' : null)
      ?? (contextId && shellInvocationService.hasUnconfirmedProcesses(contextId) ? 'native_exit_unconfirmed' : null);
  }
  private assertInteraction(binding: Binding, options: RdxLifecycleOptions = {}): void {
    // Frozen probe lifecycle runs inside the owning Agent execution, not a human command.
    const lock = this.lock(binding);
    if (lock && !(options.binding && lock === 'agent_running')) throw new Error(`RDX_INTERACTION_LOCKED: ${lock}`);
  }
  private assertGeneration(binding: Binding, expected: number | undefined): void {
    if (expected !== undefined && binding.state.generation !== expected) throw new Error('RDX_BINDING_CHANGED: refresh the current capture state.');
  }
  private assertReplayAvailable(binding: Binding): void {
    if (getRdxContextLease(binding.state.sessionId)?.quarantineReason) {
      this.publish(binding, { phase: 'error', error: { code: 'RDX_CONTEXT_QUARANTINED', message: 'Replay outcome is uncertain; close and reopen the capture.', retry: 'close' } });
      throw new Error('RDX_CONTEXT_QUARANTINED');
    }
    if (!['ready', 'applying'].includes(binding.state.phase)) throw new Error('RDX_REPLAY_BUSY');
  }
  private publish(binding: Binding, patch: Partial<CaptureReplayState>): void {
    if (['ready', 'applying'].includes(patch.phase ?? binding.state.phase)
      && getRdxContextLease(binding.state.sessionId)?.quarantineReason) {
      patch = { ...patch, phase: 'error', devicePresentation: undefined,
        error: { code: 'RDX_CONTEXT_QUARANTINED', message: 'Replay outcome is uncertain; close and reopen the capture.', retry: 'close' } };
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
    const release = beginRdxLifecycle(scope.sessionId);
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
  openProjectInput(request: OpenProjectInputRequest, options: RdxLifecycleOptions = {}): Promise<OpenedCaptureState> {
    if (!request.sessionId) return Promise.reject(new Error('RDX_SCOPE_REQUIRED'));
    const scope = { projectId: request.projectId, sessionId: request.sessionId };
    return this.serial(scope, async () => {
      const binding = this.binding(scope); this.assertInteraction(binding, options);
      this.assertGeneration(binding, options.expectedGeneration);
      if (this.blockedInputs.has(JSON.stringify([scope.projectId, request.inputId]))) throw new Error('RDX_INPUT_REMOVING');
      const key = keyOf(scope); const remoteId = request.replayDevice.type === 'android' ? request.replayDevice.id : null;
      const deviceOwner = remoteId ? this.devices.get(remoteId) : null;
      if (deviceOwner && deviceOwner !== key) throw new Error(`RDX_DEVICE_IN_USE: ${deviceOwner}`);
      if (remoteId) this.devices.set(remoteId, key);
      this.publish(binding, { phase: 'validating', operationId: randomUUID(), generation: binding.state.generation + 1, error: null });
      try {
        const hashed = await hashCaptureFile(request.filePath);
        this.assertInteraction(binding, options);
        await this.closeBinding(scope, binding, options, remoteId);
        this.publish(binding, { captureHash: hashed.sha256, contextId: null, replayDeviceId: null, image: null, observation: null, agentObservation: null, imageEventId: null, appliedEventId: null, requestedEventId: null, events: [], targets: [], target: null });
        const project = storageAdapter.getProjectById(scope.projectId);
        if (project) await replayHistoryStore.saveSelection(project.rootPath, scope.sessionId, { inputId: request.inputId, captureSha256: hashed.sha256, deviceId: request.replayDevice.id });
        this.assertInteraction(binding, options);
        binding.deviceId = remoteId;
        if (remoteId) this.devices.set(remoteId, key);
        this.publish(binding, { phase: remoteId ? 'connecting' : 'opening', inputId: request.inputId });
        const opened = await binding.runtime.openProjectInput(request, { ...options, onStage: phase => this.publish(binding, { phase }) });
        const verified = await hashCaptureFile(request.filePath);
        if (verified.sha256 !== hashed.sha256) {
          this.publish(binding, { captureHash: null, image: null, imageEventId: null });
          await this.closeBinding(scope, binding, options);
          throw new Error('CAPTURE_CHANGED_DURING_OPEN: source bytes changed; reopen the current capture.');
        }
        this.publish(binding, { phase: 'loading_image', contextId: opened.contextId, replayDeviceId: request.replayDevice.id });
        const owner = opened.runtimeContext;
        if (owner) {
          try {
            await runRdxOperation(owner.contextId, async () => {
              this.publish(binding, { events: await readReplayEvents(owner, binding.runtime.getCliSettings()) });
              this.publish(binding, await observeReplay(owner, { final_output: true }, binding.runtime.getCliSettings(), {
                sessionId: scope.sessionId, generation: binding.state.generation,
              }));
            });
          } catch (error) { this.publish(binding, { error: { code: 'RDX_IMAGE_FAILED', message: String(error), retry: 'image' } }); }
        }
        this.publish(binding, { phase: 'ready' });
        return opened;
      } catch (error) {
        // Do not release a reservation if the native lifecycle still owns a context.
        if (remoteId && (!binding.runtime.getContextId() || binding.deviceId !== remoteId)) this.devices.delete(remoteId);
        this.publish(binding, { phase: 'error', contextId: binding.runtime.getContextId(), error: { code: 'RDX_OPEN_FAILED', message: String(error), retry: 'open' } });
        throw error;
      }
    });
  }
  private async closeBinding(scope: SessionScope, binding: Binding, options: RdxLifecycleOptions, retainedDeviceId: string | null = null): Promise<boolean> {
    const contextId = binding.runtime.getContextId();
    const close = () => { this.assertInteraction(binding, options); return binding.runtime.clearOpenedCaptureForSession(scope, options); };
    const closed = contextId ? await runRdxOperation(contextId, close) : await close();
    if (binding.deviceId && binding.deviceId !== retainedDeviceId && this.devices.get(binding.deviceId) === keyOf(scope)) this.devices.delete(binding.deviceId);
    binding.deviceId = null;
    await replayLivePreviewStore.clear(scope.sessionId);
    return closed;
  }
  clearOpenedCaptureForSession(scope: SessionScope, options: RdxLifecycleOptions = {}): Promise<boolean> {
    return this.serial(scope, async () => {
      const binding = this.binding(scope); this.assertInteraction(binding, options);
      this.assertGeneration(binding, options.expectedGeneration);
      const operationId = randomUUID();
      this.publish(binding, { phase: 'closing', operationId, error: null });
      try {
        const closed = await this.closeBinding(scope, binding, options);
        this.publish(binding, { ...empty(scope), operationId, generation: binding.state.generation + 1 });
        return closed;
      } catch (error) {
        this.publish(binding, { phase: 'error', error: { code: 'RDX_CLOSE_FAILED', message: String(error), retry: 'close' } }); throw error;
      }
    });
  }
  async clearReplayHistoryForSession(scope: SessionScope, captureHash: string, projectRoot: string): Promise<void> {
    const binding = this.binding(scope);
    const operation = async () => {
      this.assertInteraction(binding);
      await replayHistoryStore.clearCapture({ projectRoot, sessionId: scope.sessionId, captureSha256: captureHash });
      this.publish(binding, {});
    };
    const contextId = binding.runtime.getContextId();
    if (contextId) await runRdxOperation(contextId, operation); else await this.serial(scope, operation);
  }
  async rebindInput(projectId: string, oldInputId: string, input: import('@shared/types/session').ProjectInputRecord): Promise<void> {
    const hash = await hashCaptureFile(input.filePath);
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
    if (this.blockedInputs.has(key)) throw new Error('RDX_INPUT_REMOVING');
    this.blockedInputs.add(key);
    try {
      await Promise.allSettled([...this.lifecycle.values()]);
      return await operation();
    } finally { this.blockedInputs.delete(key); }
  }
  listBindingsForProject(projectId: string) {
    return [...this.bindings.values()].filter(binding => binding.state.projectId === projectId).map(binding => ({
      scope: { projectId, sessionId: binding.state.sessionId }, inputId: binding.state.inputId,
      captureHash: binding.state.captureHash, interactionLock: this.lock(binding), contextId: binding.runtime.getContextId(),
    }));
  }
  async closeMatchingCaptures(projectId: string, inputId: string): Promise<void> {
    const matches = this.listBindingsForProject(projectId).filter(binding => binding.inputId === inputId);
    if (matches.some(binding => binding.interactionLock)) throw new Error('RDX_INTERACTION_LOCKED: stop associated sessions first.');
    for (const binding of matches) await this.clearOpenedCaptureForSession(binding.scope);
  }
  async closeAll(): Promise<void> {
    const results = await Promise.allSettled([...this.bindings.values()].map(binding => this.clearOpenedCaptureForSession(binding.state)));
    const harvest = await harvestOwnedRdxDaemons();
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length || harvest.failed.length) {
      throw new Error(`RDX_CLOSE_FAILED: ${failures.length + harvest.failed.length} session resources remain owned.`);
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
    if (!binding.state.events.some(event => event.eventId === request.eventId)) throw new Error('RDX_EVENT_INVALID');
    const operationId = randomUUID();
    this.publish(binding, { requestedEventId: request.eventId, operationId });
    return this.observe(request, { event_id: request.eventId, ...(request.target ? { target: { texture_id: request.target.textureId, rt_index: request.target.outputSlot } } : {}) }, true, undefined, false, operationId);
  }
  async refreshFrameForSession(scope: CaptureReplayBindingRequest): Promise<CaptureReplayState> {
    const binding = this.binding(scope); this.assertGeneration(binding, scope.bindingGeneration);
    this.assertReplayAvailable(binding); return this.observe(scope, {}, true);
  }
  async observeAgentOperation(scope: SessionScope, operationId: string, toolCallId: string, frozenCli?: RdxCliInvokerSettings, alreadySerialized = false): Promise<void> {
    if (!this.snapshotOpenedCaptureForSession(scope)) return;
    const generation = this.binding(scope).state.generation;
    const state = await this.observe(scope, {}, false, frozenCli, alreadySerialized);
    if (this.binding(scope).state.generation !== generation) return;
    const project = storageAdapter.getProjectById(scope.projectId);
    if (!project || !state.captureHash || (state.appliedEventId === null && !state.error)) return;
    const summary = `${operationId}${state.appliedEventId === null ? '' : ` · EID ${state.appliedEventId}`}${state.target ? ` · ${state.target.textureId}` : ''}${state.observation ? ` · ${state.observation.modificationState}` : ''}`;
    const agentObservation = state.image && state.appliedEventId !== null && state.imageEventId === state.appliedEventId
      ? { eventId: state.appliedEventId, operationId, toolCallId, summary, image: state.image, target: state.target,
        observation: state.observation, saved: false, saveError: null } : null;
    if (agentObservation) this.publish(this.binding(scope), { agentObservation });
    try {
      const imageBytes = state.image ? await replayLivePreviewStore.read(scope.sessionId) : undefined;
      await replayHistoryStore.append({ projectRoot: project.rootPath, sessionId: scope.sessionId, captureSha256: state.captureHash }, {
        eventId: state.appliedEventId, operationId, summary, toolCallId,
        modificationState: state.observation?.modificationState, nativeRevision: state.observation?.nativeRevision,
        displayParameters: state.observation?.displayParameters,
        resourceId: state.target?.textureId, bindingGeneration: state.generation,
        ...(state.error ? { failure: `${state.error.code}: ${state.error.message}` } : {}),
      }, imageBytes);
      if (this.binding(scope).state.generation === generation) this.publish(this.binding(scope), agentObservation ? { agentObservation: { ...agentObservation, saved: true } } : {});
    } catch (error) {
      if (this.binding(scope).state.generation === generation) this.publish(this.binding(scope), {
        ...(agentObservation ? { agentObservation: { ...agentObservation, saveError: String(error) } } : {}),
        error: { code: 'REPLAY_SAVE_FAILED', message: String(error), retry: null } });
    }
  }
  private async observe(scope: SessionScope, args: Record<string, unknown>, human: boolean, frozenCli?: RdxCliInvokerSettings, alreadySerialized = false, operationId = randomUUID()): Promise<CaptureReplayState> {
    const binding = this.binding(scope); if (human) this.assertInteraction(binding);
    const owner = binding.runtime.snapshotOpenedCaptureForSession(scope)?.runtimeContext;
    if (!owner) throw new Error('RDX_NOT_OPEN');
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
        if (generation === binding.state.generation) this.publish(binding, { ...observed, operationId, phase: 'ready' });
      }
      catch (error) { if (generation === binding.state.generation) this.publish(binding, { operationId, image: null, observation: null, imageEventId: null, appliedEventId: null, target: null, targets: [], isFinalOutput: false, phase: 'ready', error: { code: 'RDX_OBSERVE_FAILED', message: String(error), retry: 'image' } }); }
    };
    if (alreadySerialized) await operation(); else await runRdxOperation(owner.contextId, operation);
    return this.snapshotReplayForSession(scope);
  }
}
