import { BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { rdxCliInvokerService } from '../tools/RdxCliInvokerService';
import { storageAdapter } from '../sessions/StorageAdapter';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { rendererEventHub } from '../browserAppBridge/rendererEventHub';
import type {
  AndroidBootstrapMetadata,
  ReplayDeviceEntry,
  ReplayDeviceStatusChangedPayload,
  ReplayDeviceTransport,
} from '@shared/types/device';
import { generateShortId } from '@shared/utils/id';
import type { ToolCallResult } from '@shared/types/tool';

const POLL_INTERVAL_MS = 5000;
const ACTIVATE_TIMEOUT_MS = 90000;
const PREPARED_REMOTE_TTL_MS = 10 * 60 * 1000;

const LOCAL_DEVICE: ReplayDeviceEntry = {
  id: 'local',
  label: 'Local',
  type: 'local',
  status: 'online',
  transport: 'local',
  detailText: 'Local replay ready',
};

interface DeviceResumeCacheRecord {
  deviceId: string;
  serial: string;
  label: string;
  transport: ReplayDeviceTransport;
  bootstrap?: AndroidBootstrapMetadata;
  lastValidatedAt: number;
}

interface DeviceResumeCachePayload {
  lastDevice?: DeviceResumeCacheRecord;
}

export interface PreparedRemoteSurface {
  deviceId: string;
  serial: string;
  contextId: string;
  remoteId: string;
  validatedAt: number;
  bootstrap?: AndroidBootstrapMetadata;
}

function sanitizeDeviceId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function adbUnavailableMessage(): string {
  return 'adb executable not found. Configure RDX_ANDROID_ADB_PATH or install Android platform-tools.';
}

function candidateAdbPaths(): string[] {
  const candidates: string[] = [];
  const push = (value?: string) => {
    const trimmed = value?.trim();
    if (trimmed) {
      candidates.push(trimmed);
    }
  };

  push(process.env.RDX_ANDROID_ADB_PATH);
  push(process.env.ADB);

  for (const envName of ['ANDROID_SDK_ROOT', 'ANDROID_HOME']) {
    const root = process.env[envName]?.trim();
    if (!root) {
      continue;
    }
    push(path.join(root, 'platform-tools', 'adb.exe'));
    push(path.join(root, 'platform-tools', 'adb'));
  }

  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (localAppData) {
    push(path.join(localAppData, 'Android', 'Sdk', 'platform-tools', 'adb.exe'));
  }

  return candidates;
}

function resolveAdbExecutable(): string {
  for (const candidate of candidateAdbPaths()) {
    if (fs.existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }

  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    for (const adbName of ['adb.exe', 'adb']) {
      const candidate = path.join(trimmed, adbName);
      if (fs.existsSync(candidate)) {
        return path.resolve(candidate);
      }
    }
  }

  throw new Error(adbUnavailableMessage());
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseAndroidBootstrapMetadata(payload: unknown): AndroidBootstrapMetadata | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const cleanupActions = Array.isArray(record.cleanup_actions)
    ? record.cleanup_actions.filter((item): item is string => typeof item === 'string')
    : undefined;

  const metadata: AndroidBootstrapMetadata = {
    packageName: normalizeString(record.package_name),
    activityName: normalizeString(record.activity_name),
    abi: normalizeString(record.abi),
    apkPath: normalizeString(record.apk_path),
    host: normalizeString(record.host),
    port: normalizeNumber(record.port),
    remotePort: normalizeNumber(record.remote_port),
    forwardSpec: normalizeString(record.forward_spec),
    configRemotePath: normalizeString(record.config_remote_path),
    cleanupActions,
    installedApk: normalizeBoolean(record.installed_apk),
    pushedConfig: normalizeBoolean(record.pushed_config),
    startedActivity: normalizeBoolean(record.started_activity),
    createdForward: normalizeBoolean(record.created_forward),
    installMode: record.install_mode === 'upgrade' || record.install_mode === 'force_replace'
      ? record.install_mode
      : undefined,
    installReason:
      record.install_reason === 'fresh_install'
      || record.install_reason === 'mismatched_existing_apk'
      || record.install_reason === 'version_downgrade'
      || record.install_reason === 'signature_mismatch'
        ? record.install_reason
        : undefined,
    uninstalledExisting: normalizeBoolean(record.uninstalled_existing),
  };

  return Object.values(metadata).some((value) => value !== undefined) ? metadata : undefined;
}

function parsePersistedAndroidBootstrapMetadata(payload: unknown): AndroidBootstrapMetadata | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const cleanupActions = Array.isArray(record.cleanupActions)
    ? record.cleanupActions.filter((item): item is string => typeof item === 'string')
    : undefined;

  const metadata: AndroidBootstrapMetadata = {
    packageName: normalizeString(record.packageName),
    activityName: normalizeString(record.activityName),
    abi: normalizeString(record.abi),
    apkPath: normalizeString(record.apkPath),
    host: normalizeString(record.host),
    port: normalizeNumber(record.port),
    remotePort: normalizeNumber(record.remotePort),
    forwardSpec: normalizeString(record.forwardSpec),
    configRemotePath: normalizeString(record.configRemotePath),
    cleanupActions,
    installedApk: normalizeBoolean(record.installedApk),
    pushedConfig: normalizeBoolean(record.pushedConfig),
    startedActivity: normalizeBoolean(record.startedActivity),
    createdForward: normalizeBoolean(record.createdForward),
    installMode: record.installMode === 'upgrade' || record.installMode === 'force_replace'
      ? record.installMode
      : undefined,
    installReason:
      record.installReason === 'fresh_install'
      || record.installReason === 'mismatched_existing_apk'
      || record.installReason === 'version_downgrade'
      || record.installReason === 'signature_mismatch'
        ? record.installReason
        : undefined,
    uninstalledExisting: normalizeBoolean(record.uninstalledExisting),
  };

  return Object.values(metadata).some((value) => value !== undefined) ? metadata : undefined;
}

