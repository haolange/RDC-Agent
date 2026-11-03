import { settingsService } from '../settings/settings-core/SettingsService';
import { rdcCliInvokerService } from './RdcCliInvokerService';
import { parseRdcNativeResult, RdcNativeFailure } from './RdcNativeProtocol';
import { freezeRdcTurnBinding } from './RdcTurnBindings';
import { withRdcHostRuntimeEnv } from './withRdcHostRuntimeEnv';
import { shellInvocationService } from '../tools/ShellInvocationService';
/**
 * RdcSessionService - RDC runtime context state and fixed native CLI lifecycle.
 */

import { randomUUID } from 'node:crypto';
import { withRdcOpenProgress } from './RdcOpenProgress';
import { withRdcRemoteProgress, type RdcRemoteProgress } from './RdcRemoteProgress';
import { assertRemotePreparationContract, connectSessionReplayDevice, inspectSessionReplayInstallation, remotePreparationBindingIdentity, type RdcRemoteConnection, type RemoteInstallationInspection } from './RdcRemoteConnection';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import type {
  CaptureDescriptor,
  ContextSnapshot,
  OpenedCaptureState,
  OpenedCapturePreview,
  OpenedCapturePreviewAttempt,
  OpenedCapturePreviewError,
  OpenProjectInputRequest,
  RdcRuntimeContext,
  SessionScope,
} from '@shared/types/session';
import type { ReplayDeviceEntry } from '@shared/types/device';
import type { RdcTurnBinding } from './RdcTurnBindings';
import { setRdcRuntimeContextForSession, getDelegatedChildSessionId } from './RdcRuntimeContextRegistry';
import { forgetOwnedRdcDaemon, rememberOwnedRdcDaemon } from './OwnedRdcDaemonRegistry';
import { hostRdcIntermediateRoot, RDC_INTERMEDIATE_ROOT_ENV } from './withRdcHostRuntimeEnv';

interface PreviewLoadResult {
  preview: OpenedCapturePreview | null;
  error: OpenedCapturePreviewError | null;
  attempts: OpenedCapturePreviewAttempt[];
}

const DEFAULT_RUNTIME_OWNER = 'rdc-agent';

async function callNative(
  operation: string,
  args: Record<string, unknown>,
  contextId: string,
  binding: RdcTurnBinding,
  signal?: AbortSignal,
): Promise<{ ok: boolean; data: Record<string, unknown>; error?: string }> {
  signal?.throwIfAborted();
  const result = await rdcCliInvokerService.executeCLI('call', [
    operation, '--args-json', JSON.stringify(args), '--daemon-context', contextId,
  ], { contextId, abortSignal: signal, settings: binding.cli });
  try {
    signal?.throwIfAborted();
    const payload = parseRdcNativeResult(result, contextId, operation);
    if (operation === 'rd.capture.open_file' && (typeof payload.data.capture_file_id !== 'string' || !payload.data.capture_file_id)) throw new Error('RDC_CLI_PROTOCOL: capture_file_id is required.');
    if (operation === 'rd.capture.open_replay' && (typeof payload.data.session_id !== 'string' || !payload.data.session_id)) throw new Error('RDC_CLI_PROTOCOL: session_id is required.');
    if (operation === 'rd.capture.open_replay' && payload.data.capture_file_id !== args.capture_file_id) throw new Error('RDC_CAPTURE_MISMATCH: replay capture identity does not match the opened file.');
    return { ok: true, data: payload.data };
  } catch (error) {
    if (error instanceof RdcNativeFailure) throw error;
    return { ok: false, data: {}, error: error instanceof Error ? error.message : String(error) };
  }
}

const emptyPreviewLoadResult = (): PreviewLoadResult => ({
  preview: null,
  error: null,
  attempts: [],
});

