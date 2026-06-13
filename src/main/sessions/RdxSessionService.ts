/**
 * RdxSessionService - RDX runtime context state and configured shell actions.
 */

import fs from 'fs';
import path from 'path';
import { BrowserWindow, nativeImage } from 'electron';
import { replayDeviceService } from '../captures/ReplayDeviceService';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { rendererEventHub } from '../browserAppBridge/rendererEventHub';
import type {
  CaptureDescriptor,
  ContextSnapshot,
  HumanPreviewSnapshot,
  OpenedCaptureState,
  OpenedCapturePreview,
  OpenedCapturePreviewAttempt,
  OpenedCapturePreviewError,
  OpenProjectInputRequest,
  RdxRuntimeContext,
} from '@shared/types/session';
import type { ReplayDeviceEntry } from '@shared/types/device';
import type { ToolCallResult } from '@shared/types/tool';
import { rdxShellActionService } from '../tools/RdxShellActionService';
import { rdxCliInvokerService } from '../tools/RdxCliInvokerService';
import { setRdxRuntimeContext } from './RdxRuntimeContextRegistry';

interface PreviewLoadResult {
  preview: OpenedCapturePreview | null;
  error: OpenedCapturePreviewError | null;
  attempts: OpenedCapturePreviewAttempt[];
}

const DEFAULT_RUNTIME_OWNER = 'rdc-agent';

const emptyPreviewLoadResult = (): PreviewLoadResult => ({
  preview: null,
  error: null,
  attempts: [],
});

export class RdxSessionService {
  private contextId: string | null = null;
  private runtimeOwner: string | null = null;
  private ownerLeaseId: string | null = null;
  private captures: CaptureDescriptor[] = [];
  private activeCaptureId: string | null = null;
  private deviceLabel = 'Local';
  private replayDevice: ReplayDeviceEntry | null = null;
  private remoteStatus: 'connected' | 'online' | 'disconnected' | 'error' = 'disconnected';
  private openedCapture: OpenedCaptureState | null = null;
  private runtimeContext: RdxRuntimeContext | null = null;
  private humanPreview: HumanPreviewSnapshot = {
    status: 'closed',
    updatedAt: Date.now(),
  };

  async openProjectInput(request: OpenProjectInputRequest): Promise<OpenedCaptureState> {
    await this.closeOrReplaceOpenedCapture();

    let replayDevice = request.replayDevice;
    const isRemoteReplay = replayDevice.type === 'android';
    if (isRemoteReplay) {
      replayDevice = await this.ensureReplayDeviceReady(replayDevice);
    }
    const preparedRemote = isRemoteReplay
      ? replayDeviceService.peekPreparedRemote(replayDevice.id)
      : null;

    const capture: CaptureDescriptor = {
      id: request.inputId,
      filePath: request.filePath,
      role: 'primary',
      backendHint: isRemoteReplay ? 'remote' : 'local',
      status: 'pending',
    };

    this.captures = [capture];
    this.activeCaptureId = capture.id;
    this.replayDevice = replayDevice;
    this.deviceLabel = replayDevice.label;
    this.remoteStatus = 'disconnected';

    let resultData: Record<string, unknown>;
    if (isRemoteReplay) {
      if (!preparedRemote?.contextId || !preparedRemote.remoteId) {
        capture.status = 'error';
        this.captures = [capture];
        this.remoteStatus = 'error';
        throw new Error('Remote replay requires a prepared remote context and remoteId.');
      }
      resultData = await this.openRemoteProjectInput(request, replayDevice, preparedRemote);
    } else {
      const result = await rdxShellActionService.runAction('openCapture', {
        projectId: request.projectId,
        inputId: request.inputId,
        filePath: request.filePath,
        capturePath: request.filePath,
        deviceId: replayDevice.id,
        deviceLabel: replayDevice.label,
        deviceType: replayDevice.type,
        deviceSerial: replayDevice.serial,
        deviceRemoteId: replayDevice.remoteId,
        remoteId: preparedRemote?.remoteId ?? replayDevice.remoteId,
        remoteContextId: preparedRemote?.contextId,
        backend: 'local',
      }, {
        env: this.buildRuntimeContextEnv(),
      });
      if (!result.ok) {
        capture.status = 'error';
        this.captures = [capture];
        this.remoteStatus = 'error';
        throw new Error(result.error ?? 'RDX openCapture action failed.');
      }
      resultData = result.data;
    }

    const runtimeContext = this.extractRuntimeContext(resultData, {
      backend: isRemoteReplay ? 'remote' : 'local',
      deviceId: replayDevice.id,
      deviceLabel: replayDevice.label,
    });
    this.applyRuntimeContext(runtimeContext);
    const captureIndex = this.captures.findIndex((item) => item.id === capture.id);
    this.captures[captureIndex] = {
      ...this.captures[captureIndex],
      captureFileId: runtimeContext.captureFileId,
      status: 'open',
      sessionId: runtimeContext.replaySessionId,
      replaySessionId: runtimeContext.replaySessionId,
      contextId: runtimeContext.contextId,
    };

    const previewResult = this.previewFromActionData(resultData);

    const openedCapture = this.createOpenedCaptureState(
      request.projectId,
      request.inputId,
      request.filePath,
      replayDevice,
      previewResult,
    );
    this.openedCapture = openedCapture;
    this.broadcastContextChanged();
    return openedCapture;
  }

