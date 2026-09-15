import { settingsService } from '../settings/SettingsService';
import { rdxCliInvokerService } from '../tools/RdxCliInvokerService';
import { parseRdxNativeResult } from '../tools/RdxNativeProtocol';
import { freezeRdxTurnBinding } from '../tools/RdxTurnBindings';
import { shellInvocationService } from '../tools/ShellInvocationService';
/**
 * RdxSessionService - RDX runtime context state and fixed native CLI lifecycle.
 */

import { randomUUID } from 'node:crypto';
import { withRdxOpenProgress } from './RdxOpenProgress';
import { replayDeviceService } from '../captures/ReplayDeviceService';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import type {
  CaptureDescriptor,
  ContextSnapshot,
  OpenedCaptureState,
  OpenedCapturePreview,
  OpenedCapturePreviewAttempt,
  OpenedCapturePreviewError,
  OpenProjectInputRequest,
  RdxRuntimeContext,
  SessionScope,
} from '@shared/types/session';
import type { ReplayDeviceEntry } from '@shared/types/device';
import type { RdxTurnBinding } from '../tools/RdxTurnBindings';
import { setRdxRuntimeContextForSession, getDelegatedChildSessionId } from './RdxRuntimeContextRegistry';

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
  binding: RdxTurnBinding,
  signal?: AbortSignal,
): Promise<{ ok: boolean; data: Record<string, unknown>; error?: string }> {
  signal?.throwIfAborted();
  const result = await rdxCliInvokerService.executeCLI('call', [
    operation, '--args-json', JSON.stringify(args), '--daemon-context', contextId,
  ], { contextId, abortSignal: signal, settings: { ...binding.cli, argsPrefix: [...binding.cli.argsPrefix, '--json'] } });
  try {
    signal?.throwIfAborted();
    const payload = parseRdxNativeResult(result, contextId, operation);
    if (operation === 'rd.capture.open_file' && (typeof payload.data.capture_file_id !== 'string' || !payload.data.capture_file_id)) throw new Error('RDX_CLI_PROTOCOL: capture_file_id is required.');
    if (operation === 'rd.capture.open_replay' && (typeof payload.data.session_id !== 'string' || !payload.data.session_id)) throw new Error('RDX_CLI_PROTOCOL: session_id is required.');
    if (operation === 'rd.capture.open_replay' && payload.data.capture_file_id !== args.capture_file_id) throw new Error('RDX_CAPTURE_MISMATCH: replay capture identity does not match the opened file.');
    return { ok: true, data: payload.data };
  } catch (error) {
    return { ok: false, data: {}, error: error instanceof Error ? error.message : String(error) };
  }
}

const emptyPreviewLoadResult = (): PreviewLoadResult => ({
  preview: null,
  error: null,
  attempts: [],
});

export interface RdxLifecycleOptions { expectedGeneration?: number; onStage?: (stage: 'connecting' | 'opening' | 'transferring') => void; contextId?: string; binding?: RdxTurnBinding; signal?: AbortSignal }

export class RdxSessionRuntime {
  private contextId: string | null = null;
  private ownerScope: SessionScope | null = null;
  private lifecycleBinding: RdxTurnBinding | undefined;
  private runtimeOwner: string | null = null;
  private ownerLeaseId: string | null = null;
  private captures: CaptureDescriptor[] = [];
  private activeCaptureId: string | null = null;
  private deviceLabel = 'Local';
  private replayDevice: ReplayDeviceEntry | null = null;
  private remoteStatus: 'connected' | 'online' | 'disconnected' | 'error' = 'disconnected';
  private openedCapture: OpenedCaptureState | null = null;
  private runtimeContext: RdxRuntimeContext | null = null;