function parseResumeCacheRecord(payload: unknown): DeviceResumeCacheRecord | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const deviceId = normalizeString(record.deviceId);
  const serial = normalizeString(record.serial);
  const label = normalizeString(record.label);
  const transport = record.transport === 'local' || record.transport === 'adb_android'
    ? record.transport
    : undefined;
  const lastValidatedAt = normalizeNumber(record.lastValidatedAt);

  if (!deviceId || !serial || !label || !transport || !lastValidatedAt) {
    return null;
  }

  return {
    deviceId,
    serial,
    label,
    transport,
    lastValidatedAt,
    bootstrap: parsePersistedAndroidBootstrapMetadata(record.bootstrap),
  };
}

function hasBootstrapManagedLaunch(bootstrap?: AndroidBootstrapMetadata): boolean {
  return Boolean(
    bootstrap
    && (
      bootstrap.startedActivity
      || bootstrap.installedApk
      || bootstrap.installMode
      || bootstrap.uninstalledExisting
    ),
  );
}

function buildBootstrapDetailText(bootstrap?: AndroidBootstrapMetadata): string[] {
  if (!bootstrap) {
    return [];
  }

  const suffix: string[] = [];
  if (bootstrap.installMode === 'force_replace') {
    suffix.push('APK force replaced');
  } else if (bootstrap.installedApk && bootstrap.installReason === 'fresh_install') {
    suffix.push('APK installed');
  } else if (bootstrap.installedApk) {
    suffix.push('APK upgraded');
  } else if (bootstrap.packageName) {
    suffix.push('APK verified');
  }

  if (bootstrap.abi) {
    suffix.push(bootstrap.abi);
  }
  if (bootstrap.forwardSpec) {
    suffix.push(bootstrap.forwardSpec);
  }

  return suffix;
}

function buildRemoteReadyText(bootstrap?: AndroidBootstrapMetadata): string {
  const prefix = hasBootstrapManagedLaunch(bootstrap)
    ? 'Started Android RenderDoc and connected'
    : 'Connected to Android RenderDoc server';
  const suffix = buildBootstrapDetailText(bootstrap);
  return suffix.length > 0 ? `${prefix} 路 ${suffix.join(' 路 ')}` : prefix;
}

