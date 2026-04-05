/**
 * RdxSessionService - Session / Runtime 编排层
 * ToolBridge 上层，负责 bootstrap、context 分配、owner claim 和 capture 会话管理
 */

import fs from 'fs';
import path from 'path';
import { nativeImage } from 'electron';
import { pathToFileURL } from 'url';
import { ToolBridge } from './ToolBridge';
import { appPathService } from './AppPathService';
import { replayDeviceService, type PreparedRemoteSurface } from './ReplayDeviceService';
import { runtimeLogService } from './RuntimeLogService';
import type {
  CaptureDescriptor,
  DebugSessionStartRequest,
  ContextSnapshot,
  OpenedCaptureState,
  OpenedCapturePreview,
  OpenProjectInputRequest,
} from '@shared/types/session';
import type { ReplayDeviceEntry } from '@shared/types/device';
import type { ToolCallResult } from '@shared/types/tool';
import { generateId, generateShortId } from '@shared/utils/id';

export class RdxSessionService {
  private toolBridge: ToolBridge;
  private contextId: string | null = null;
  private runtimeOwner: string | null = null;
  private ownerLeaseId: string | null = null;
  private captures: CaptureDescriptor[] = [];
  private activeCaptureId: string | null = null;
  private deviceLabel = 'Local';
  private replayDevice: ReplayDeviceEntry | null = null;
  private remoteStatus: 'connected' | 'online' | 'disconnected' | 'error' = 'disconnected';
  private remoteId: string | null = null;
  private openedCapture: OpenedCaptureState | null = null;

  constructor(toolBridge: ToolBridge) {
    this.toolBridge = toolBridge;
  }

  async bootstrap(request: DebugSessionStartRequest): Promise<ContextSnapshot> {
    if (this.canReuseOpenedCapture(request)) {
      this.captures = request.captures.map((capture) => (
        capture.id === request.primaryCaptureId && this.openedCapture
          ? {
              ...capture,
              status: 'open',
              sessionId: this.openedCapture.sessionId,
              replaySessionId: this.openedCapture.replaySessionId,
              contextId: this.openedCapture.contextId,
            }
          : { ...capture }
      ));
      this.activeCaptureId = request.primaryCaptureId;
      return this.snapshotContext();
    }

    await this.ensureRuntimeReady();

    this.captures = request.captures.map((capture) => ({ ...capture }));
    this.remoteId = null;
    this.remoteStatus = 'disconnected';

    const hasRemoteCapture = this.captures.some((capture) => capture.backendHint === 'remote');
    let replayDevice = request.replayDevice;
    let reusedPreparedRemote = false;
    if (hasRemoteCapture) {
      if (replayDevice.type === 'local') {
        throw new Error('Remote capture requires an Android Replay Device.');
      }
      replayDevice = await this.ensureReplayDeviceReady(replayDevice);
      reusedPreparedRemote = await this.tryAdoptPreparedRemote(replayDevice);
    }

    this.replayDevice = replayDevice;
    this.deviceLabel = replayDevice.label;

    if (!reusedPreparedRemote) {
      await this.prepareFreshContext();
    }

    try {
      const ownerResult = await this.claimOwner(this.contextId!);
      this.runtimeOwner = ownerResult.owner;
      this.ownerLeaseId = ownerResult.leaseId;
    } catch (error) {
      if (!reusedPreparedRemote) {
        throw error;
      }

      this.resetRemoteConnectionState();
      await this.prepareFreshContext();
      const ownerResult = await this.claimOwner(this.contextId!);
      this.runtimeOwner = ownerResult.owner;
      this.ownerLeaseId = ownerResult.leaseId;
      reusedPreparedRemote = false;
    }

    if (hasRemoteCapture) {
      if (reusedPreparedRemote) {
        const preparedRemoteStillValid = await this.validatePreparedRemoteHandle();
        if (!preparedRemoteStillValid) {
          this.remoteId = null;
          this.remoteStatus = 'disconnected';
          await this.ensureRemoteConnection(replayDevice);
        } else {
          this.remoteStatus = 'online';
        }
      } else {
        await this.ensureRemoteConnection(replayDevice);
      }
    }

    const primaryCapture = this.captures.find((capture) => capture.id === request.primaryCaptureId);
    if (!primaryCapture) {
      throw new Error(`Primary capture ${request.primaryCaptureId} not found in captures list`);
    }

    await this.ensureCaptureSession(primaryCapture);
    this.activeCaptureId = primaryCapture.id;
    this.openedCapture = null;

    return this.snapshotContext();
  }