  async openProjectInput(request: OpenProjectInputRequest, options: RdxLifecycleOptions = {}): Promise<OpenedCaptureState> {
    options.signal?.throwIfAborted();
    const cli = structuredClone(options.binding?.cli ?? settingsService.getAll().tooling.rdxCli);
    let lifecycleBinding = options.binding;
    if (!lifecycleBinding) {
      const catalog = await rdxCliInvokerService.loadCatalog(cli);
      options.signal?.throwIfAborted();
      lifecycleBinding = freezeRdxTurnBinding(cli, catalog.tools);
    }
    options.signal?.throwIfAborted();
    const allocatedContextId = `rdc-${randomUUID()}`;
    await this.closeOrReplaceOpenedCapture(options);
    this.lifecycleBinding = lifecycleBinding;
    options = { ...options, binding: this.lifecycleBinding };
    this.contextId = allocatedContextId;
    this.ownerScope = request.sessionId ? { projectId: request.projectId, sessionId: request.sessionId } : null;
    let replayDevice = request.replayDevice;
    const isRemoteReplay = replayDevice.type === 'android';
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
    this.remoteStatus = isRemoteReplay ? 'connected' : 'disconnected';



    let resultData: Record<string, unknown>;
    let runtimeContext: RdxRuntimeContext;
    try {
      if (isRemoteReplay) {
        options.onStage?.('connecting');
        replayDevice = await this.ensureReplayDeviceReady(replayDevice, { ...options, contextId: allocatedContextId });
      }
      const preparedRemote = isRemoteReplay
        ? replayDeviceService.consumePreparedRemote(replayDevice.id)
        : null;

      options.onStage?.('opening');
      if (isRemoteReplay) {
        if (!preparedRemote?.contextId || !preparedRemote.remoteId || preparedRemote.contextId !== allocatedContextId) {
          throw new Error('Remote replay requires a prepared remote context and remoteId.');
        }
        const result = await withRdxOpenProgress(allocatedContextId, options.binding!.cli, options.onStage, async () => {
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
        if (result.data.remote_id !== preparedRemote.remoteId) throw new Error('RDX_REMOTE_MISMATCH: remote replay identity does not match the selected connection.');
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
      if (runtimeContext.contextId !== allocatedContextId) throw new Error('RDX_CONTEXT_MISMATCH: native operation returned a different owning context.');
      if (isRemoteReplay && runtimeContext.remoteId !== preparedRemote?.remoteId) throw new Error('RDX_REMOTE_MISMATCH: native replay belongs to a different remote.');
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

  async closeOrReplaceOpenedCapture(options: RdxLifecycleOptions = {}): Promise<void> {
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
      throw new Error(`Capture ${captureId} has not been opened by a configured RDX shell action.`);
    }

    this.activeCaptureId = captureId;
  }

  private async ensureReplayDeviceReady(device: ReplayDeviceEntry, options: RdxLifecycleOptions): Promise<ReplayDeviceEntry> {
    if (device.type === 'local') {
      return device;
    }

    const currentDevice = replayDeviceService.getDeviceById(device.id) ?? device;
    if (currentDevice.type === 'local') {
      return currentDevice;
    }

    const preparedRemote = replayDeviceService.peekPreparedRemote(currentDevice.id);
    if (
      ['connected', 'online'].includes(currentDevice.status)
      && preparedRemote?.contextId === options.contextId
      && preparedRemote?.remoteId
    ) {
      return currentDevice;
    }

    const activatedDevice = await replayDeviceService.activateDevice(currentDevice.id, {
      signal: options.signal,
      contextId: options.contextId,
      cli: options.binding?.cli,
    });
    if (activatedDevice.type === 'local' || !['connected', 'online'].includes(activatedDevice.status)) {
      throw new Error(
        activatedDevice.activationErrorMessage
        ?? activatedDevice.lastError
        ?? `Failed to connect Replay Device ${activatedDevice.label}.`,
      );
    }

    return activatedDevice;
  }

  private extractRuntimeContext(
    data: Record<string, unknown>,
    fallback: { backend: 'local' | 'remote'; deviceId?: string; deviceLabel?: string },
  ): RdxRuntimeContext {
    const contextId = this.readString(data, ['context_id']);
    if (!contextId || contextId === 'default') {
      throw new Error('RDX native result must include a non-default owning context_id.');
    }
    const replaySessionId = this.readString(data, ['session_id']);
    if (!replaySessionId) throw new Error('RDX native result must include native replay session_id.');
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
    runtimeContext: RdxRuntimeContext,
    sessionId?: string | null,
    projectId?: string | null,
  ): void {
    this.runtimeContext = runtimeContext;
    // Lease registry is session-scoped only; empty sessionId is fail-closed (service-local summary only).
    if (sessionId?.trim()) {
      setRdxRuntimeContextForSession(sessionId, runtimeContext, { projectId: projectId ?? null });
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

  private normalizeRemoteStatus(value: string | undefined): RdxRuntimeContext['remoteStatus'] {
    return value === 'connected' || value === 'online' || value === 'disconnected' || value === 'error'
      ? value
      : undefined;
  }

  private snapshotContext(): ContextSnapshot {
    const activeCapture = this.captures.find((capture) => capture.id === this.activeCaptureId);
    return {
      contextId: this.contextId ?? '',
      sessionId: activeCapture?.sessionId ?? '',
      ownerSessionId: this.openedCapture?.ownerSessionId ?? activeCapture?.ownerSessionId ?? null,
      backend: activeCapture?.backendHint ?? 'local',
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

  async clearOpenedCaptureForSession(scope: SessionScope, options: RdxLifecycleOptions = {}): Promise<boolean> {
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

  private async teardownRuntime(options: RdxLifecycleOptions = {}): Promise<void> {
    options = { ...options, binding: this.lifecycleBinding ?? options.binding };
    const ownerSessionId = this.ownerScope?.sessionId;
    if (ownerSessionId && getDelegatedChildSessionId(ownerSessionId)) {
      throw new Error('RDX_LEASE_DUAL_OWNER: join delegated execution before capture lifecycle changes.');
    }
    if (this.contextId && shellInvocationService.hasUnconfirmedProcesses(this.contextId)) throw new Error('RDX_RECOVERY_BLOCKED: native process exit has not been observed.');
    const previousContext = this.runtimeContext;

    let closeOk = true;

    // Stage 1: graceful close via the canonical session operation.
    if (previousContext) {
      const result = await callNative('rd.session.clear_context', {}, previousContext.contextId, options.binding!, options.signal);
      closeOk = result.ok;
      if (!result.ok) {
        runtimeLogService.log({
          scope: 'app',
          namespace: 'context',
          severity: 'warning',
          title: 'RDX runtime close warning',
          summary: result.error ?? 'Session clear failed.',
          raw: result,
        });
      }
    } else if (this.contextId) {
      const result = await callNative('rd.session.clear_context', {}, this.contextId, options.binding!, options.signal);
      closeOk = result.ok;
    } else { return; }

    if (!closeOk) throw new Error('RDX_CLOSE_FAILED: runtime close was not confirmed; ownership is retained.');
    if (this.contextId) {
      const cli = options.binding?.cli;
      if (!cli?.enabled || !cli.command) throw new Error('RDX_CLOSE_FAILED: owning CLI is unavailable for daemon shutdown.');
      const response = parseRdxNativeResult(await rdxCliInvokerService.executeCLI('daemon', ['stop', '--daemon-context', this.contextId], {
        contextId: this.contextId, abortSignal: options.signal,
        settings: { ...cli, argsPrefix: [...cli.argsPrefix.filter(arg => arg !== '--json'), '--json'] },
      }), this.contextId, 'rdx.daemon.stop');
      options.signal?.throwIfAborted();
      if (response.data.stopped !== true) throw new Error('RDX_CLOSE_FAILED: daemon shutdown was not confirmed.');
    }
  }

  private resetRuntimeState(previousCapture: OpenedCaptureState | null): void {
    this.openedCapture = null;
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
      setRdxRuntimeContextForSession(previousCapture.ownerSessionId, null);

    }


    if (previousCapture) {
      this.openedCapture = null;
    }
  }
}
