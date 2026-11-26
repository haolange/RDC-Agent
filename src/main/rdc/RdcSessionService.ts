import { randomUUID } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
import { projectWorkspaceStore } from '../sessions/store/sessionStores';
import { verifyExternalCaptureReference } from '../runtime/ExternalCaptureReference';
import { hashCaptureFile } from '../runtime/captureContentHash';
import { replayHistoryStore } from './captures/replay/ReplayHistoryStore';
import { RdcNativeFailure } from './RdcNativeProtocol';
import { replayDeviceIssue } from './captures/ReplayDeviceIssue';
import { replayDeviceService } from './captures/ReplayDeviceService';
import { ownsRdcInteractionLock, runRdcOperation, subscribeRdcInteractionLock } from './RdcOperationCoordinator';
import { assertRdcContextLeaseOwnership } from './RdcRuntimeContextRegistry';
import { harvestOwnedRdcDaemons } from './OwnedRdcDaemonRegistry';
import { replayLivePreviewStore } from './captures/replay/ReplayLivePreviewStore';
import { observeReplay, readReplayEvents } from './RdcReplayObservation';
import { registerRdcReplayFailure, replayObservationLease } from './RdcReplayFailure';
import { RdcDevicePreparation } from './RdcDevicePreparation';
import { closedReplayState, keyOf } from './RdcSessionBindings';
import type { RdcTurnBinding } from './RdcTurnBindings';
import type { RdcLifecycleOptions } from './RdcSessionRuntime';
import type {
  CaptureReplayState,
  CaptureReplayApplyRequest,
  CaptureReplayBindingRequest,
  CaptureReplayTarget,
} from '@shared/types/captureReplay';
import type { SessionScope, OpenProjectInputRequest, OpenedCaptureState } from '@shared/types/session';
import type { ReplayDeviceIssue } from '@shared/types/device';
import type { RdcCliInvokerSettings } from '@shared/types/settings';