  async openProjectInput(request: OpenProjectInputRequest): Promise<OpenedCaptureState> {
    await this.closeOrReplaceOpenedCapture();
    await this.ensureRuntimeReady();

    let replayDevice = request.replayDevice;
    const isRemoteReplay = replayDevice.type === 'android';
    if (isRemoteReplay) {
      replayDevice = await this.ensureReplayDeviceReady(replayDevice);
    }

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
    this.remoteId = null;
    this.remoteStatus = 'disconnected';

    let reusedPreparedRemote = false;
    if (isRemoteReplay) {
      reusedPreparedRemote = await this.tryAdoptPreparedRemote(replayDevice);
    }

    if (!reusedPreparedRemote) {
      await this.prepareFreshContext();
    }

    try {
      const ownerResult = await this.claimOwner(this.contextId!);
      this.runtimeOwner = ownerResult.owner;
      this.ownerLeaseId = ownerResult.leaseId;
    } catch (error) {
      if (!reusedPreparedRemote) {
        throw error;
      }

      this.resetRemoteConnectionState();
      await this.prepareFreshContext();
      const ownerResult = await this.claimOwner(this.contextId!);
      this.runtimeOwner = ownerResult.owner;
      this.ownerLeaseId = ownerResult.leaseId;
      reusedPreparedRemote = false;
    }

    if (isRemoteReplay) {
      if (reusedPreparedRemote) {
        const preparedRemoteStillValid = await this.validatePreparedRemoteHandle();
        if (!preparedRemoteStillValid) {
          this.remoteId = null;
          this.remoteStatus = 'disconnected';
          await this.ensureRemoteConnection(replayDevice);
        } else {
          this.remoteStatus = 'online';
        }
      } else {
        await this.ensureRemoteConnection(replayDevice);
      }
    }

    const preview = await this.ensureCaptureSession(capture, {
      projectId: request.projectId,
      inputId: request.inputId,
    });

    const openedCapture = this.createOpenedCaptureState(
      request.projectId,
      request.inputId,
      request.filePath,
      replayDevice,
      preview,
    );
    this.openedCapture = openedCapture;
    return openedCapture;
  }