export interface RdcLifecycleOptions extends RdcRemoteProgress { expectedGeneration?: number; onStage?: (stage: 'connecting' | 'opening' | 'transferring') => void; contextId?: string; binding?: RdcTurnBinding; signal?: AbortSignal; repairFingerprint?: string; expectedBindingIdentity?: string }

export class RdcSessionRuntime {
  private contextId: string | null = null;
  private ownerScope: SessionScope | null = null;
  private lifecycleBinding: RdcTurnBinding | undefined;
  private runtimeOwner: string | null = null;
  private ownerLeaseId: string | null = null;
  private captures: CaptureDescriptor[] = [];
  private activeCaptureId: string | null = null;
  private deviceLabel = 'Local';
  private replayDevice: ReplayDeviceEntry | null = null;
  private remoteStatus: 'connected' | 'online' | 'disconnected' | 'error' = 'disconnected';
  private openedCapture: OpenedCaptureState | null = null;
  private runtimeContext: RdcRuntimeContext | null = null;
  private remoteConnection: RdcRemoteConnection | null = null;

  async openProjectInput(request: OpenProjectInputRequest, options: RdcLifecycleOptions = {}): Promise<OpenedCaptureState> {
    options.signal?.throwIfAborted();
    const replayDevice = request.replayDevice;
    const isRemoteReplay = replayDevice.type === 'android';
    const scope = { projectId: request.projectId, sessionId: request.sessionId ?? '' };
    if (isRemoteReplay) {
      if (!this.isOwnedBy(scope) || !this.remoteConnection || this.remoteConnection.deviceId !== replayDevice.id) {
        throw new Error('RDC_DEVICE_NOT_PREPARED');
      }
      const currentBinding = await this.resolveBinding(options);
      if (JSON.stringify(currentBinding.cli) !== JSON.stringify(this.lifecycleBinding?.cli)
        || currentBinding.definitionsFingerprint !== this.lifecycleBinding?.definitionsFingerprint) throw new Error('RDC_CLI_BINDING_CHANGED');
      if (this.runtimeContext) {
        const previous = this.runtimeContext;
        const closed = await callNative('rd.capture.close_replay', { session_id: previous.replaySessionId }, this.contextId!, currentBinding, options.signal);
        if (!closed.ok) throw new Error(closed.error ?? 'RDC_CAPTURE_CLOSE_FAILED');
        // The old replay is now gone even if releasing its file later fails. Keep only context ownership.
        setRdcRuntimeContextForSession(scope.sessionId, null);
        this.openedCapture = null; this.runtimeContext = null; this.captures = []; this.activeCaptureId = null;
        if (previous.captureFileId) {
          const released = await callNative('rd.capture.close_file', { capture_file_id: previous.captureFileId }, this.contextId!, currentBinding, options.signal);
          if (!released.ok) throw new Error(released.error ?? 'RDC_CAPTURE_CLOSE_FAILED');
        }
      }
    } else {
      await this.closeOrReplaceOpenedCapture(options);
      this.lifecycleBinding = await this.resolveBinding(options);
      const allocated = 'rdc-' + randomUUID();
      await this.ensureOwnedDaemon(allocated, this.lifecycleBinding, options.signal);
      this.contextId = allocated;
      this.ownerScope = scope;
    }
    options = { ...options, binding: this.lifecycleBinding };
    const allocatedContextId = this.contextId!;
    const preparedRemote = this.remoteConnection;
    const capture: CaptureDescriptor = {
      id: request.inputId,
      filePath: request.filePath,
      role: 'primary',
      backendHint: isRemoteReplay ? 'remote' : 'local',
      status: 'pending',
      ownerSessionId: request.sessionId,
    };

    this.captures = [capture];
    this.activeCaptureId = capture.id;
    this.replayDevice = replayDevice;
    this.deviceLabel = replayDevice.label;
    this.remoteStatus = 'disconnected';



    let resultData: Record<string, unknown>;
    let runtimeContext: RdcRuntimeContext;
    try {
      options.onStage?.('opening');
      if (isRemoteReplay) {
        if (!preparedRemote?.contextId || !preparedRemote.remoteId || preparedRemote.contextId !== allocatedContextId) {
          throw new Error('Remote replay requires a prepared remote context and remoteId.');
        }
        const result = await withRdcOpenProgress(allocatedContextId, options.binding!.cli, options.onStage, async () => {
          const openedFile = await callNative('rd.capture.open_file', { file_path: request.filePath, read_only: true }, allocatedContextId, options.binding!, options.signal);
          if (!openedFile.ok) return openedFile;
          const opened = await callNative('rd.capture.open_replay', {
            capture_file_id: openedFile.data.capture_file_id,
            options: { remote_id: preparedRemote.remoteId },
          }, allocatedContextId, options.binding!, options.signal);
          return { ok: opened.ok, data: opened.data, error: opened.error };
        });
        if (!result.ok) {
          throw new Error(result.error ?? 'Remote replay open failed.');
        }
        if (result.data.remote_id !== preparedRemote.remoteId) throw new Error('RDC_REMOTE_MISMATCH: remote replay identity does not match the selected connection.');
        resultData = {
          ...result.data,
          backend: 'remote',
          remote_status: 'online',
          device_id: replayDevice.id,
          device_label: replayDevice.label,
          context_id: result.data.context_id,
        };
      } else {
        const openedFile = await callNative('rd.capture.open_file', { file_path: request.filePath, read_only: true }, allocatedContextId, options.binding!, options.signal);
        const result = openedFile.ok
          ? await callNative('rd.capture.open_replay', { capture_file_id: openedFile.data.capture_file_id, options: {} }, allocatedContextId, options.binding!, options.signal)
          : openedFile;
        if (!result.ok) {
          throw new Error(result.error ?? 'Local capture open failed.');
        }
        resultData = result.data;
      }
      options.signal?.throwIfAborted();
      runtimeContext = this.extractRuntimeContext(resultData, {
        backend: isRemoteReplay ? 'remote' : 'local',
        deviceId: replayDevice.id,
        deviceLabel: replayDevice.label,
      });
      if (runtimeContext.contextId !== allocatedContextId) throw new Error('RDC_CONTEXT_MISMATCH: native operation returned a different owning context.');
      if (isRemoteReplay && runtimeContext.remoteId !== preparedRemote?.remoteId) throw new Error('RDC_REMOTE_MISMATCH: native replay belongs to a different remote.');
    } catch (error) {
      capture.status = 'error';
      this.captures = [capture];
      this.remoteStatus = 'error';
      // Keep the allocated context until an explicit close is confirmed, even after partial open failure.
      throw error;
    }

    this.applyRuntimeContext(runtimeContext, request.sessionId, request.projectId ?? null);
    const captureIndex = this.captures.findIndex((item) => item.id === capture.id);
    this.captures[captureIndex] = {
      ...this.captures[captureIndex],
      captureFileId: runtimeContext.captureFileId,
      status: 'open',
      sessionId: runtimeContext.replaySessionId,
      replaySessionId: runtimeContext.replaySessionId,
      contextId: runtimeContext.contextId,
    };

    const previewResult = emptyPreviewLoadResult();

    const openedCapture = this.createOpenedCaptureState(
      request.projectId,
      request.sessionId,
      request.inputId,
      request.filePath,
      replayDevice,
      previewResult,
    );
    this.openedCapture = openedCapture;
    return openedCapture;
  }