/** Per-session application ownership. Device reservations survive uncertain native close. */
export class RdcSessionService extends RdcDevicePreparation {
  constructor() {
    super();
    subscribeRdcInteractionLock((sessionId) => {
      for (const binding of this.bindings.values())
        if (binding.state.sessionId === sessionId) this.publish(binding, {});
    });
    replayDeviceService.subscribe((snapshot) => {
      for (const binding of this.bindings.values()) {
        if (
          !binding.deviceId ||
          !['ready', 'checking', 'installing', 'starting', 'verifying'].includes(binding.state.preparation.phase)
        )
          continue;
        if (binding.state.preparation.targetDeviceId !== binding.deviceId) continue;
        const device = snapshot.devices.find((value) => value.id === binding.deviceId);
        // A failed discovery query is not evidence that an existing connection disappeared.
        if (device && !['missing', 'offline', 'unauthorized'].includes(device.adbState ?? 'unknown')) continue;
        binding.preparation?.controller.abort();
        this.revokePreparationConfirmation(binding);
        if (binding.state.preparation.issue?.deviceAction) {
          // Discovery can cancel verification, but cannot settle a device-side package mutation.
          this.publish(binding, { preparation: { ...binding.state.preparation, phase: 'failed' } });
          continue;
        }
        const issue: ReplayDeviceIssue = {
          code: device?.adbState === 'unauthorized' ? 'remote_unauthorized' : 'remote_device_offline',
          stage: 'checking',
          diagnostic: 'The selected ADB device is no longer available.',
          recovery: 'retry',
        };
        this.publish(binding, {
          preparation: { ...binding.state.preparation, phase: 'failed', issue },
          ...(binding.state.inputId
            ? {
                phase: 'error' as const,
                image: null,
                observation: null,
                imageEventId: null,
                error: { code: issue.code, message: issue.diagnostic, retry: 'close' as const, issue },
              }
            : {}),
        });
        // A live Agent/native owner retains its reservation until its normal cancellation/join has settled.
        if (!this.lock(binding))
          void this.serial(binding.state, async () => {
            try {
              await this.closeBinding(binding.state, binding, {});
              this.publish(binding, { contextId: null });
            } catch (error) {
              this.publish(binding, {
                preparation: {
                  ...binding.state.preparation,
                  phase: 'failed',
                  issue: binding.state.preparation.issue?.deviceAction
                    ? binding.state.preparation.issue
                    : replayDeviceIssue(error),
                },
              });
            }
          });
      }
    });
  }
  openProjectInput(request: OpenProjectInputRequest, options: RdcLifecycleOptions = {}): Promise<OpenedCaptureState> {
    if (!request.sessionId) return Promise.reject(new AppError('RDC_SCOPE_REQUIRED'));
    const scope = { projectId: request.projectId, sessionId: request.sessionId };
    return this.serial(scope, async () => {
      const binding = this.binding(scope);
      this.assertInteraction(binding, options);
      this.assertGeneration(binding, options.expectedGeneration);
      if (binding.state.preparation.issue?.deviceAction) throw new AppError('RDC_DEVICE_ACTION_UNCONFIRMED');
      if (this.blockedInputs.has(JSON.stringify([scope.projectId, request.inputId])))
        throw new AppError('RDC_INPUT_REMOVING');
      const key = keyOf(scope);
      const remoteId = request.replayDevice.type === 'android' ? request.replayDevice.id : null;
      const deviceOwner = remoteId ? this.devices.get(remoteId) : null;
      if (deviceOwner && deviceOwner !== key) throw new AppError('RDC_DEVICE_IN_USE', deviceOwner);
      const reusePrepared = Boolean(
        remoteId &&
        binding.state.preparation.phase === 'ready' &&
        binding.state.preparation.targetDeviceId === remoteId &&
        binding.runtime.isPreparedFor(scope, remoteId),
      );
      if (remoteId && !reusePrepared) throw new AppError('RDC_DEVICE_NOT_PREPARED');
      const previousState = structuredClone(binding.state);
      const previousCapture = binding.runtime.snapshotOpenedCaptureForSession(scope);
      if (remoteId) this.devices.set(remoteId, key);
      this.publish(binding, {
        phase: 'validating',
        operationId: randomUUID(),
        generation: binding.state.generation + 1,
        error: null,
      });
      try {
        const project = projectWorkspaceStore.getProjectById(scope.projectId);
        const reference = project?.inputs.find(
          (input) => input.inputId === request.inputId && input.source === 'external_reference',
        );
        if (reference && reference.filePath !== request.filePath) throw new AppError('CAPTURE_REFERENCE_INVALID_PATH');
        const verifyInput = async () => {
          if (!reference) return hashCaptureFile(request.filePath);
          const verified = await verifyExternalCaptureReference(reference);
          return { sha256: verified.contentSha256! };
        };
        const hashed = await verifyInput();
        if (options.expectedCaptureSha256 && hashed.sha256 !== options.expectedCaptureSha256) {
          throw new AppError('RDC_APPROVED_CAPTURE_CHANGED', 'capture bytes differ from the approved plan.');
        }
        this.assertInteraction(binding, options);
        if (!reusePrepared) await this.closeBinding(scope, binding, options, remoteId);
        this.publish(binding, {
          inputId: request.inputId,
          captureHash: hashed.sha256,
          contextId: reusePrepared ? binding.runtime.getContextId() : null,
          replayDeviceId: null,
          image: null,
          observation: null,
          imageEventId: null,
          appliedEventId: null,
          requestedEventId: null,
          events: [],
          targets: [],
          target: null,
        });
        if (project)
          await replayHistoryStore.saveSelection(project.rootPath, scope.sessionId, {
            inputId: request.inputId,
            captureSha256: hashed.sha256,
            deviceId: request.replayDevice.id,
          });
        this.assertInteraction(binding, options);
        binding.deviceId = remoteId;
        if (remoteId) this.devices.set(remoteId, key);
        this.publish(binding, { phase: remoteId ? 'connecting' : 'opening' });
        const open = () => {
          this.assertInteraction(binding, options);
          return binding.runtime.openProjectInput(request, {
            ...options,
            onStage: (phase) => this.publish(binding, { phase }),
          });
        };
        const contextId = reusePrepared ? binding.runtime.getContextId() : null;
        const opened = contextId ? await runRdcOperation(contextId, open) : await open();
        let verified: { sha256: string };
        try {
          verified = await verifyInput();
        } catch (error) {
          this.publish(binding, { captureHash: null, image: null, imageEventId: null });
          await this.closeBinding(scope, binding, options);
          throw error;
        }
        if (verified.sha256 !== hashed.sha256) {
          this.publish(binding, { captureHash: null, image: null, imageEventId: null });
          await this.closeBinding(scope, binding, options);
          throw new AppError('CAPTURE_CHANGED_DURING_OPEN', 'source bytes changed; reopen the current capture.');
        }
        this.publish(binding, {
          phase: 'loading_image',
          contextId: opened.contextId,
          replayDeviceId: request.replayDevice.id,
          ...(request.replayDevice.type === 'local'
            ? { preparation: { targetDeviceId: request.replayDevice.id, phase: 'ready' as const, issue: null } }
            : {}),
        });
        const owner = opened.runtimeContext;
        if (owner) {
          const lease = replayObservationLease(scope, owner);
          let operation: 'rd.session.get_replay_events' | 'rd.session.observe' = 'rd.session.get_replay_events';
          let operationArgs: Record<string, unknown> = {};
          try {
            await runRdcOperation(owner.contextId, async () => {
              this.publish(binding, { events: await readReplayEvents(owner, binding.runtime.getCliSettings()) });
              operation = 'rd.session.observe';
              operationArgs = { final_output: true };
              this.publish(
                binding,
                await observeReplay(owner, operationArgs, binding.runtime.getCliSettings(), {
                  sessionId: scope.sessionId,
                  generation: binding.state.generation,
                }),
              );
            });
          } catch (error) {
            const fatal = registerRdcReplayFailure(lease, error, operation, operationArgs);
            if (fatal) {
              this.publish(binding, { phase: 'error', error: fatal });
              throw error;
            }
            this.publish(binding, { error: { code: 'RDC_IMAGE_FAILED', message: String(error), retry: 'image' } });
          }
        }
        this.publish(binding, { phase: 'ready' });
        return opened;
      } catch (error) {
        // Do not release a reservation if the native lifecycle still owns a context.
        if (
          remoteId &&
          this.devices.get(remoteId) === key &&
          (!binding.runtime.getContextId() || binding.deviceId !== remoteId)
        )
          this.devices.delete(remoteId);
        if (
          error instanceof RdcNativeFailure &&
          binding.state.phase === 'error' &&
          binding.state.error?.retry === 'close' &&
          binding.state.error.code === error.nativeError.code
        )
          throw error;
        if (error instanceof Error && error.message.startsWith('RDC_APPROVED_CAPTURE_CHANGED:') && previousCapture) {
          this.publish(binding, {
            ...previousState,
            generation: binding.state.generation,
            revision: binding.state.revision,
            error: { code: 'RDC_APPROVED_CAPTURE_CHANGED', message: error.message, retry: 'open' },
          });
          throw error;
        }
        const issue = replayDeviceIssue(error);
        this.publish(binding, {
          phase: 'error',
          contextId: binding.runtime.getContextId(),
          ...(remoteId ? { preparation: { targetDeviceId: remoteId, phase: 'failed', issue } } : {}),
          error: { code: 'RDC_OPEN_FAILED', message: String(error), retry: 'open', issue },
        });
        throw error;
      }
    });
  }
  async clearOpenedCaptureForSession(scope: SessionScope, options: RdcLifecycleOptions = {}): Promise<boolean> {
    const binding = this.binding(scope);
    this.assertInteraction(binding, options);
    this.assertGeneration(binding, options.expectedGeneration);
    binding.preparation?.controller.abort();
    this.revokePreparationConfirmation(binding);
    return this.serial(scope, async () => {
      this.assertInteraction(binding, options);
      this.assertGeneration(binding, options.expectedGeneration);
      const operationId = randomUUID();
      this.publish(binding, { phase: 'closing', operationId, error: null });
      try {
        const closed = await this.closeBinding(scope, binding, options);
        if (binding.state.preparation.issue?.deviceAction) {
          this.publish(binding, { contextId: binding.runtime.getContextId(), phase: 'closed', operationId });
          throw new AppError(
            'RDC_DEVICE_ACTION_UNCONFIRMED',
            'verify the device installation before closing or deleting its session.',
          );
        }
        this.publish(binding, { ...closedReplayState(scope), operationId, generation: binding.state.generation + 1 });
        return closed;
      } catch (error) {
        const issue = binding.state.preparation.issue;
        this.publish(binding, {
          phase: 'error',
          error: {
            code: issue?.deviceAction ? 'RDC_DEVICE_ACTION_UNCONFIRMED' : 'RDC_CLOSE_FAILED',
            message: String(error),
            retry: 'close',
            ...(issue?.deviceAction ? { issue } : {}),
          },
        });
        throw error;
      }
    });
  }
  async rebindInput(
    projectId: string,
    oldInputId: string,
    input: import('@shared/types/session').ProjectInputRecord,
  ): Promise<void> {
    const hash =
      input.source === 'external_reference'
        ? { sha256: (await verifyExternalCaptureReference(input)).contentSha256! }
        : await hashCaptureFile(input.filePath);
    for (const binding of this.bindings.values()) {
      if (
        binding.state.projectId !== projectId ||
        binding.state.inputId !== oldInputId ||
        binding.state.captureHash !== hash.sha256
      )
        continue;
      binding.runtime.rebindInput(input.inputId, input.filePath);
      this.publish(binding, { inputId: input.inputId });
      const project = projectWorkspaceStore.getProjectById(projectId);
      if (project)
        await replayHistoryStore.saveSelection(project.rootPath, binding.state.sessionId, {
          inputId: input.inputId,
          captureSha256: hash.sha256,
          deviceId: binding.state.replayDeviceId ?? undefined,
        });
    }
  }
  async blockInputOperations<T>(projectId: string, inputId: string, operation: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([projectId, inputId]);
    if (this.blockedInputs.has(key)) throw new AppError('RDC_INPUT_REMOVING');
    this.blockedInputs.add(key);
    try {
      await Promise.allSettled([...this.lifecycle.values()]);
      return await operation();
    } finally {
      this.blockedInputs.delete(key);
    }
  }
  async closeMatchingCaptures(projectId: string, inputId: string): Promise<void> {
    const matches = this.listBindingsForProject(projectId).filter((binding) => binding.inputId === inputId);
    if (matches.some((binding) => binding.interactionLock))
      throw new AppError('RDC_INTERACTION_LOCKED', 'stop associated sessions first.');
    for (const binding of matches) await this.clearOpenedCaptureForSession(binding.scope);
  }
  async closeAll(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.bindings.values()].map((binding) => this.clearOpenedCaptureForSession(binding.state)),
    );
    const harvest = await harvestOwnedRdcDaemons();
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length || harvest.failed.length) {
      throw new AppError(
        'RDC_CLOSE_FAILED',
        `${failures.length + harvest.failed.length} session resources remain owned.`,
      );
    }
  }
  async switchActiveCapture(scope: CaptureReplayBindingRequest, captureId: string): Promise<void> {
    await this.serial(scope, async () => {
      const binding = this.binding(scope);
      this.assertInteraction(binding);
      this.assertGeneration(binding, scope.bindingGeneration);
      await binding.runtime.switchActiveCapture(captureId);
    });
  }
  async applyEventForSession(request: CaptureReplayApplyRequest): Promise<CaptureReplayState> {
    const binding = this.binding(request);
    this.assertInteraction(binding);
    this.assertGeneration(binding, request.bindingGeneration);
    this.assertReplayAvailable(binding);
    if (!binding.state.events.some((event) => event.eventId === request.eventId))
      throw new AppError('RDC_EVENT_INVALID');
    const operationId = randomUUID();
    this.publish(binding, { requestedEventId: request.eventId, operationId });
    return this.observe(
      request,
      {
        event_id: request.eventId,
        ...(request.target
          ? { target: { texture_id: request.target.textureId, rt_index: request.target.outputSlot } }
          : {}),
      },
      true,
      undefined,
      false,
      operationId,
    );
  }
  /** Main-only restoration under the same owning turn and newly prepared lease. */
  async restoreAgentPosition(
    request: CaptureReplayBindingRequest & {
      eventId: number;
      target: CaptureReplayTarget | null;
      isFinalOutput: boolean;
    },
    options: {
      binding: RdcTurnBinding;
      turnId: string;
      signal?: AbortSignal;
    },
  ): Promise<CaptureReplayState> {
    const binding = this.binding(request);
    const authorize = () => {
      options.signal?.throwIfAborted();
      const lease = assertRdcContextLeaseOwnership({ sessionId: request.sessionId, projectId: request.projectId });
      const identity = options.binding.identity;
      if (
        !ownsRdcInteractionLock(request.sessionId, options.turnId) ||
        !lease ||
        lease.delegatedFrom ||
        !identity ||
        identity.ownerSessionId !== request.sessionId ||
        identity.contextId !== lease.contextId ||
        identity.version !== lease.version ||
        identity.runtimeContext?.captureFileId !== lease.runtimeContext.captureFileId ||
        identity.runtimeContext?.replaySessionId !== lease.runtimeContext.replaySessionId
      ) {
        throw new AppError('RDC_RESTORE_OWNER_INVALID', 'the prepared owning turn and replay are required.');
      }
      this.assertInteraction(binding, options);
      this.assertGeneration(binding, request.bindingGeneration);
      this.assertReplayAvailable(binding);
    };
    authorize();
    if (!binding.state.events.some((event) => event.eventId === request.eventId))
      throw new AppError('RDC_EVENT_INVALID');
    const operationId = randomUUID();
    this.publish(binding, { requestedEventId: request.eventId, operationId });
    const args = request.isFinalOutput
      ? { final_output: true }
      : {
          event_id: request.eventId,
          ...(request.target
            ? {
                target: {
                  texture_id: request.target.textureId,
                  ...(request.target.outputSlot === null ? {} : { rt_index: request.target.outputSlot }),
                },
              }
            : {}),
        };
    const state = await this.observe(request, args, true, options.binding.cli, false, operationId, {
      ...options,
      authorize,
    });
    authorize();
    if (
      state.operationId !== operationId ||
      state.appliedEventId !== request.eventId ||
      state.isFinalOutput !== request.isFinalOutput ||
      JSON.stringify(state.target) !== JSON.stringify(request.target ?? null)
    ) {
      throw new AppError('RDC_RESTORE_UNCONFIRMED', 'replay position or target does not match the saved state.');
    }
    return state;
  }
  async refreshFrameForSession(scope: CaptureReplayBindingRequest): Promise<CaptureReplayState> {
    const binding = this.binding(scope);
    this.assertGeneration(binding, scope.bindingGeneration);
    this.assertReplayAvailable(binding);
    return this.observe(scope, {}, true);
  }
  async observeAgentOperation(
    scope: SessionScope,
    operationId: string,
    toolCallId: string,
    frozenCli?: RdcCliInvokerSettings,
    alreadySerialized = false,
  ): Promise<void> {
    if (!this.snapshotOpenedCaptureForSession(scope)) return;
    const generation = this.binding(scope).state.generation;
    const state = await this.observe(scope, {}, false, frozenCli, alreadySerialized);
    if (this.binding(scope).state.generation !== generation) return;
    const project = projectWorkspaceStore.getProjectById(scope.projectId);
    if (!project || !state.captureHash || (state.appliedEventId === null && !state.error)) return;
    const summary = `${operationId}${state.appliedEventId === null ? '' : ` · EID ${state.appliedEventId}`}${state.target ? ` · ${state.target.textureId}` : ''}${state.observation ? ` · ${state.observation.modificationState}` : ''}`;
    try {
      const imageBytes = state.image ? await replayLivePreviewStore.read(scope.sessionId) : undefined;
      await replayHistoryStore.append(
        { projectRoot: project.rootPath, sessionId: scope.sessionId, captureSha256: state.captureHash },
        {
          eventId: state.appliedEventId,
          operationId,
          summary,
          toolCallId,
          modificationState: state.observation?.modificationState,
          nativeRevision: state.observation?.nativeRevision,
          displayParameters: state.observation?.displayParameters,
          resourceId: state.target?.textureId,
          bindingGeneration: state.generation,
          ...(state.error ? { failure: `${state.error.code}: ${state.error.message}` } : {}),
        },
        imageBytes,
      );
      if (this.binding(scope).state.generation === generation) this.publish(this.binding(scope), {});
    } catch (error) {
      if (this.binding(scope).state.generation === generation)
        this.publish(this.binding(scope), {
          error: { code: 'REPLAY_SAVE_FAILED', message: String(error), retry: null },
        });
    }
  }
  private async observe(
    scope: SessionScope,
    args: Record<string, unknown>,
    human: boolean,
    frozenCli?: RdcCliInvokerSettings,
    alreadySerialized = false,
    operationId = randomUUID(),
    agentRestore?: { binding: RdcTurnBinding; signal?: AbortSignal; authorize: () => void },
  ): Promise<CaptureReplayState> {
    const binding = this.binding(scope);
    if (human) this.assertInteraction(binding, agentRestore);
    const owner = binding.runtime.snapshotOpenedCaptureForSession(scope)?.runtimeContext;
    if (!owner) throw new AppError('RDC_NOT_OPEN');
    const generation = binding.state.generation;
    const operation = async () => {
      if (generation !== binding.state.generation) return;
      if (human) {
        this.assertInteraction(binding, agentRestore);
        this.assertReplayAvailable(binding);
        agentRestore?.authorize();
      }
      // A queued slider request superseded by a newer position must not mutate the context.
      if (args.event_id !== undefined && args.event_id !== binding.state.requestedEventId) return;
      const lease = replayObservationLease(scope, owner);
      this.publish(binding, { phase: 'applying', operationId, error: null });
      try {
        const live = { sessionId: scope.sessionId, generation };
        const observed = agentRestore
          ? await observeReplay(owner, args, frozenCli ?? binding.runtime.getCliSettings(), live, agentRestore.signal)
          : await observeReplay(owner, args, frozenCli ?? binding.runtime.getCliSettings(), live);
        if (generation === binding.state.generation)
          this.publish(binding, {
            ...observed,
            operationId,
            ...(!human ? { requestedEventId: observed.appliedEventId ?? null } : {}),
            phase: 'ready',
          });
      } catch (error) {
        const fatal = registerRdcReplayFailure(lease, error, 'rd.session.observe', args);
        if (generation === binding.state.generation)
          this.publish(binding, {
            operationId,
            ...(!human ? { requestedEventId: null } : {}),
            image: null,
            observation: null,
            imageEventId: null,
            appliedEventId: null,
            target: null,
            targets: [],
            isFinalOutput: false,
            phase: fatal ? 'error' : 'ready',
            error: fatal ?? { code: 'RDC_OBSERVE_FAILED', message: String(error), retry: 'image' },
          });
      }
    };
    if (alreadySerialized) await operation();
    else await runRdcOperation(owner.contextId, operation);
    return this.snapshotReplayForSession(scope);
  }
}

export const rdcSessionService = new RdcSessionService();