  private async openRemoteProjectInput(
    request: OpenProjectInputRequest,
    replayDevice: ReplayDeviceEntry,
    preparedRemote: { contextId: string; remoteId: string },
  ): Promise<Record<string, unknown>> {
    const runIdBase = `remote-open-${request.inputId}-${Date.now()}`;
    const openFile = await rdxCliInvokerService.call({
      toolName: 'rd.capture.open_file',
      args: {
        file_path: request.filePath,
        read_only: true,
      },
      contextId: preparedRemote.contextId,
      runId: `${runIdBase}-file`,
    });
    if (!openFile.ok) {
      throw new Error(this.formatToolError('rd.capture.open_file', openFile));
    }

    const captureFileId = this.readString(openFile.data ?? {}, ['captureFileId', 'capture_file_id']);
    if (!captureFileId) {
      throw new Error('rd.capture.open_file did not return capture_file_id.');
    }

    const openReplay = await rdxCliInvokerService.call({
      toolName: 'rd.capture.open_replay',
      args: {
        capture_file_id: captureFileId,
        options: {
          remote_id: preparedRemote.remoteId,
        },
      },
      contextId: preparedRemote.contextId,
      runId: `${runIdBase}-replay`,
    });
    if (!openReplay.ok) {
      throw new Error(this.formatToolError('rd.capture.open_replay', openReplay));
    }

    const replaySessionId = this.readString(openReplay.data ?? {}, ['replaySessionId', 'replay_session_id', 'sessionId', 'session_id']);
    if (!replaySessionId) {
      throw new Error('rd.capture.open_replay did not return session_id.');
    }

    const setFrame = await rdxCliInvokerService.call({
      toolName: 'rd.replay.set_frame',
      args: {
        session_id: replaySessionId,
        frame_index: 0,
      },
      contextId: preparedRemote.contextId,
      runId: `${runIdBase}-frame`,
    });
    if (!setFrame.ok) {
      throw new Error(this.formatToolError('rd.replay.set_frame', setFrame));
    }

    const getContext = await rdxCliInvokerService.call({
      toolName: 'rd.session.get_context',
      args: {},
      contextId: preparedRemote.contextId,
      runId: `${runIdBase}-context`,
    });
    if (!getContext.ok) {
      throw new Error(this.formatToolError('rd.session.get_context', getContext));
    }

    const contextData = getContext.data ?? {};
    const runtime = this.readRecord(contextData, ['runtime']);
    const activeEventId = this.readNumber(setFrame.data ?? {}, ['activeEventId', 'active_event_id'])
      ?? this.readNumber(openReplay.data ?? {}, ['activeEventId', 'active_event_id']);

    return {
      context_id: preparedRemote.contextId,
      capture_file_id: captureFileId,
      capture_path: request.filePath,
      session_id: replaySessionId,
      replay_session_id: replaySessionId,
      active_event_id: activeEventId,
      backend: 'remote',
      device_id: replayDevice.id,
      device_label: replayDevice.label,
      remote_id: preparedRemote.remoteId,
      remote_status: 'online',
      runtime: runtime ?? {},
      _rdxRemoteOpen: {
        openFile,
        openReplay,
        setFrame,
        getContext,
      },
    };
  }