  async closeOrReplaceOpenedCapture(options: RdcLifecycleOptions = {}): Promise<void> {
    const previousCapture = this.openedCapture;
    await this.teardownRuntime(options);
    this.resetRuntimeState(previousCapture);
    if (previousCapture) {
      runtimeLogService.log({
        scope: 'app',
        namespace: 'capture',
        severity: 'info',
        title: 'Capture replaced',
        summary: `${previousCapture.inputId} 的打开态已清理。`,
        projectId: previousCapture.projectId,
        raw: previousCapture,
      });
    }
  }

  rebindInput(inputId: string, filePath: string): void {
    if (!this.openedCapture) return;
    this.openedCapture = { ...this.openedCapture, inputId, filePath, captureId: inputId };
    this.captures = this.captures.map(capture => ({ ...capture, id: inputId, filePath }));
    this.activeCaptureId = inputId;
  }
  async switchActiveCapture(captureId: string): Promise<void> {
    const capture = this.captures.find((item) => item.id === captureId);
    if (!capture) {
      throw new Error(`Capture ${captureId} not found`);
    }

    if (capture.status === 'pending') {
      throw new Error(`Capture ${captureId} has not been opened by a configured RDC shell action.`);
    }

    this.activeCaptureId = captureId;
  }

  private async resolveBinding(options: RdcLifecycleOptions): Promise<RdcTurnBinding> {
    if (options.binding) return options.binding;
    const cli = withRdcHostRuntimeEnv(structuredClone(settingsService.getAll().tooling.rdcCli));
    const catalog = await rdcCliInvokerService.loadCatalog(cli);
    options.signal?.throwIfAborted();
    return freezeRdcTurnBinding(cli, catalog.tools);
  }

