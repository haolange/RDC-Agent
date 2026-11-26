import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
import { ipcApprovalTokenService } from '../runtime/IpcApprovalTokenService';
import { RdcNativeFailure } from './RdcNativeProtocol';
import {
  replayDeviceIssue,
  deviceInstallationIdentity,
  type DeviceInstallationIdentity,
} from './captures/ReplayDeviceIssue';
import { replayDeviceService } from './captures/ReplayDeviceService';
import { ownsRdcInteractionLock } from './RdcOperationCoordinator';
import { RdcSessionBindings, keyOf, type RdcReplayBinding } from './RdcSessionBindings';
import type { RdcTurnBinding } from './RdcTurnBindings';
import type { CaptureReplayBindingRequest } from '@shared/types/captureReplay';
import type { ReplayDeviceIssue } from '@shared/types/device';
import type { DevicePreparationRequest, DevicePreparationResult } from '@shared/types/captureReplay';

/**
 * RdcDevicePreparation — preparing and cancelling a replay device for a session: close
 * confirmation, Android device reservation, installation recovery and the native preparation run.
 */
export class RdcDevicePreparation extends RdcSessionBindings {
  private preparationConfirmation(
    binding: RdcReplayBinding,
    deviceId: string,
    kind: 'close_capture',
  ): DevicePreparationResult {
    this.revokePreparationConfirmation(binding);
    const name = createHash('sha256')
      .update(
        JSON.stringify({
          scope: keyOf(binding.state),
          generation: binding.state.generation,
          deviceId,
          contextId: binding.runtime.getContextId(),
          captureHash: binding.state.captureHash,
        }),
      )
      .digest('hex');
    const token = ipcApprovalTokenService.issue({
      action: 'device.prepare',
      scope: 'project',
      projectRoot: binding.state.projectId,
      name,
    });
    binding.confirmation = { token, name, generation: binding.state.generation, deviceId, kind };
    return { success: false, state: this.snapshotReplayForSession(binding.state), confirmation: { token, kind } };
  }
  async prepareDevice(request: DevicePreparationRequest): Promise<DevicePreparationResult> {
    return this.prepareDeviceWithAuthority(request);
  }
  /** The owning turn may reconnect its already approved device with its frozen CLI. */
  async prepareAgentDevice(
    request: DevicePreparationRequest,
    authority: {
      binding: RdcTurnBinding;
      turnId: string;
      signal?: AbortSignal;
      assertAuthorized: () => void;
    },
  ): Promise<DevicePreparationResult> {
    return this.prepareDeviceWithAuthority(request, authority);
  }
  private async prepareDeviceWithAuthority(
    request: DevicePreparationRequest,
    authority?: {
      binding: RdcTurnBinding;
      turnId: string;
      signal?: AbortSignal;
      assertAuthorized: () => void;
    },
  ): Promise<DevicePreparationResult> {
    const scope = { projectId: request.projectId, sessionId: request.sessionId };
    const binding = this.binding(scope);
    const assertAuthorized = () => {
      authority?.signal?.throwIfAborted();
      authority?.assertAuthorized();
      if (authority && !ownsRdcInteractionLock(scope.sessionId, authority.turnId))
        throw new AppError('RDC_RECOVERY_OWNER_INVALID');
      this.assertInteraction(binding, authority);
    };
    assertAuthorized();
    this.assertPreparationGeneration(binding, request.bindingGeneration, Boolean(request.confirmationToken));
    const recoveringIssue = binding.state.preparation.issue?.deviceAction ? binding.state.preparation.issue : null;
    if (
      recoveringIssue &&
      (request.deviceId !== binding.state.preparation.targetDeviceId ||
        request.confirmationToken ||
        !binding.installationEvidence)
    ) {
      return { success: false, state: this.snapshotReplayForSession(scope), error: recoveringIssue };
    }
    const device = replayDeviceService.getDeviceById(request.deviceId);
    if (!device) throw new AppError('RDC_DEVICE_NOT_FOUND');
    const owner = device.type === 'android' ? this.devices.get(device.id) : null;
    if (owner && owner !== keyOf(scope)) throw new AppError('RDC_DEVICE_IN_USE');
    if (binding.preparation?.deviceId === device.id && !request.confirmationToken) return binding.preparation.pending;
    if (
      !request.confirmationToken &&
      binding.runtime.snapshotOpenedCaptureForSession(scope) &&
      binding.state.replayDeviceId === device.id &&
      (device.type === 'local' || binding.state.preparation.phase === 'ready')
    ) {
      return { success: true, state: this.snapshotReplayForSession(scope) };
    }
    let expectedBindingIdentity: string | undefined;
    let closeConfirmed = false;
    if (request.confirmationToken) {
      const confirmation = binding.confirmation;
      if (
        !confirmation ||
        confirmation.token !== request.confirmationToken ||
        confirmation.deviceId !== device.id ||
        confirmation.generation !== request.bindingGeneration
      ) {
        this.revokePreparationConfirmation(binding);
        throw new AppError('RDC_DEVICE_CONFIRMATION_STALE');
      }
      binding.confirmation = undefined;
      if (
        !ipcApprovalTokenService.consume({
          token: request.confirmationToken,
          action: 'device.prepare',
          scope: 'project',
          projectRoot: scope.projectId,
          name: confirmation.name,
        })
      )
        throw new AppError('RDC_DEVICE_CONFIRMATION_STALE');
      closeConfirmed = true;
    } else if (
      binding.runtime.snapshotOpenedCaptureForSession(scope) &&
      (binding.state.replayDeviceId !== device.id || binding.state.preparation.phase !== 'ready')
    ) {
      return Promise.resolve(this.preparationConfirmation(binding, device.id, 'close_capture'));
    }
    if (
      binding.runtime.snapshotOpenedCaptureForSession(scope) &&
      (binding.state.replayDeviceId !== device.id || binding.state.preparation.phase !== 'ready') &&
      !closeConfirmed
    )
      throw new AppError('RDC_DEVICE_CLOSE_CONFIRMATION_REQUIRED');
    this.revokePreparationConfirmation(binding);
    const baseGeneration = binding.preparation?.baseGeneration ?? binding.state.generation;
    binding.preparation?.controller.abort();
    const controller = new AbortController();
    const abortFromOwner = () => controller.abort();
    if (authority?.signal?.aborted) abortFromOwner();
    else authority?.signal?.addEventListener('abort', abortFromOwner, { once: true });
    const generation = binding.state.generation + 1;
    let unconfirmedIssue: ReplayDeviceIssue | undefined;
    let installationIdentity: DeviceInstallationIdentity | undefined;
    let installationVerified = !recoveringIssue;
    this.publish(binding, {
      generation,
      operationId: randomUUID(),
      error: null,
      preparation: { targetDeviceId: device.id, phase: 'checking', issue: recoveringIssue },
    });
    const pending = this.serial(scope, async (): Promise<DevicePreparationResult> => {
      const current = () => binding.state.generation === generation && !controller.signal.aborted;
      try {
        if (!current()) return { success: false, state: this.snapshotReplayForSession(scope) };
        assertAuthorized();
        if (recoveringIssue) {
          const evidence = binding.installationEvidence!;
          const inspected = await binding.runtime.inspectReplayDeviceInstallation(scope, device, {
            signal: controller.signal,
            expectedBindingIdentity: evidence.bindingIdentity,
          });
          if (!current()) throw controller.signal.reason ?? new AppError('RDC_DEVICE_PREPARATION_CANCELLED');
          if (
            inspected.deviceSerial !== evidence.deviceSerial ||
            inspected.packageName !== evidence.packageName ||
            inspected.apkSha256 !== evidence.apkSha256
          ) {
            throw new AppError('RDC_REMOTE_INSTALLATION_IDENTITY_CHANGED');
          }
          if (inspected.state !== 'clear')
            throw new Error(inspected.diagnostic ?? 'RDC_REMOTE_INSTALLATION_STILL_UNCONFIRMED');
          installationVerified = true;
          expectedBindingIdentity = evidence.bindingIdentity;
          binding.installationEvidence = undefined;
          this.publish(binding, { preparation: { targetDeviceId: device.id, phase: 'checking', issue: null } });
        }
        const previousTarget = binding.deviceId;
        if (!binding.runtime.isPreparedFor(scope, device.id)) {
          await this.closeBinding(scope, binding, authority ? { binding: authority.binding } : {});
          this.publish(binding, {
            phase: 'closed',
            contextId: null,
            replayDeviceId: null,
            inputId: null,
            captureHash: null,
            image: null,
            observation: null,
            requestedEventId: null,
            appliedEventId: null,
            imageEventId: null,
            events: [],
            targets: [],
            target: null,
          });
        } else if (previousTarget && previousTarget !== device.id) throw new AppError('RDC_DEVICE_BINDING_MISMATCH');
        if (!current()) return { success: false, state: this.snapshotReplayForSession(scope) };
        if (device.type === 'android') {
          // Other sessions may have completed their cleanup while this queue was awaiting native close.
          // The final ownership check and reservation are one synchronous admission step.
          const currentOwner = this.devices.get(device.id);
          if (currentOwner && currentOwner !== keyOf(scope)) throw new AppError('RDC_DEVICE_IN_USE');
          this.devices.set(device.id, keyOf(scope));
          binding.deviceId = device.id;
        }
        assertAuthorized();
        await binding.runtime.prepareReplayDevice(scope, device, {
          signal: controller.signal,
          expectedBindingIdentity,
          binding: authority?.binding,
          onPreparationStage: (phase) => {
            if (current() && binding.state.preparation.phase !== phase)
              this.publish(binding, { preparation: { ...binding.state.preparation, phase } });
          },
          onInstallation: (installation) => {
            if (
              binding.preparation?.controller === controller &&
              binding.state.preparation.targetDeviceId === device.id
            ) {
              this.publish(binding, { preparation: { ...binding.state.preparation, installation } });
            }
          },
          onDeviceAction: (issue, identity) => {
            unconfirmedIssue = issue;
            installationIdentity = identity;
          },
        });
        if (!current()) throw controller.signal.reason ?? new AppError('RDC_DEVICE_PREPARATION_CANCELLED');
        assertAuthorized();
        this.publish(binding, {
          contextId: binding.runtime.getContextId(),
          preparation: { targetDeviceId: device.id, phase: 'ready', issue: null },
        });
        return { success: true, state: this.snapshotReplayForSession(scope) };
      } catch (error) {
        const bindingIdentity = binding.runtime.getPreparationBindingIdentity();
        let issue = unconfirmedIssue ?? replayDeviceIssue(error);
        if (!issue.deviceAction && binding.state.preparation.issue?.deviceAction)
          issue = binding.state.preparation.issue;
        if (!issue.deviceAction && !installationVerified && recoveringIssue) issue = recoveringIssue;
        if (issue.deviceAction) {
          const identity =
            installationIdentity ??
            (error instanceof RdcNativeFailure ? deviceInstallationIdentity(error.nativeError.details) : undefined);
          if (identity && bindingIdentity) binding.installationEvidence = { ...identity, bindingIdentity };
          // An unresolved device-side mutation survives cancellation and invalidates queued replacement intents.
          binding.preparation?.controller.abort();
          this.revokePreparationConfirmation(binding);
          this.publish(binding, {
            generation: binding.state.generation + 1,
            preparation: { targetDeviceId: device.id, phase: 'failed', issue },
          });
          await this.closeBinding(scope, binding, authority ? { binding: authority.binding } : {});
          this.publish(binding, { contextId: binding.runtime.getContextId() });
          return { success: false, state: this.snapshotReplayForSession(scope), error: issue };
        }
        // A cancelled consumer cannot release a newer context: this serial section owns cleanup until it exits.
        try {
          await this.closeBinding(scope, binding, authority ? { binding: authority.binding } : {});
        } catch (cleanupError) {
          const retainedIssue = {
            ...issue,
            diagnostic: `${issue.diagnostic}\nCleanup not confirmed: ${replayDeviceIssue(cleanupError).diagnostic}`,
          };
          if (binding.state.generation === generation)
            this.publish(binding, {
              preparation: { targetDeviceId: device.id, phase: 'failed', issue: retainedIssue },
            });
          // Keep the primary native error and its details; failed cleanup retains ownership.
          if (error instanceof Error) {
            error.message = retainedIssue.diagnostic;
            throw error;
          }
          // eslint-disable-next-line preserve-caught-error -- the native failure is the cause; the cleanup failure is in the message.
          throw new Error(retainedIssue.diagnostic, { cause: error });
        }
        if (!current()) return { success: false, state: this.snapshotReplayForSession(scope) };
        this.publish(binding, { contextId: null, preparation: { targetDeviceId: device.id, phase: 'failed', issue } });
        return { success: false, state: this.snapshotReplayForSession(scope), error: issue };
      }
    }).finally(() => {
      authority?.signal?.removeEventListener('abort', abortFromOwner);
      if (binding.preparation?.controller === controller) binding.preparation = undefined;
    });
    binding.preparation = { deviceId: device.id, baseGeneration, controller, pending };
    return pending;
  }
  async cancelDevicePreparation(request: CaptureReplayBindingRequest): Promise<DevicePreparationResult> {
    const binding = this.binding(request);
    this.assertInteraction(binding);
    this.assertPreparationGeneration(binding, request.bindingGeneration);
    if (binding.runtime.snapshotOpenedCaptureForSession(request)) {
      if (binding.confirmation) {
        this.revokePreparationConfirmation(binding);
        return { success: true, state: this.snapshotReplayForSession(request) };
      }
      throw new AppError('RDC_CAPTURE_CLOSE_REQUIRED');
    }
    binding.preparation?.controller.abort();
    this.revokePreparationConfirmation(binding);
    if (!binding.state.preparation.issue?.deviceAction)
      this.publish(binding, {
        generation: binding.state.generation + 1,
        preparation: { ...binding.state.preparation, phase: 'cancelled', issue: null },
      });
    return this.serial(request, async () => {
      if (!binding.runtime.snapshotOpenedCaptureForSession(request)) await this.closeBinding(request, binding, {});
      this.publish(binding, { contextId: binding.runtime.getContextId() });
      const issue = binding.state.preparation.issue;
      return {
        success: !issue?.deviceAction,
        state: this.snapshotReplayForSession(request),
        ...(issue?.deviceAction ? { error: issue } : {}),
      };
    });
  }
}