  async closeOrReplaceOpenedCapture(): Promise<void> {
    const previousCapture = this.openedCapture;
    await this.teardownRuntime();
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

  async openHumanPreviewWindow(request: { sessionId?: string } = {}): Promise<ContextSnapshot> {
    const replaySessionId = request.sessionId || this.snapshotContext().sessionId;
    if (!this.contextId || !this.runtimeOwner || !this.ownerLeaseId || !replaySessionId) {
      this.setHumanPreview({
        status: 'unavailable',
        sessionId: replaySessionId || undefined,
        lastError: 'Runtime context, owner lease, or replay session is not available.',
      });
      return this.snapshotContext();
    }

    this.setHumanPreview({
      status: 'opening',
      sessionId: replaySessionId,
    });

    const result = await rdxShellActionService.runAction('openPreview', {
      sessionId: replaySessionId,
      replaySessionId,
      contextId: this.contextId,
      runtimeOwner: this.runtimeOwner,
      ownerLeaseId: this.ownerLeaseId,
    }, {
      env: this.buildRuntimeContextEnv(),
    });

    if (!result.ok) {
      const message = result.error ?? 'RDX openPreview action failed.';
      this.setHumanPreview({
        status: 'error',
        sessionId: replaySessionId,
        lastError: message,
      });
      runtimeLogService.log({
        scope: 'app',
        namespace: 'context',
        severity: 'warning',
        title: 'Human preview unavailable',
        summary: message,
        raw: { result },
      });
      return this.snapshotContext();
    }

    this.setHumanPreview(this.extractHumanPreview({ data: result.data } as ToolCallResult, 'open', replaySessionId));
    return this.snapshotContext();
  }

  async closeHumanPreviewWindow(): Promise<ContextSnapshot> {
    this.setHumanPreview({ status: 'closed' });
    return this.snapshotContext();
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

  private async ensureReplayDeviceReady(device: ReplayDeviceEntry): Promise<ReplayDeviceEntry> {
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
      && preparedRemote?.contextId
      && preparedRemote.remoteId
    ) {
      return currentDevice;
    }

    const activatedDevice = await replayDeviceService.activateDevice(currentDevice.id);
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
    const contextId = this.readString(data, ['contextId', 'context_id', 'RDX_CONTEXT_ID']);
    if (!contextId) {
      throw new Error('RDX action result must include contextId/context_id.');
    }
    const runtimeOwner = this.readString(data, ['runtimeOwner', 'runtime_owner', 'RDX_RUNTIME_OWNER'])
      ?? DEFAULT_RUNTIME_OWNER;
    const ownerLeaseId = this.readString(data, ['ownerLeaseId', 'owner_lease_id', 'RDX_OWNER_LEASE_ID'])
      ?? `${DEFAULT_RUNTIME_OWNER}:${contextId}`;
    return {
      contextId,
      runtimeOwner,
      ownerLeaseId,
      replaySessionId: this.readString(data, ['replaySessionId', 'replay_session_id', 'sessionId', 'session_id']),
      captureFileId: this.readString(data, ['captureFileId', 'capture_file_id']),
      captureId: this.readString(data, ['captureId', 'capture_id']),
      backend: this.readString(data, ['backend']) === 'remote' ? 'remote' : fallback.backend,
      deviceId: this.readString(data, ['deviceId', 'device_id']) ?? fallback.deviceId,
      deviceLabel: this.readString(data, ['deviceLabel', 'device_label']) ?? fallback.deviceLabel,
      remoteId: this.readString(data, ['remoteId', 'remote_id']),
      remoteStatus: this.normalizeRemoteStatus(this.readString(data, ['remoteStatus', 'remote_status'])),
      updatedAt: Date.now(),
      raw: data,
    };
  }

  private applyRuntimeContext(runtimeContext: RdxRuntimeContext): void {
    this.runtimeContext = runtimeContext;
    setRdxRuntimeContext(runtimeContext);
    this.contextId = runtimeContext.contextId;
    this.runtimeOwner = runtimeContext.runtimeOwner;
    this.ownerLeaseId = runtimeContext.ownerLeaseId;
    this.remoteStatus = runtimeContext.remoteStatus ?? (runtimeContext.backend === 'remote' ? 'online' : 'disconnected');
    this.deviceLabel = runtimeContext.deviceLabel ?? this.deviceLabel;
  }

  private buildRuntimeContextEnv(): Record<string, string> {
    if (!this.runtimeContext) {
      return {};
    }
    return {
      RDX_CONTEXT_ID: this.runtimeContext.contextId,
      RDX_RUNTIME_OWNER: this.runtimeContext.runtimeOwner,
      RDX_OWNER_LEASE_ID: this.runtimeContext.ownerLeaseId,
      RDX_REPLAY_SESSION_ID: this.runtimeContext.replaySessionId ?? '',
      RDX_CAPTURE_FILE_ID: this.runtimeContext.captureFileId ?? '',
    };
  }

  private previewFromActionData(data: Record<string, unknown>): PreviewLoadResult {
    const imagePath = this.readString(data, ['previewImagePath', 'preview_image_path', 'imagePath', 'image_path']);
    if (!imagePath) {
      return emptyPreviewLoadResult();
    }
    const preview = this.createPreviewFromPath(
      imagePath,
      this.readString(data, ['previewSource', 'preview_source']) === 'capture_thumbnail'
        ? 'capture_thumbnail'
        : 'framebuffer_screenshot',
      this.readNumber(data, ['previewWidth', 'preview_width', 'width']),
      this.readNumber(data, ['previewHeight', 'preview_height', 'height']),
    );
    return {
      preview,
      error: preview ? null : {
        message: `RDX action returned an unreadable preview image: ${imagePath}`,
        code: 'preview_image_unreadable',
        attempts: [],
      },
      attempts: preview ? [{
        source: preview.source,
        status: 'success',
        imagePath: preview.imagePath,
      }] : [{
        source: 'framebuffer_screenshot',
        status: 'failed',
        imagePath,
        message: `RDX action returned an unreadable preview image: ${imagePath}`,
        code: 'preview_image_unreadable',
      }],
    };
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

  private readRecord(source: Record<string, unknown>, keys: string[]): Record<string, unknown> | undefined {
    for (const key of keys) {
      const value = source[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    }
    return undefined;
  }

  private formatToolError(toolName: string, result: ToolCallResult): string {
    const message = result.error?.message
      ?? (result.data ? JSON.stringify(result.data) : '')
      ?? 'RDX tool call failed.';
    return `${toolName} failed: ${message}`;
  }

  private readNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return undefined;
  }

  private normalizeRemoteStatus(value: string | undefined): RdxRuntimeContext['remoteStatus'] {
    return value === 'connected' || value === 'online' || value === 'disconnected' || value === 'error'
      ? value
      : undefined;
  }

  snapshotContext(): ContextSnapshot {
    const activeCapture = this.captures.find((capture) => capture.id === this.activeCaptureId);
    return {
      contextId: this.contextId ?? '',
      sessionId: activeCapture?.sessionId ?? '',
      backend: activeCapture?.backendHint ?? 'local',
      remoteStatus: this.replayDevice?.type === 'android' ? this.remoteStatus : undefined,
      runtimeOwner: this.runtimeOwner ?? '',
      ownerLeaseId: this.ownerLeaseId ?? '',
      captureDescriptors: [...this.captures],
      activeCapture: this.activeCaptureId ?? '',
      deviceLabel: this.deviceLabel,
      humanPreview: { ...this.humanPreview },
      runtimeContext: this.runtimeContext ? { ...this.runtimeContext } : null,
    };
  }

  snapshotOpenedCapture(): OpenedCaptureState | null {
    return this.openedCapture ? { ...this.openedCapture } : null;
  }

  clearOpenedCapture(): void {
    this.openedCapture = null;
  }

  getCaptureDescriptors(): CaptureDescriptor[] {
    return [...this.captures];
  }

  getContextId(): string | null {
    return this.contextId;
  }

  getRuntimeOwner(): string | null {
    return this.runtimeOwner;
  }

  getOwnerLeaseId(): string | null {
    return this.ownerLeaseId;
  }

  private setHumanPreview(patch: Omit<HumanPreviewSnapshot, 'updatedAt'> & { updatedAt?: number }): void {
    this.humanPreview = {
      ...patch,
      updatedAt: patch.updatedAt ?? Date.now(),
    };
    this.broadcastContextChanged();
  }

  private broadcastContextChanged(): void {
    const snapshot = this.snapshotContext();
    rendererEventHub.emit('context:changed', snapshot);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('context:changed', snapshot);
      }
    }
  }