  async prepareReplayDevice(scope: SessionScope, device: ReplayDeviceEntry, options: RdcLifecycleOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    if (device.type === 'local') {
      if (this.openedCapture) {
        if (this.isOwnedBy(scope) && this.replayDevice?.id === device.id) return;
        throw new Error('RDC_CAPTURE_CLOSE_REQUIRED');
      }
      await this.closeOrReplaceOpenedCapture(options);
      this.ownerScope = scope; this.replayDevice = device; this.deviceLabel = device.label;
      return;
    }
    const binding = await this.resolveBinding(options);
    assertRemotePreparationContract(binding);
    if (options.expectedBindingIdentity && remotePreparationBindingIdentity(binding) !== options.expectedBindingIdentity) {
      throw new Error('RDC_DEVICE_CONFIRMATION_STALE: native CLI or catalog changed before execution.');
    }
    if (this.openedCapture && (!this.isOwnedBy(scope) || this.remoteConnection?.deviceId !== device.id
      || JSON.stringify(binding.cli) !== JSON.stringify(this.lifecycleBinding?.cli)
      || binding.definitionsFingerprint !== this.lifecycleBinding?.definitionsFingerprint)) throw new Error('RDC_CAPTURE_CLOSE_REQUIRED');
    if (this.remoteConnection && this.isOwnedBy(scope) && this.remoteConnection.deviceId === device.id
      && JSON.stringify(binding.cli) === JSON.stringify(this.lifecycleBinding?.cli)
      && binding.definitionsFingerprint === this.lifecycleBinding?.definitionsFingerprint) {
      const ping = await callNative('rd.remote.ping', { remote_id: this.remoteConnection.remoteId }, this.contextId!, binding, options.signal);
      if (!ping.ok) throw new Error(ping.error ?? 'RDC_REMOTE_NOT_READY');
      return;
    }
    await this.closeOrReplaceOpenedCapture(options);
    this.ownerScope = scope;
    this.replayDevice = device;
    this.deviceLabel = device.label;
    this.lifecycleBinding = binding;
    const contextId = 'rdc-' + randomUUID();
    await this.ensureOwnedDaemon(contextId, binding, options.signal);
    this.contextId = contextId;
    this.remoteConnection = await withRdcRemoteProgress(contextId, binding.cli, options.signal, options, () =>
      connectSessionReplayDevice(device, contextId, binding, options.signal, options.repairFingerprint));
    this.remoteStatus = 'connected';
  }

