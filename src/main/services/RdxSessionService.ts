/**
 * RdxSessionService - Session / Runtime 编排层
 * ToolBridge 上层，负责 bootstrap、context 分配、owner claim 和 capture 会话管理
 */

import { ToolBridge } from './ToolBridge';
import { replayDeviceService, type PreparedRemoteSurface } from './ReplayDeviceService';
import type {
  CaptureDescriptor,
  DebugSessionStartRequest,
  ContextSnapshot,
  OpenedCaptureState,
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
    this.replayDevice = request.replayDevice;
    this.deviceLabel = request.replayDevice.label;
    this.remoteId = null;
    this.remoteStatus = 'disconnected';

    const hasRemoteCapture = this.captures.some((capture) => capture.backendHint === 'remote');
    let reusedPreparedRemote = false;
    if (hasRemoteCapture) {
      if (request.replayDevice.type === 'local' || request.replayDevice.status !== 'online') {
        throw new Error('Remote capture requires an online Replay Device.');
      }
      reusedPreparedRemote = await this.tryAdoptPreparedRemote(request.replayDevice);
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

    if (hasRemoteCapture) {
      if (reusedPreparedRemote) {
        const preparedRemoteStillValid = await this.validatePreparedRemoteHandle();
        if (!preparedRemoteStillValid) {
          this.remoteId = null;
          this.remoteStatus = 'disconnected';
          await this.ensureRemoteConnection(request.replayDevice);
        } else {
          this.remoteStatus = 'online';
        }
      } else {
        await this.ensureRemoteConnection(request.replayDevice);
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

    const capture: CaptureDescriptor = {
      id: request.inputId,
      filePath: request.filePath,
      role: 'primary',
      backendHint: request.replayDevice.type === 'local' ? 'local' : 'remote',
      status: 'pending',
    };

    this.captures = [capture];
    this.activeCaptureId = capture.id;
    this.replayDevice = request.replayDevice;
    this.deviceLabel = request.replayDevice.label;
    this.remoteId = null;
    this.remoteStatus = 'disconnected';

    await this.prepareFreshContext();

    const ownerResult = await this.claimOwner(this.contextId!);
    this.runtimeOwner = ownerResult.owner;
    this.ownerLeaseId = ownerResult.leaseId;

    if (capture.backendHint === 'remote') {
      if (request.replayDevice.type === 'local' || !['connected', 'online'].includes(request.replayDevice.status)) {
        throw new Error('Remote capture requires an available Replay Device.');
      }
      await this.ensureRemoteConnection(request.replayDevice);
    }

    await this.ensureCaptureSession(capture);

    const openedCapture = this.createOpenedCaptureState(request.projectId, request.inputId, request.filePath, request.replayDevice);
    this.openedCapture = openedCapture;
    return openedCapture;
  }

  async closeOrReplaceOpenedCapture(): Promise<void> {
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
  }

  private async prepareFreshContext(): Promise<void> {
    this.contextId = await this.allocateContext();
    await this.initializeContextRuntime();
  }

  private async ensureRuntimeReady(): Promise<void> {
    const statusResult = await this.toolBridge.executeCLI('daemon', ['status']);
    if (statusResult.exitCode === 0) {
      return;
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
      throw new Error(`Failed to allocate context: ${result.error?.message ?? 'unknown'}`);
    }
    return contextId;
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

  async ensureCaptureSession(capture: CaptureDescriptor): Promise<void> {
    const captureIndex = this.captures.findIndex((item) => item.id === capture.id);
    if (captureIndex < 0) {
      throw new Error(`Capture ${capture.id} not in captures list`);
    }

    this.captures[captureIndex] = { ...this.captures[captureIndex], status: 'opening' };

    try {
      const openResult: ToolCallResult = await this.toolBridge.call({
        toolName: 'rd.capture.open_file',
        args: { file_path: capture.filePath },
        contextId: this.contextId!,
        runtimeOwner: this.runtimeOwner!,
      });
      if (!openResult.ok) {
        throw new Error(`Failed to open capture file: ${openResult.error?.message ?? 'unknown'}`);
      }

      const replayArgs: Record<string, unknown> = {
        capture_file_id: (openResult.data?.capture_file_id as string) ?? capture.id,
      };
      if (capture.backendHint === 'remote') {
        if (!this.remoteId) {
          throw new Error('Remote replay requested but remote connection is not ready.');
        }
        replayArgs.remote_id = this.remoteId;
      }

      const replayResult: ToolCallResult = await this.toolBridge.call({
        toolName: 'rd.capture.open_replay',
        args: replayArgs,
        contextId: this.contextId!,
        runtimeOwner: this.runtimeOwner!,
      });
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

    const connectResult: ToolCallResult = await this.toolBridge.call({
      toolName: 'rd.remote.connect',
      args: {
        timeout_ms: 5000,
        options: {
          transport: 'adb_android',
          device_serial: device.serial,
        },
      },
      contextId: this.contextId!,
      runtimeOwner: this.runtimeOwner!,
    });
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

    const pingResult: ToolCallResult = await this.toolBridge.call({
      toolName: 'rd.remote.ping',
      args: { remote_id: remoteId },
      contextId: this.contextId!,
      runtimeOwner: this.runtimeOwner!,
    });
    if (!pingResult.ok) {
      this.remoteStatus = 'error';
      throw new Error(`Remote ping failed (hard fail): ${pingResult.error?.message ?? device.activationErrorMessage ?? 'unknown'}`);
    }

    this.remoteStatus = 'online';
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