  private extractHumanPreview(
    result: ToolCallResult,
    fallbackStatus: HumanPreviewSnapshot['status'],
    fallbackSessionId?: string,
  ): Omit<HumanPreviewSnapshot, 'updatedAt'> {
    const preview = result.data?.preview && typeof result.data.preview === 'object'
      ? result.data.preview as Record<string, unknown>
      : {};
    const enabled = typeof preview.enabled === 'boolean' ? preview.enabled : fallbackStatus === 'open';
    const status: HumanPreviewSnapshot['status'] = fallbackStatus === 'closed'
      ? 'closed'
      : enabled
        ? 'open'
        : 'error';
    const sessionId = this.readPreviewString(preview, ['session_id', 'current_session_id', 'bound_session_id'])
      ?? this.readPreviewString(result.data, ['current_session_id', 'session_id'])
      ?? fallbackSessionId;
    const boundEventId = this.readPreviewNumber(preview, ['active_event_id', 'bound_event_id', 'event_id'])
      ?? this.readPreviewNumber(result.data, ['active_event_id', 'bound_event_id', 'event_id']);
    const lastError = this.readPreviewError(preview)
      ?? this.readPreviewError(result.data)
      ?? (enabled || fallbackStatus === 'closed' ? undefined : 'Preview is not enabled.');

    return {
      status,
      sessionId,
      boundEventId,
      lastError,
    };
  }