  async inspectReplayDeviceInstallation(scope: SessionScope, device: ReplayDeviceEntry, options: RdcLifecycleOptions): Promise<RemoteInstallationInspection> {
    const binding = await this.resolveBinding(options); assertRemotePreparationContract(binding);
    if (!options.expectedBindingIdentity || remotePreparationBindingIdentity(binding) !== options.expectedBindingIdentity) {
      throw new Error('RDC_DEVICE_CONFIRMATION_STALE: installation inspection requires the original CLI and catalog.');
    }
    if (this.openedCapture) throw new Error('RDC_CAPTURE_CLOSE_REQUIRED');
    await this.closeOrReplaceOpenedCapture(options);
    this.ownerScope = scope; this.replayDevice = device; this.deviceLabel = device.label; this.lifecycleBinding = binding;
    const contextId = 'rdc-' + randomUUID();
    await this.ensureOwnedDaemon(contextId, binding, options.signal); this.contextId = contextId;
    return inspectSessionReplayInstallation(device, contextId, binding, options.signal);
  }

  isPreparedFor(scope: SessionScope, deviceId: string): boolean {
    return this.isOwnedBy(scope) && this.replayDevice?.id === deviceId
      && (this.replayDevice.type === 'local' || this.remoteConnection !== null);
  }

  private extractRuntimeContext(
    data: Record<string, unknown>,
    fallback: { backend: 'local' | 'remote'; deviceId?: string; deviceLabel?: string },
  ): RdcRuntimeContext {
    const contextId = this.readString(data, ['context_id']);
    if (!contextId || contextId === 'default') {
      throw new Error('RDC native result must include a non-default owning context_id.');
    }
    const replaySessionId = this.readString(data, ['session_id']);
    if (!replaySessionId) throw new Error('RDC native result must include native replay session_id.');
    const runtimeOwner = this.readString(data, ['runtime_owner'])
      ?? DEFAULT_RUNTIME_OWNER;
    const ownerLeaseId = this.readString(data, ['owner_lease_id'])
      ?? `${DEFAULT_RUNTIME_OWNER}:${contextId}`;
    return {
      contextId,
      runtimeOwner,
      ownerLeaseId,
      replaySessionId,
      captureFileId: this.readString(data, ['capture_file_id']),
      captureId: this.readString(data, ['capture_id']),
      backend: this.readString(data, ['backend']) === 'remote' ? 'remote' : fallback.backend,
      deviceId: this.readString(data, ['device_id']) ?? fallback.deviceId,
      deviceLabel: this.readString(data, ['device_label']) ?? fallback.deviceLabel,
      remoteId: this.readString(data, ['remote_id']),
      remoteStatus: this.normalizeRemoteStatus(this.readString(data, ['remote_status'])),
      updatedAt: Date.now(),
      raw: data,
    };
  }

  private applyRuntimeContext(
    runtimeContext: RdcRuntimeContext,
    sessionId?: string | null,
    projectId?: string | null,
  ): void {
    this.runtimeContext = runtimeContext;
    // Lease registry is session-scoped only; empty sessionId is fail-closed (service-local summary only).
    if (sessionId?.trim()) {
      setRdcRuntimeContextForSession(sessionId, runtimeContext, { projectId: projectId ?? null });
    }
    this.contextId = runtimeContext.contextId;
    this.runtimeOwner = runtimeContext.runtimeOwner;
    this.ownerLeaseId = runtimeContext.ownerLeaseId;
    this.remoteStatus = runtimeContext.remoteStatus ?? (runtimeContext.backend === 'remote' ? 'online' : 'disconnected');
    this.deviceLabel = runtimeContext.deviceLabel ?? this.deviceLabel;
  }