function parseToolError(result: ToolCallResult, fallbackMessage: string): {
  message: string;
  code?: string;
} {
  return {
    message: result.error?.message ?? fallbackMessage,
    code: result.error?.code,
  };
}

function applyActivationFailure(
  device: ReplayDeviceEntry,
  phase: ReplayDeviceEntry['activationPhase'],
  message: string,
  code?: string,
): ReplayDeviceEntry {
  return {
    ...device,
    status: 'offline',
    detailText: message,
    lastError: message,
    remoteId: undefined,
    activationPhase: phase,
    activationErrorCode: code,
    activationErrorMessage: message,
    activationUpdatedAt: Date.now(),
  };
}

function parseAdbDeviceLine(line: string): ReplayDeviceEntry | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('List of devices attached')) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return null;
  }

  const serial = parts[0];
  const adbState = parts[1];
  const metadata = new Map<string, string>();
  for (const token of parts.slice(2)) {
    const separatorIndex = token.indexOf(':');
    if (separatorIndex > 0) {
      metadata.set(token.slice(0, separatorIndex), token.slice(separatorIndex + 1));
    }
  }

  const model = metadata.get('model');
  const deviceName = metadata.get('device');
  const transportId = metadata.get('transport_id');
  const label = model ?? deviceName ?? serial;

  let detailText = 'Ready to connect to Android RenderDoc server';
  let lastError: string | undefined;
  let status: ReplayDeviceEntry['status'] = 'offline';

  if (adbState === 'device') {
    status = 'offline';
  } else if (adbState === 'offline') {
    detailText = 'ADB reports this device as offline.';
    lastError = detailText;
  } else if (adbState === 'unauthorized') {
    detailText = 'ADB authorization required on the device.';
    lastError = detailText;
  } else {
    detailText = `ADB state: ${adbState}`;
    lastError = detailText;
  }

  if (transportId) {
    detailText = `${detailText}${detailText.endsWith('.') ? '' : '.'} transport ${transportId}`;
  }

  return {
    id: `android-${sanitizeDeviceId(serial)}`,
    label,
    serial,
    type: 'android',
    status,
    transport: 'adb_android',
    detailText,
    lastError,
    lastSeen: Date.now(),
  };
}