  async closeOrReplaceOpenedCapture(): Promise<void> {
    const previousCapture = this.openedCapture;
    this.openedCapture = null;
    this.contextId = null;
    this.runtimeOwner = null;
    this.ownerLeaseId = null;
    this.captures = [];
    this.activeCaptureId = null;
    this.deviceLabel = 'Local';
    this.replayDevice = null;
    this.remoteStatus = 'disconnected';
    this.remoteId = null;
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

  private async prepareFreshContext(): Promise<void> {
    this.contextId = await this.allocateContext();
    await this.initializeContextRuntime();
  }

  private async ensureRuntimeReady(): Promise<void> {
    const statusResult = await this.toolBridge.executeCLI('daemon', ['status']);
    if (statusResult.exitCode === 0) {
      try {
        const parsed = JSON.parse(statusResult.stdout) as { data?: { running?: boolean } };
        if (parsed.data?.running === true) {
          return;
        }
      } catch {
        return;
      }
    }

    const startResult = await this.toolBridge.executeCLI('daemon', ['start']);
    if (startResult.exitCode !== 0) {
      const message = startResult.stderr.trim() || `Exit code: ${startResult.exitCode}`;
      throw new Error(`Failed to start rdx daemon: ${message}`);
    }
  }

  async allocateContext(): Promise<string> {
    const contextId = `ctx-${generateShortId()}`;
    const result: ToolCallResult = await this.toolBridge.call({
      toolName: 'rd.session.create_context',
      args: { context_id: contextId },
      contextId,
    });
    if (!result.ok) {
      if (result.error?.message?.includes('Context limit exceeded')) {
        const reusableContextId = await this.resolveReusableContextId();
        if (reusableContextId) {
          return reusableContextId;
        }
      }
      throw new Error(`Failed to allocate context: ${result.error?.message ?? 'unknown'}`);
    }
    return contextId;
  }

  private async resolveReusableContextId(): Promise<string | null> {
    const daemonResult = await this.toolBridge.executeCLI('daemon', ['start']);
    if (daemonResult.exitCode !== 0 || !daemonResult.stdout.trim()) {
      return null;
    }

    try {
      const parsed = JSON.parse(daemonResult.stdout) as { data?: { state?: { context_id?: string } } };
      return parsed.data?.state?.context_id ?? null;
    } catch {
      return null;
    }
  }

  private async initializeContextRuntime(): Promise<void> {
    const result = await this.toolBridge.call({
      toolName: 'rd.core.init',
      args: {},
      contextId: this.contextId!,
    });
    if (!result.ok) {
      throw new Error(`Failed to initialize runtime context: ${result.error?.message ?? 'unknown'}`);
    }
  }

  async claimOwner(contextId: string): Promise<{ owner: string; leaseId: string }> {
    const owner = `rdc-agent-${generateShortId()}`;
    const leaseId = generateId();
    const result: ToolCallResult = await this.toolBridge.call({
      toolName: 'rd.session.claim_owner',
      args: { context_id: contextId, owner, lease_id: leaseId },
      contextId,
      runtimeOwner: owner,
    });
    if (!result.ok) {
      throw new Error(`Failed to claim owner: ${result.error?.message ?? 'unknown'}`);
    }
    return { owner, leaseId };
  }

  private buildClaimedToolRequest(toolName: string, args: Record<string, unknown>) {
    return {
      toolName,
      args,
      contextId: this.contextId!,
      runtimeOwner: this.runtimeOwner!,
      ownerLeaseId: this.ownerLeaseId ?? undefined,
    };
  }

  async ensureCaptureSession(
    capture: CaptureDescriptor,
    previewContext?: { projectId: string; inputId: string },
  ): Promise<OpenedCapturePreview | null> {
    const captureIndex = this.captures.findIndex((item) => item.id === capture.id);
    if (captureIndex < 0) {
      throw new Error(`Capture ${capture.id} not in captures list`);
    }

    this.captures[captureIndex] = { ...this.captures[captureIndex], status: 'opening' };

    try {
      const openResult: ToolCallResult = await this.toolBridge.call(this.buildClaimedToolRequest(
        'rd.capture.open_file',
        { file_path: capture.filePath },
      ));
      if (!openResult.ok) {
        throw new Error(`Failed to open capture file: ${openResult.error?.message ?? 'unknown'}`);
      }

      const captureFileId = openResult.data?.capture_file_id as string | undefined;

      const replayArgs: Record<string, unknown> = {
        capture_file_id: captureFileId ?? capture.id,
      };
      if (capture.backendHint === 'remote') {
        if (!this.remoteId) {
          throw new Error('Remote replay requested but remote connection is not ready.');
        }
        replayArgs.options = {
          remote_id: this.remoteId,
        };
      }

      const replayResult: ToolCallResult = await this.toolBridge.call(this.buildClaimedToolRequest(
        'rd.capture.open_replay',
        replayArgs,
      ));
      if (!replayResult.ok) {
        if (capture.backendHint === 'remote') {
          throw new Error(`Remote replay failed (hard fail, no local fallback): ${replayResult.error?.message ?? 'unknown'}`);
        }
        throw new Error(`Failed to open replay session: ${replayResult.error?.message ?? 'unknown'}`);
      }

      this.captures[captureIndex] = {
        ...this.captures[captureIndex],
        status: 'open',
        sessionId: replayResult.data?.session_id as string | undefined,
        replaySessionId: replayResult.data?.replay_session_id as string | undefined,
        contextId: this.contextId!,
      };

      if (!previewContext || !captureFileId) {
        return null;
      }

      return this.loadPreferredPreview(
        previewContext.projectId,
        previewContext.inputId,
        this.captures[captureIndex].sessionId ?? '',
        captureFileId,
      );
    } catch (error) {
      this.captures[captureIndex] = { ...this.captures[captureIndex], status: 'error' };
      throw error;
    }
  }

  async switchActiveCapture(captureId: string): Promise<void> {
    const capture = this.captures.find((item) => item.id === captureId);
    if (!capture) {
      throw new Error(`Capture ${captureId} not found`);
    }

    if (capture.status === 'pending') {
      await this.ensureCaptureSession(capture);
    }

    this.activeCaptureId = captureId;
  }

  async ensureRemoteConnection(device: ReplayDeviceEntry): Promise<void> {
    if (!device.serial) {
      throw new Error('Replay Device is missing an Android serial number.');
    }

    this.replayDevice = device;
    this.remoteStatus = 'connected';

    const connectResult: ToolCallResult = await this.toolBridge.call(this.buildClaimedToolRequest(
      'rd.remote.connect',
      {
        timeout_ms: 5000,
        options: {
          transport: 'adb_android',
          device_serial: device.serial,
        },
      },
    ));
    if (!connectResult.ok) {
      this.remoteStatus = 'error';
      const detail = [
        device.activationPhase ? `phase=${device.activationPhase}` : '',
        device.activationErrorCode ? `code=${device.activationErrorCode}` : '',
      ].filter(Boolean).join(' ');
      const suffix = detail ? ` (${detail})` : '';
      throw new Error(`Remote connect failed (hard fail): ${connectResult.error?.message ?? device.activationErrorMessage ?? 'unknown'}${suffix}`);
    }

    const remoteId = connectResult.data?.remote_id as string | undefined;
    if (!remoteId) {
      this.remoteStatus = 'error';
      throw new Error('Remote connect did not return a remote_id.');
    }
    this.remoteId = remoteId;

    const pingResult: ToolCallResult = await this.toolBridge.call(this.buildClaimedToolRequest(
      'rd.remote.ping',
      { remote_id: remoteId },
    ));
    if (!pingResult.ok) {
      this.remoteStatus = 'error';
      throw new Error(`Remote ping failed (hard fail): ${pingResult.error?.message ?? device.activationErrorMessage ?? 'unknown'}`);
    }

    this.remoteStatus = 'online';
  }

  private async ensureReplayDeviceReady(device: ReplayDeviceEntry): Promise<ReplayDeviceEntry> {
    if (device.type === 'local') {
      return device;
    }

    const currentDevice = replayDeviceService.getDeviceById(device.id) ?? device;
    if (currentDevice.type === 'local') {
      return currentDevice;
    }

    if (['connected', 'online'].includes(currentDevice.status)) {
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

  private async tryAdoptPreparedRemote(device: ReplayDeviceEntry): Promise<boolean> {
    const prepared = replayDeviceService.consumePreparedRemote(device.id);
    if (!prepared) {
      return false;
    }

    if (!device.serial || prepared.serial !== device.serial) {
      replayDeviceService.invalidatePreparedRemote(device.id);
      return false;
    }

    this.adoptPreparedRemote(prepared);
    return true;
  }

  private adoptPreparedRemote(prepared: PreparedRemoteSurface): void {
    this.contextId = prepared.contextId;
    this.remoteId = prepared.remoteId;
    this.remoteStatus = 'connected';
  }

  private async validatePreparedRemoteHandle(): Promise<boolean> {
    if (!this.contextId || !this.remoteId) {
      return false;
    }

    const pingResult: ToolCallResult = await this.toolBridge.call({
      toolName: 'rd.remote.ping',
      args: { remote_id: this.remoteId },
      contextId: this.contextId,
      runtimeOwner: this.runtimeOwner ?? undefined,
      ownerLeaseId: this.ownerLeaseId ?? undefined,
    });
    if (!pingResult.ok) {
      return false;
    }

    return true;
  }

  private resetRemoteConnectionState(): void {
    this.contextId = null;
    this.runtimeOwner = null;
    this.ownerLeaseId = null;
    this.remoteId = null;
    this.remoteStatus = 'disconnected';
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

  private createOpenedCaptureState(
    projectId: string,
    inputId: string,
    filePath: string,
    replayDevice: ReplayDeviceEntry,
    preview: OpenedCapturePreview | null,
  ): OpenedCaptureState {
    const activeCapture = this.captures.find((capture) => capture.id === this.activeCaptureId) ?? this.captures[0];
    return {
      projectId,
      inputId,
      filePath,
      captureId: activeCapture?.id ?? inputId,
      sessionId: activeCapture?.sessionId ?? '',
      contextId: this.contextId ?? '',
      replaySessionId: activeCapture?.replaySessionId ?? '',
      backend: activeCapture?.backendHint ?? 'local',
      deviceId: replayDevice.id,
      deviceLabel: replayDevice.label,
      status: activeCapture?.status === 'error' ? 'error' : 'open',
      openedAt: Date.now(),
      preview,
    };
  }

  private async loadPreferredPreview(
    projectId: string,
    inputId: string,
    sessionId: string,
    captureFileId: string,
  ): Promise<OpenedCapturePreview | null> {
    const framebufferPreview = sessionId
      ? await this.loadFramebufferPreview(projectId, inputId, sessionId)
      : null;
    if (framebufferPreview) {
      runtimeLogService.log({
        scope: 'app',
        namespace: 'capture',
        severity: 'success',
        title: 'Preview ready',
        summary: `已加载 ${inputId} 的最终渲染预览。`,
        detail: framebufferPreview.width > 0 && framebufferPreview.height > 0
          ? `${framebufferPreview.width}x${framebufferPreview.height} · framebuffer`
          : 'framebuffer',
        projectId,
      });
      return framebufferPreview;
    }

    const thumbnailPreview = await this.loadCaptureThumbnail(captureFileId);
    if (thumbnailPreview) {
      runtimeLogService.log({
        scope: 'app',
        namespace: 'capture',
        severity: 'warning',
        title: 'Preview fallback',
        summary: `最终 framebuffer 不可用，已回退为 ${inputId} 的 capture thumbnail。`,
        detail: thumbnailPreview.width > 0 && thumbnailPreview.height > 0
          ? `${thumbnailPreview.width}x${thumbnailPreview.height} · thumbnail`
          : 'thumbnail',
        projectId,
      });
      return thumbnailPreview;
    }

    runtimeLogService.log({
      scope: 'app',
      namespace: 'capture',
      severity: 'warning',
      title: 'Preview unavailable',
      summary: `已打开 ${inputId}，但当前没有可用预览内容。`,
      projectId,
    });
    return null;
  }

  private async loadFramebufferPreview(
    projectId: string,
    inputId: string,
    sessionId: string,
  ): Promise<OpenedCapturePreview | null> {
    const outputPath = appPathService.getCapturePreviewPath(projectId, inputId);
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

    const result: ToolCallResult = await this.toolBridge.call(this.buildClaimedToolRequest(
      'rd.export.screenshot',
      {
        session_id: sessionId,
        output_path: outputPath,
        file_format: 'png',
        include_alpha: true,
      },
    ));
    if (!result.ok) {
      return null;
    }

    const imagePath = this.resolvePreviewPath(result, outputPath);
    return imagePath
      ? this.createPreviewFromPath(imagePath, 'framebuffer_screenshot')
      : null;
  }

  private async loadCaptureThumbnail(captureFileId: string): Promise<OpenedCapturePreview | null> {
    const result: ToolCallResult = await this.toolBridge.call(this.buildClaimedToolRequest(
      'rd.capture.get_thumbnail',
      {
        capture_file_id: captureFileId,
        max_size_px: 640,
      },
    ));

    if (!result.ok) {
      return null;
    }

    const imagePath = this.resolvePreviewPath(result);
    if (!imagePath) {
      return null;
    }

    return this.createPreviewFromPath(
      imagePath,
      'capture_thumbnail',
      typeof result.data?.width === 'number' ? result.data.width : undefined,
      typeof result.data?.height === 'number' ? result.data.height : undefined,
    );
  }

  private resolvePreviewPath(result: ToolCallResult, fallbackPath?: string): string | null {
    const imagePath = typeof result.data?.image_path === 'string'
      ? result.data.image_path
      : typeof result.data?.saved_path === 'string'
        ? result.data.saved_path
        : typeof result.data?.artifact_path === 'string'
          ? result.data.artifact_path
          : typeof result.data?.path === 'string'
            ? result.data.path
            : result.artifacts?.[0]?.path ?? fallbackPath ?? null;

    return imagePath ? path.resolve(imagePath) : null;
  }

  private createPreviewFromPath(
    imagePath: string,
    source: OpenedCapturePreview['source'],
    fallbackWidth?: number,
    fallbackHeight?: number,
  ): OpenedCapturePreview | null {
    const normalizedPath = path.resolve(imagePath);
    if (!fs.existsSync(normalizedPath)) {
      return null;
    }

    const image = nativeImage.createFromPath(normalizedPath);
    const size = image.isEmpty() ? { width: 0, height: 0 } : image.getSize();

    return {
      imagePath: normalizedPath,
      imageUrl: pathToFileURL(normalizedPath).toString(),
      width: size.width || fallbackWidth || 0,
      height: size.height || fallbackHeight || 0,
      source,
      updatedAt: Date.now(),
    };
  }

  private canReuseOpenedCapture(request: DebugSessionStartRequest): boolean {
    const primaryCapture = request.captures.find((capture) => capture.id === request.primaryCaptureId);
    if (!primaryCapture || !this.openedCapture) {
      return false;
    }

    return Boolean(
      this.contextId
      && this.runtimeOwner
      && this.ownerLeaseId
      && this.openedCapture.status === 'open'
      && primaryCapture.id === this.openedCapture.inputId
      && primaryCapture.filePath === this.openedCapture.filePath
      && primaryCapture.backendHint === this.openedCapture.backend
      && request.replayDevice.id === this.openedCapture.deviceId,
    );
  }
}

export function createRdxSessionService(toolBridge: ToolBridge): RdxSessionService {
  return new RdxSessionService(toolBridge);
}