  private readString(source: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }
    return undefined;
  }

  private normalizeRemoteStatus(value: string | undefined): RdcRuntimeContext['remoteStatus'] {
    return value === 'connected' || value === 'online' || value === 'disconnected' || value === 'error'
      ? value
      : undefined;
  }

  private snapshotContext(): ContextSnapshot {
    const activeCapture = this.captures.find((capture) => capture.id === this.activeCaptureId);
    return {
      contextId: this.contextId ?? '',
      sessionId: activeCapture?.sessionId ?? '',
      ownerSessionId: this.ownerScope?.sessionId ?? null,
      backend: this.replayDevice?.type === 'android' ? 'remote' : 'local',
      remoteStatus: this.replayDevice?.type === 'android' ? this.remoteStatus : undefined,
      runtimeOwner: this.runtimeOwner ?? '',
      ownerLeaseId: this.ownerLeaseId ?? '',
      captureDescriptors: [...this.captures],
      activeCapture: this.activeCaptureId ?? '',
      deviceLabel: this.deviceLabel,
      runtimeContext: this.runtimeContext ? { ...this.runtimeContext } : null,
    };
  }

  snapshotContextForSession(scope: SessionScope): ContextSnapshot | null {
    return this.isOwnedBy(scope) ? this.snapshotContext() : null;
  }

  snapshotOpenedCaptureForSession(scope: SessionScope): OpenedCaptureState | null {
    return this.isOwnedBy(scope) && this.openedCapture ? { ...this.openedCapture } : null;
  }

  async clearOpenedCaptureForSession(scope: SessionScope, options: RdcLifecycleOptions = {}): Promise<boolean> {
    if (!this.isOwnedBy(scope)) return false;
    await this.closeOrReplaceOpenedCapture(options);
    return true;
  }

  private isOwnedBy(scope: SessionScope): boolean {
    return this.ownerScope?.projectId === scope.projectId && this.ownerScope.sessionId === scope.sessionId;
  }
  getCaptureDescriptors(): CaptureDescriptor[] {
    return [...this.captures];
  }

  getCliSettings() { return this.lifecycleBinding?.cli; }
  getPreparationBindingIdentity(): string | null { return this.lifecycleBinding ? remotePreparationBindingIdentity(this.lifecycleBinding) : null; }
  getContextId(): string | null {
    return this.contextId;
  }

  getRuntimeOwner(): string | null {
    return this.runtimeOwner;
  }

  getOwnerLeaseId(): string | null {
    return this.ownerLeaseId;
  }

  private createOpenedCaptureState(
    projectId: string,
    ownerSessionId: string | null,
    inputId: string,
    filePath: string,
    replayDevice: ReplayDeviceEntry,
    previewResult: PreviewLoadResult,
  ): OpenedCaptureState {
    const activeCapture = this.captures.find((capture) => capture.id === this.activeCaptureId) ?? this.captures[0];
    return {
      projectId,
      ownerSessionId,
      inputId,
      filePath,
      captureId: activeCapture?.id ?? inputId,
      captureFileId: activeCapture?.captureFileId,
      sessionId: activeCapture?.sessionId ?? '',
      contextId: this.contextId ?? '',
      replaySessionId: activeCapture?.replaySessionId ?? '',
      backend: activeCapture?.backendHint ?? 'local',
      deviceId: replayDevice.id,
      deviceLabel: replayDevice.label,
      status: activeCapture?.status === 'error' ? 'error' : 'open',
      openedAt: Date.now(),
      preview: previewResult.preview,
      previewError: previewResult.error,
      previewAttempts: previewResult.attempts,
      runtimeContext: this.runtimeContext ? { ...this.runtimeContext } : null,
    };
  }

  private async teardownRuntime(options: RdcLifecycleOptions = {}): Promise<void> {
    options = { ...options, binding: this.lifecycleBinding ?? options.binding };
    const ownerSessionId = this.ownerScope?.sessionId;
    if (ownerSessionId && getDelegatedChildSessionId(ownerSessionId)) {
      throw new Error('RDC_LEASE_DUAL_OWNER: join delegated execution before capture lifecycle changes.');
    }
    if (this.contextId && shellInvocationService.hasUnconfirmedProcesses(this.contextId)) throw new Error('RDC_RECOVERY_BLOCKED: native process exit has not been observed.');
    const previousContext = this.runtimeContext;

    let closeOk = true;
    let closeError = '';

    // Stage 1: graceful close via the canonical session operation.
    if (previousContext) {
      const result = await callNative('rd.session.clear_context', {}, previousContext.contextId, options.binding!, options.signal);
      closeOk = result.ok;
      closeError = result.error ?? '';
      if (!result.ok) {
        runtimeLogService.log({
          scope: 'app',
          namespace: 'context',
          severity: 'warning',
          title: 'RDC runtime close warning',
          summary: result.error ?? 'Session clear failed.',
          raw: result,
        });
      }
    } else if (this.contextId) {
      const result = await callNative('rd.session.clear_context', {}, this.contextId, options.binding!, options.signal);
      closeOk = result.ok;
      closeError = result.error ?? '';
    } else { return; }

    if (!closeOk) throw new Error(`RDC_CLOSE_FAILED: ${closeError || 'runtime close was not confirmed'}; ownership is retained.`);
    if (this.contextId) {
      const cli = options.binding?.cli;
      if (!cli?.enabled || !cli.command) throw new Error('RDC_CLOSE_FAILED: owning CLI is unavailable for daemon shutdown.');
      const response = parseRdcNativeResult(await rdcCliInvokerService.executeCLI('daemon', ['stop', '--daemon-context', this.contextId], {
        contextId: this.contextId, abortSignal: options.signal,
        settings: cli,
      }), this.contextId, 'rdc_tool.daemon.stop');
      options.signal?.throwIfAborted();
      if (response.data.stopped !== true) throw new Error('RDC_CLOSE_FAILED: daemon shutdown was not confirmed.');
      forgetOwnedRdcDaemon(this.contextId);
    }
  }

  private async ensureOwnedDaemon(contextId: string, binding: RdcTurnBinding, signal?: AbortSignal): Promise<void> {
    const cli = binding.cli;
    if (!cli.enabled || !cli.command) throw new Error('RDC_CLOSE_FAILED: owning CLI is unavailable for daemon start.');
    signal?.throwIfAborted();
    const payload = parseRdcNativeResult(await rdcCliInvokerService.executeCLI('daemon', ['start', '--daemon-context', contextId], {
      contextId, abortSignal: signal,
      settings: cli,
    }), contextId, 'rdc_tool.daemon.start');
    const state = payload.data.state && typeof payload.data.state === 'object' && !Array.isArray(payload.data.state)
      ? payload.data.state as Record<string, unknown>
      : {};
    const ownerPid = Number(payload.data.owner_pid ?? state.owner_pid ?? 0);
    if (ownerPid !== process.pid) throw new Error('RDC_CLOSE_FAILED: daemon start did not bind the application owner_pid.');
    rememberOwnedRdcDaemon({
      contextId,
      command: cli.command,
      intermediateRoot: cli.env[RDC_INTERMEDIATE_ROOT_ENV] || hostRdcIntermediateRoot(),
      ownerPid,
      daemonPid: Number(state.pid ?? 0),
      workerPid: Number((state.worker && typeof state.worker === 'object' ? (state.worker as { pid?: unknown }).pid : 0) ?? 0),
      startedAt: Date.now(),
    });
  }

  private resetRuntimeState(previousCapture: OpenedCaptureState | null): void {
    this.openedCapture = null;
    this.remoteConnection = null;
    this.contextId = null;
    this.ownerScope = null;
    this.lifecycleBinding = undefined;
    this.runtimeOwner = null;
    this.ownerLeaseId = null;
    this.captures = [];
    this.activeCaptureId = null;
    this.deviceLabel = 'Local';
    this.replayDevice = null;
    this.remoteStatus = 'disconnected';
    this.runtimeContext = null;
    if (previousCapture?.ownerSessionId) {
      setRdcRuntimeContextForSession(previousCapture.ownerSessionId, null);

    }


    if (previousCapture) {
      this.openedCapture = null;
    }
  }
}
