/**
 * RdxSessionService - Session / Runtime 编排层
 * ToolBridge 上层，负责 bootstrap、context 分配、owner claim 和 capture 会话管理
 */

import { ToolBridge } from './ToolBridge';
import type {
  CaptureDescriptor,
  DebugSessionStartRequest,
  ContextSnapshot,
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

  constructor(toolBridge: ToolBridge) {
    this.toolBridge = toolBridge;
  }

  async bootstrap(request: DebugSessionStartRequest): Promise<ContextSnapshot> {
    await this.ensureRuntimeReady();

    this.contextId = await this.allocateContext();
    await this.initializeContextRuntime();

    const ownerResult = await this.claimOwner(this.contextId);
    this.runtimeOwner = ownerResult.owner;
    this.ownerLeaseId = ownerResult.leaseId;

    this.captures = request.captures.map((capture) => ({ ...capture }));
    this.replayDevice = request.replayDevice;
    this.deviceLabel = request.replayDevice.label;
    this.remoteId = null;
    this.remoteStatus = 'disconnected';

    const hasRemoteCapture = this.captures.some((capture) => capture.backendHint === 'remote');
    if (hasRemoteCapture) {
      if (request.replayDevice.type === 'local' || request.replayDevice.status !== 'online') {
        throw new Error('Remote capture requires an online Replay Device.');
      }
      await this.ensureRemoteConnection(request.replayDevice);
    }

    const primaryCapture = this.captures.find((capture) => capture.id === request.primaryCaptureId);
    if (!primaryCapture) {
      throw new Error(`Primary capture ${request.primaryCaptureId} not found in captures list`);
    }

    await this.ensureCaptureSession(primaryCapture);
    this.activeCaptureId = primaryCapture.id;

    return this.snapshotContext();
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
      throw new Error(`Remote connect failed (hard fail): ${connectResult.error?.message ?? 'unknown'}`);
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
      throw new Error(`Remote ping failed (hard fail): ${pingResult.error?.message ?? 'unknown'}`);
    }

    this.remoteStatus = 'online';
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
}

export function createRdxSessionService(toolBridge: ToolBridge): RdxSessionService {
  return new RdxSessionService(toolBridge);
}