export class ReplayDeviceService {
  private devices = new Map<string, ReplayDeviceEntry>([[LOCAL_DEVICE.id, LOCAL_DEVICE]]);
  private pollTimer: NodeJS.Timeout | null = null;
  private mainWindow: BrowserWindow | null = null;
  private initialized = false;
  private refreshPromise: Promise<ReplayDeviceEntry[]> | null = null;
  private activationPromises = new Map<string, Promise<ReplayDeviceEntry>>();
  private preparedRemotes = new Map<string, PreparedRemoteSurface>();
  private resumeCache: DeviceResumeCacheRecord | null = null;

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    await this.loadResumeCache();
    await this.refreshDevices();
    this.pollTimer = setInterval(() => {
      void this.refreshDevices().catch((error) => {
        console.warn('[ReplayDeviceService] Poll refresh failed:', error);
      });
    }, POLL_INTERVAL_MS);
  }

  dispose(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  listDevices(): ReplayDeviceEntry[] {
    return this.getSortedDevices();
  }

  getDeviceById(deviceId: string): ReplayDeviceEntry | null {
    return this.devices.get(deviceId) ?? null;
  }

  async refreshDevices(): Promise<ReplayDeviceEntry[]> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.performRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  async activateDevice(deviceId: string): Promise<ReplayDeviceEntry> {
    const existingPromise = this.activationPromises.get(deviceId);
    if (existingPromise) {
      return existingPromise;
    }

    const activationPromise = this.performActivation(deviceId)
      .finally(() => {
        this.activationPromises.delete(deviceId);
      });

    this.activationPromises.set(deviceId, activationPromise);
    return activationPromise;
  }

  peekPreparedRemote(deviceId: string): PreparedRemoteSurface | null {
    const prepared = this.resolvePreparedRemote(deviceId);
    return prepared ? { ...prepared } : null;
  }

  consumePreparedRemote(deviceId: string): PreparedRemoteSurface | null {
    const prepared = this.resolvePreparedRemote(deviceId);
    if (!prepared) {
      return null;
    }

    this.preparedRemotes.delete(deviceId);
    return { ...prepared };
  }

  invalidatePreparedRemote(deviceId: string): void {
    this.preparedRemotes.delete(deviceId);
    const device = this.devices.get(deviceId);
    if (!device || device.type !== 'android' || device.status === 'offline') {
      return;
    }

    this.updateDevice({
      ...device,
      status: 'offline',
      remoteId: undefined,
      detailText: 'Ready to connect to Android RenderDoc server',
      lastError: undefined,
      activationPhase: 'idle',
      activationErrorCode: undefined,
      activationErrorMessage: undefined,
      activationUpdatedAt: Date.now(),
    });
  }

  private getResumeCachePath(): string {
    return path.join(storageAdapter.getWorkspacePath(), 'common', 'config', 'device_resume.json');
  }

  private async loadResumeCache(): Promise<void> {
    try {
      const cachePath = this.getResumeCachePath();
      if (!fs.existsSync(cachePath)) {
        this.resumeCache = null;
        return;
      }

      const content = await fs.promises.readFile(cachePath, 'utf-8');
      const parsed = JSON.parse(content) as DeviceResumeCachePayload;
      this.resumeCache = parseResumeCacheRecord(parsed.lastDevice);
    } catch (error) {
      console.warn('[ReplayDeviceService] Failed to read device resume cache:', error);
      this.resumeCache = null;
    }
  }

  private async persistResumeCache(device: ReplayDeviceEntry, validatedAt: number): Promise<void> {
    if (device.type !== 'android' || !device.serial) {
      return;
    }

    const nextRecord: DeviceResumeCacheRecord = {
      deviceId: device.id,
      serial: device.serial,
      label: device.label,
      transport: device.transport,
      bootstrap: device.bootstrap,
      lastValidatedAt: validatedAt,
    };

    this.resumeCache = nextRecord;

    try {
      const cachePath = this.getResumeCachePath();
      await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.promises.writeFile(
        cachePath,
        JSON.stringify({ lastDevice: nextRecord }, null, 2),
        'utf-8',
      );
    } catch (error) {
      console.warn('[ReplayDeviceService] Failed to persist device resume cache:', error);
    }
  }

  private resolvePreparedRemote(deviceId: string): PreparedRemoteSurface | null {
    const prepared = this.preparedRemotes.get(deviceId);
    if (!prepared) {
      return null;
    }

    const currentDevice = this.devices.get(deviceId);
    const expired = Date.now() - prepared.validatedAt > PREPARED_REMOTE_TTL_MS;
    const serialMismatch = Boolean(currentDevice?.serial && currentDevice.serial !== prepared.serial);
    if (expired || serialMismatch) {
      this.preparedRemotes.delete(deviceId);
      return null;
    }

    return prepared;
  }

  private shouldPreserveTransientState(device: ReplayDeviceEntry): boolean {
    return device.status !== 'offline';
  }

  private maybeDecorateFromResumeCache(device: ReplayDeviceEntry): ReplayDeviceEntry {
    if (
      device.type !== 'android'
      || !device.serial
      || !this.resumeCache
      || this.resumeCache.serial !== device.serial
      || device.bootstrap
    ) {
      return device;
    }

    return {
      ...device,
      bootstrap: this.resumeCache.bootstrap,
    };
  }

  private async performRefresh(): Promise<ReplayDeviceEntry[]> {
    const detectedDevices = await this.detectAdbDevices();
    const now = Date.now();
    const nextDevices = new Map<string, ReplayDeviceEntry>([[LOCAL_DEVICE.id, { ...LOCAL_DEVICE, lastSeen: now }]]);
    const detectedIds = new Set<string>(['local']);

    for (const detected of detectedDevices) {
      const decoratedDevice = this.maybeDecorateFromResumeCache(detected);
      detectedIds.add(decoratedDevice.id);
      const previous = this.devices.get(decoratedDevice.id);
      if (previous && this.shouldPreserveTransientState(previous) && decoratedDevice.lastError === undefined) {
        nextDevices.set(decoratedDevice.id, {
          ...decoratedDevice,
          status: previous.status,
          detailText: previous.detailText ?? decoratedDevice.detailText,
          lastError: previous.lastError,
          remoteId: previous.remoteId,
          bootstrap: previous.bootstrap ?? decoratedDevice.bootstrap,
          activationPhase: previous.activationPhase,
          activationErrorCode: previous.activationErrorCode,
          activationErrorMessage: previous.activationErrorMessage,
          activationUpdatedAt: previous.activationUpdatedAt,
          lastSeen: decoratedDevice.lastSeen ?? previous.lastSeen,
        });
      } else if (
        previous
        && previous.activationErrorMessage
        && previous.lastError
        && decoratedDevice.status === 'offline'
        && decoratedDevice.lastError === undefined
      ) {
        nextDevices.set(decoratedDevice.id, {
          ...decoratedDevice,
          detailText: previous.detailText ?? previous.activationErrorMessage,
          lastError: previous.lastError,
          remoteId: previous.remoteId,
          bootstrap: previous.bootstrap ?? decoratedDevice.bootstrap,
          activationPhase: previous.activationPhase,
          activationErrorCode: previous.activationErrorCode,
          activationErrorMessage: previous.activationErrorMessage,
          activationUpdatedAt: previous.activationUpdatedAt,
          lastSeen: decoratedDevice.lastSeen ?? previous.lastSeen,
        });
      } else {
        nextDevices.set(decoratedDevice.id, decoratedDevice);
      }
    }

    for (const [deviceId, device] of this.devices.entries()) {
      if (detectedIds.has(deviceId) || deviceId === 'local') {
        continue;
      }

      this.preparedRemotes.delete(deviceId);

      nextDevices.set(deviceId, {
        ...device,
        status: 'offline',
        detailText: 'ADB device not detected.',
        lastError: 'ADB device not detected.',
      });
    }

    return this.replaceDevices(nextDevices);
  }

  private async detectAdbDevices(): Promise<ReplayDeviceEntry[]> {
    try {
      const lines = await this.runAdbCommand(['devices', '-l']);
      return lines
        .map((line) => parseAdbDeviceLine(line))
        .filter((device): device is ReplayDeviceEntry => device !== null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const offlineDevices = this.getSortedDevices()
        .filter((device) => device.id !== 'local')
        .map((device) => ({
          ...device,
          status: 'offline' as const,
          detailText: message,
          lastError: message,
        }));

      this.preparedRemotes.clear();

      const fallbackDevices = new Map<string, ReplayDeviceEntry>([[LOCAL_DEVICE.id, LOCAL_DEVICE]]);
      for (const device of offlineDevices) {
        fallbackDevices.set(device.id, device);
      }
      return this.replaceDevices(fallbackDevices);
    }
  }

  private async performActivation(deviceId: string): Promise<ReplayDeviceEntry> {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new Error(`Replay device ${deviceId} not found.`);
    }

    if (device.type === 'local') {
      this.updateDevice({
        ...device,
        status: 'online',
        detailText: 'Local replay ready',
        lastError: undefined,
      });
      return this.devices.get(deviceId)!;
    }

    this.updateDevice({
      ...device,
      status: 'loading',
      detailText: 'Connecting to Android RenderDoc...',
      lastError: undefined,
      activationPhase: 'daemon',
      activationErrorCode: undefined,
      activationErrorMessage: undefined,
      activationUpdatedAt: Date.now(),
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Timed out while starting the remote server.')), ACTIVATE_TIMEOUT_MS);
    });

    try {
      const activated = await Promise.race([
        this.activateRemoteDevice(deviceId),
        timeoutPromise,
      ]);
      this.updateDevice(activated);
      return activated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const currentDevice = this.devices.get(deviceId) ?? device;
      const failedDevice = applyActivationFailure(
        currentDevice,
        currentDevice.activationPhase ?? 'connect',
        message,
        currentDevice.activationErrorCode,
      );
      this.updateDevice(failedDevice);
      return failedDevice;
    }
  }

  private async activateRemoteDevice(deviceId: string): Promise<ReplayDeviceEntry> {
    const device = this.devices.get(deviceId);
    if (!device?.serial) {
      throw new Error('Android device serial is missing.');
    }

    await this.ensureDaemonReady();
    this.updateDevice({
      ...device,
      status: 'loading',
      detailText: 'Allocating remote context...',
      lastError: undefined,
      activationPhase: 'context',
      activationUpdatedAt: Date.now(),
    });

    let contextId = `ctx-device-${sanitizeDeviceId(device.serial)}-${generateShortId()}`;

    const contextResult = await rdxCliInvokerService.call({
      toolName: 'rd.session.create_context',
      args: { context_id: contextId },
    });
    if (!contextResult.ok) {
      if (contextResult.error?.message?.includes('Context limit exceeded')) {
        const reusableContextId = await this.resolveReusableContextId();
        if (reusableContextId) {
          contextId = reusableContextId;
        } else {
          const parsedError = parseToolError(contextResult, 'Failed to create a replay device context.');
          throw new Error(parsedError.message);
        }
      } else {
        const parsedError = parseToolError(contextResult, 'Failed to create a replay device context.');
        throw new Error(parsedError.message);
      }
    }

    this.updateDevice({
      ...device,
      status: 'loading',
      detailText: 'Initializing remote capability...',
      lastError: undefined,
      activationPhase: 'init',
      activationUpdatedAt: Date.now(),
    });
    const initResult = await rdxCliInvokerService.call({
      toolName: 'rd.core.init',
      args: {},
      contextId,
    });
    if (!initResult.ok) {
      const parsedError = parseToolError(initResult, 'Failed to initialize remote capability.');
      throw new Error(parsedError.message);
    }

    this.updateDevice({
      ...device,
      status: 'loading',
      detailText: 'Connecting to Android RenderDoc server...',
      lastError: undefined,
      activationPhase: 'connect',
      activationUpdatedAt: Date.now(),
    });
    const connectResult = await rdxCliInvokerService.call({
      toolName: 'rd.remote.connect',
      args: {
        timeout_ms: 5000,
        options: {
          transport: 'adb_android',
          device_serial: device.serial,
        },
      },
      contextId,
    });
    if (!connectResult.ok) {
      const parsedError = parseToolError(connectResult, 'Failed to connect to the Android RenderDoc server.');
      throw new Error(parsedError.message);
    }

    const remoteId = typeof connectResult.data?.remote_id === 'string'
      ? connectResult.data.remote_id
      : undefined;
    if (!remoteId) {
      throw new Error('Remote connect did not return a remote_id.');
    }

    const bootstrap = parseAndroidBootstrapMetadata(
      connectResult.data?.detail && typeof connectResult.data.detail === 'object'
        ? (connectResult.data.detail as Record<string, unknown>).bootstrap
        : undefined,
    );

    this.updateDevice({
      ...device,
      status: 'connected',
      remoteId,
      bootstrap,
      detailText: buildRemoteReadyText(bootstrap),
      lastError: undefined,
      activationPhase: 'ping',
      activationErrorCode: undefined,
      activationErrorMessage: undefined,
      activationUpdatedAt: Date.now(),
      lastSeen: Date.now(),
    });

    const pingResult = await rdxCliInvokerService.call({
      toolName: 'rd.remote.ping',
      args: { remote_id: remoteId },
      contextId,
    });
    if (!pingResult.ok) {
      const parsedError = parseToolError(pingResult, 'Remote server ping failed.');
      throw new Error(parsedError.message);
    }

    this.updateDevice({
      ...device,
      status: 'connected',
      remoteId,
      bootstrap,
      detailText: buildRemoteReadyText(bootstrap),
      lastError: undefined,
      activationPhase: 'targets',
      activationUpdatedAt: Date.now(),
      lastSeen: Date.now(),
    });
    const targetsResult = await rdxCliInvokerService.call({
      toolName: 'rd.remote.list_targets',
      args: { remote_id: remoteId },
      contextId,
    });
    if (!targetsResult.ok) {
      const parsedError = parseToolError(targetsResult, 'Remote target discovery failed.');
      throw new Error(parsedError.message);
    }

    const validatedAt = Date.now();
    this.preparedRemotes.set(deviceId, {
      deviceId,
      serial: device.serial,
      contextId,
      remoteId,
      validatedAt,
      bootstrap,
    });
    await this.persistResumeCache({
      ...device,
      bootstrap,
    }, validatedAt);

    return {
      ...device,
      status: 'online',
      remoteId,
      bootstrap,
      detailText: buildRemoteReadyText(bootstrap),
      lastError: undefined,
      activationPhase: 'ready',
      activationErrorCode: undefined,
      activationErrorMessage: undefined,
      activationUpdatedAt: validatedAt,
      lastSeen: Date.now(),
    };
  }

  private async ensureDaemonReady(): Promise<void> {
    const statusResult = await rdxCliInvokerService.executeCLI('daemon', ['status']);
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

    const startResult = await rdxCliInvokerService.executeCLI('daemon', ['start']);
    if (startResult.exitCode !== 0) {
      const stderr = startResult.stderr.trim();
      throw new Error(stderr || 'Failed to start the rdx daemon.');
    }
  }

  private async resolveReusableContextId(): Promise<string | null> {
    const daemonResult = await rdxCliInvokerService.executeCLI('daemon', ['start']);
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

  private async runAdbCommand(args: string[]): Promise<string[]> {
    const adbPath = resolveAdbExecutable();

    return new Promise((resolve, reject) => {
      const proc = spawn(adbPath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf-8');
      });

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf-8');
      });

      proc.on('error', (error) => {
        reject(error);
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `adb exited with code ${code ?? -1}.`));
          return;
        }

        resolve(stdout.split(/\r?\n/));
      });
    });
  }

  private updateDevice(device: ReplayDeviceEntry): void {
    const previous = this.devices.get(device.id);
    this.devices.set(device.id, device);
    if (
      !previous
      || previous.status !== device.status
      || previous.detailText !== device.detailText
      || previous.activationPhase !== device.activationPhase
    ) {
      runtimeLogService.log({
        scope: 'app',
        namespace: 'device',
        severity: device.status === 'online'
          ? 'success'
          : device.status === 'offline'
            ? 'warning'
            : device.status === 'loading'
              ? 'info'
              : 'info',
        title: device.label,
        summary: `${device.type === 'local' ? 'Local' : 'Android'} Replay Device status: ${device.status}`,
        detail: device.detailText,
        raw: {
          deviceId: device.id,
          status: device.status,
          activationPhase: device.activationPhase ?? null,
          remoteId: device.remoteId ?? null,
          lastError: device.lastError ?? null,
        },
      });
    }
    this.broadcast({
      device,
      devices: this.getSortedDevices(),
    });
  }

  private replaceDevices(nextDevices: Map<string, ReplayDeviceEntry>): ReplayDeviceEntry[] {
    const previous = this.getSortedDevices();
    this.devices = nextDevices;
    const devices = this.getSortedDevices();
    const changedDevice = devices.find((device, index) => JSON.stringify(device) !== JSON.stringify(previous[index]));
    const hasLengthChange = previous.length !== devices.length;

    if (changedDevice || hasLengthChange) {
      this.broadcast({
        device: changedDevice ?? devices[0] ?? LOCAL_DEVICE,
        devices,
      });
    }

    return devices;
  }

  private broadcast(payload: ReplayDeviceStatusChangedPayload): void {
    rendererEventHub.emit('device:statusChanged', payload);
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    this.mainWindow.webContents.send('device:statusChanged', payload);
  }

  private getSortedDevices(): ReplayDeviceEntry[] {
    const devices = Array.from(this.devices.values());
    return devices.sort((a, b) => {
      if (a.id === 'local') return -1;
      if (b.id === 'local') return 1;
      return a.label.localeCompare(b.label);
    });
  }
}

export const replayDeviceService = new ReplayDeviceService();