  private readPreviewString(source: Record<string, unknown> | undefined, keys: string[]): string | undefined {
    if (!source) {
      return undefined;
    }
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }
    return undefined;
  }

  private readPreviewNumber(source: Record<string, unknown> | undefined, keys: string[]): number | undefined {
    if (!source) {
      return undefined;
    }
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return undefined;
  }

  private readPreviewError(source: Record<string, unknown> | undefined): string | undefined {
    if (!source) {
      return undefined;
    }
    const direct = source.last_error ?? source.error ?? source.error_message;
    if (typeof direct === 'string' && direct.trim()) {
      return direct;
    }
    if (direct && typeof direct === 'object') {
      const message = (direct as Record<string, unknown>).message;
      if (typeof message === 'string' && message.trim()) {
        return message;
      }
    }
    return undefined;
  }

  private createOpenedCaptureState(
    projectId: string,
    inputId: string,
    filePath: string,
    replayDevice: ReplayDeviceEntry,
    previewResult: PreviewLoadResult,
  ): OpenedCaptureState {
    const activeCapture = this.captures.find((capture) => capture.id === this.activeCaptureId) ?? this.captures[0];
    return {
      projectId,
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

  private createPreviewFromPath(
    imagePath: string,
    source: OpenedCapturePreview['source'],
    fallbackWidth?: number,
    fallbackHeight?: number,
    metadata: Partial<OpenedCapturePreview> = {},
  ): OpenedCapturePreview | null {
    const normalizedPath = path.resolve(imagePath);
    if (!fs.existsSync(normalizedPath)) {
      return null;
    }

    const image = nativeImage.createFromPath(normalizedPath);
    if (image.isEmpty()) {
      return null;
    }
    const size = image.isEmpty() ? { width: 0, height: 0 } : image.getSize();
    const resolvedWidth = size.width || fallbackWidth || 0;
    const resolvedHeight = size.height || fallbackHeight || 0;

    if (resolvedWidth <= 0 || resolvedHeight <= 0) {
      return null;
    }

    return {
      imagePath: normalizedPath,
      imageUrl: image.toDataURL(),
      width: resolvedWidth,
      height: resolvedHeight,
      source,
      ...metadata,
      updatedAt: Date.now(),
    };
  }

  private async teardownRuntime(): Promise<void> {
    if (this.runtimeContext) {
      const result = await rdxShellActionService.runAction('closeRuntime', {
        contextId: this.runtimeContext.contextId,
        runtimeOwner: this.runtimeContext.runtimeOwner,
        ownerLeaseId: this.runtimeContext.ownerLeaseId,
        replaySessionId: this.runtimeContext.replaySessionId,
        captureFileId: this.runtimeContext.captureFileId,
        captureId: this.runtimeContext.captureId,
      }, {
        env: this.buildRuntimeContextEnv(),
      });
      if (!result.ok) {
        runtimeLogService.log({
          scope: 'app',
          namespace: 'context',
          severity: 'warning',
          title: 'RDX runtime close warning',
          summary: result.error ?? 'closeRuntime action failed.',
          raw: result,
        });
      }
      return;
    }

    if (this.humanPreview.status !== 'closed') {
      await this.closeHumanPreviewWindow().catch((error) => {
        runtimeLogService.log({
          scope: 'app',
          namespace: 'context',
          severity: 'warning',
          title: 'Human preview teardown warning',
          summary: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  private resetRuntimeState(previousCapture: OpenedCaptureState | null): void {
    this.openedCapture = null;
    this.contextId = null;
    this.runtimeOwner = null;
    this.ownerLeaseId = null;
    this.captures = [];
    this.activeCaptureId = null;
    this.deviceLabel = 'Local';
    this.replayDevice = null;
    this.remoteStatus = 'disconnected';
    this.runtimeContext = null;
    setRdxRuntimeContext(null);
    this.humanPreview = {
      status: 'closed',
      updatedAt: Date.now(),
    };

    if (previousCapture) {
      this.openedCapture = null;
    }
  }
}
