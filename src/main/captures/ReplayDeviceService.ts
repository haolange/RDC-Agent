import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { rdxShellActionService } from '../tools/RdxShellActionService';
import { storageAdapter } from '../sessions/StorageAdapter';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { rendererEventHub } from '../browserAppBridge/rendererEventHub';
import { processSupervisor } from '../runtime/ProcessSupervisor';
import type {
  AndroidBootstrapMetadata,
  ReplayDeviceEntry,
  ReplayDeviceStatusChangedPayload,
  ReplayDeviceTransport,
} from '@shared/types/device';
import { AdbExecutableCache } from './adbExecutable';
import {
  queryAdbDevicesLines,
  queryAdbDevicesLinesWithServerBootstrap,
  type AdbStartServerState,
} from './adbServerClient';
import {
  devicesSemanticallyEqual,
  nextPollIntervalMs,
  POLL_BASE_MS,
} from './replayDeviceDiff';

const ACTIVATE_TIMEOUT_MS = 90000;
const PREPARED_REMOTE_TTL_MS = 10 * 60 * 1000;
export const WATCH_POLL_MS = 2500;
export const WATCH_LEASE_TTL_MS = 10_000;

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

function readActionString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function parseRemoteBootstrap(data: Record<string, unknown>): AndroidBootstrapMetadata | undefined {
  const direct = parseAndroidBootstrapMetadata(data.bootstrap);
  if (direct) {
    return direct;
  }

  const detail = data.detail;
  if (!detail || typeof detail !== 'object') {
    return undefined;
  }

  return parseAndroidBootstrapMetadata((detail as Record<string, unknown>).bootstrap);
}

export class ReplayDeviceService {
  private devices = new Map<string, ReplayDeviceEntry>([[LOCAL_DEVICE.id, LOCAL_DEVICE]]);
  private watchPollTimer: NodeJS.Timeout | null = null;
  private watchLeaseTimer: NodeJS.Timeout | null = null;
  private watchActive = false;
  private watchLeaseDeadline = 0;
  private pollIntervalMs = POLL_BASE_MS;
  private mainWindow: BrowserWindow | null = null;
  private initialized = false;
  private refreshPromise: Promise<ReplayDeviceEntry[]> | null = null;
  private activationPromises = new Map<string, Promise<ReplayDeviceEntry>>();
  private preparedRemotes = new Map<string, PreparedRemoteSurface>();
  private resumeCache: DeviceResumeCacheRecord | null = null;
  private readonly adbExecutable = new AdbExecutableCache();
  /** Lifecycle flag: auto `adb start-server` at most once until manual refresh resets it. */
  private readonly adbStartServerState: AdbStartServerState = { startServerAttempted: false };

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    await this.loadResumeCache();
  }

  startWatch(): void {
    if (this.watchActive) {
      this.renewWatch();
      return;
    }

    this.watchActive = true;
    this.renewWatch();
    void this.runRefresh()
      .catch((error) => {
        console.warn('[ReplayDeviceService] Watch refresh failed:', error);
      })
      .finally(() => {
        if (this.watchActive) {
          this.scheduleWatchPoll();
        }
      });
  }

  renewWatch(): void {
    if (!this.watchActive) {
      return;
    }

    this.watchLeaseDeadline = Date.now() + WATCH_LEASE_TTL_MS;
    this.scheduleWatchLeaseExpiry();
  }

  stopWatch(): void {
    this.watchActive = false;
    this.watchLeaseDeadline = 0;
    if (this.watchPollTimer) {
      clearTimeout(this.watchPollTimer);
      this.watchPollTimer = null;
    }
    if (this.watchLeaseTimer) {
      clearTimeout(this.watchLeaseTimer);
      this.watchLeaseTimer = null;
    }
  }

  dispose(): void {
    this.initialized = false;
    this.stopWatch();
  }

  listDevices(): ReplayDeviceEntry[] {
    return this.getSortedDevices();
  }

  getDeviceById(deviceId: string): ReplayDeviceEntry | null {
    return this.devices.get(deviceId) ?? null;
  }

  /** Manual refresh (IPC device:refresh): run immediately and reset backoff to BASE. */
  async refreshDevices(): Promise<ReplayDeviceEntry[]> {
    this.pollIntervalMs = POLL_BASE_MS;
    // Allow one more start-server attempt after a user-initiated refresh.
    this.adbStartServerState.startServerAttempted = false;
    try {
      return await this.runRefresh();
    } finally {
      if (this.watchActive) {
        this.scheduleWatchPoll();
      }
    }
  }

  private scheduleWatchPoll(): void {
    if (!this.watchActive) {
      return;
    }

    if (this.watchPollTimer) {
      clearTimeout(this.watchPollTimer);
    }

    const delayMs = Math.max(this.pollIntervalMs, WATCH_POLL_MS);
    this.watchPollTimer = setTimeout(() => {
      this.watchPollTimer = null;
      if (!this.watchActive) {
        return;
      }

      void this.runRefresh()
        .catch((error) => {
          console.warn('[ReplayDeviceService] Watch poll refresh failed:', error);
        })
        .finally(() => {
          if (this.watchActive) {
            this.scheduleWatchPoll();
          }
        });
    }, delayMs);
  }

  private scheduleWatchLeaseExpiry(): void {
    if (this.watchLeaseTimer) {
      clearTimeout(this.watchLeaseTimer);
    }

    const remainingMs = Math.max(0, this.watchLeaseDeadline - Date.now());
    this.watchLeaseTimer = setTimeout(() => {
      this.watchLeaseTimer = null;
      if (this.watchActive && Date.now() >= this.watchLeaseDeadline) {
        this.stopWatch();
      }
    }, remainingMs);
  }

  private async runRefresh(): Promise<ReplayDeviceEntry[]> {
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
    let adbAvailable = true;
    let detectedDevices: ReplayDeviceEntry[] = [];

    try {
      detectedDevices = await this.detectAdbDevices();
    } catch (error) {
      adbAvailable = false;
      const message = error instanceof Error ? error.message : String(error);
      this.preparedRemotes.clear();
      detectedDevices = this.getSortedDevices()
        .filter((device) => device.id !== 'local')
        .map((device) => ({
          ...device,
          status: 'offline' as const,
          detailText: message,
          lastError: message,
        }));
    }

    this.pollIntervalMs = nextPollIntervalMs(this.pollIntervalMs, adbAvailable);

    const previousLocal = this.devices.get(LOCAL_DEVICE.id) ?? LOCAL_DEVICE;
    const nextDevices = new Map<string, ReplayDeviceEntry>([[
      LOCAL_DEVICE.id,
      { ...LOCAL_DEVICE, lastSeen: previousLocal.lastSeen },
    ]]);
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
          lastSeen: previous.lastSeen ?? decoratedDevice.lastSeen,
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
          lastSeen: previous.lastSeen ?? decoratedDevice.lastSeen,
        });
      } else if (previous && devicesSemanticallyEqual([previous], [{ ...decoratedDevice, lastSeen: previous.lastSeen }])) {
        // Preserve previous lastSeen when identity is unchanged.
        nextDevices.set(decoratedDevice.id, { ...decoratedDevice, lastSeen: previous.lastSeen });
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
    const lines = await queryAdbDevicesLinesWithServerBootstrap({
      queryLines: () => queryAdbDevicesLines(),
      startServer: () => this.runAdbCommand(['start-server']),
      state: this.adbStartServerState,
    });
    return lines
      .map((line) => parseAdbDeviceLine(line))
      .filter((device): device is ReplayDeviceEntry => device !== null);
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
      activationPhase: 'connect',
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

    this.updateDevice({
      ...device,
      status: 'loading',
      detailText: 'Connecting to Android RenderDoc server...',
      lastError: undefined,
      activationPhase: 'connect',
      activationUpdatedAt: Date.now(),
    });

    const result = await rdxShellActionService.runAction('connectRemote', {
      deviceId: device.id,
      deviceLabel: device.label,
      deviceType: device.type,
      deviceSerial: device.serial,
      transport: device.transport,
    });
    if (!result.ok) {
      throw new Error(result.error ?? 'RDX connectRemote action failed.');
    }

    const contextId =
      readActionString(result.data, ['contextId', 'context_id', 'RDX_CONTEXT_ID'])
      ?? device.id;
    const remoteId = readActionString(result.data, ['remoteId', 'remote_id', 'RDX_REMOTE_ID']);
    if (!remoteId) {
      throw new Error('RDX connectRemote action result must include remoteId/remote_id.');
    }

    const bootstrap = parseRemoteBootstrap(result.data);

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

  private async runAdbCommand(args: string[]): Promise<string[]> {
    let adbPath: string;
    try {
      adbPath = await this.adbExecutable.resolveAdbExecutableAsync();
    } catch (error) {
      this.adbExecutable.invalidate();
      throw error;
    }

    const supervised = processSupervisor.spawn('replay', adbPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const info = await supervised.join(120_000);
    const stdout = supervised.stdout.toString();
    const stderr = supervised.stderr.toString();
    if (info.reason === 'unconfirmed_orphan') {
      throw new Error('Replay device command became an unconfirmed orphan.');
    }
    if (info.reason === 'spawn_failed') {
      this.adbExecutable.invalidate();
      throw info.error ?? new Error(stderr.trim() || 'adb spawn failed');
    }
    if (info.code !== 0) {
      throw new Error(stderr.trim() || `adb exited with code ${info.code ?? -1}.`);
    }
    return stdout.split(/\r?\n/);
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

    if (devicesSemanticallyEqual(previous, devices)) {
      return devices;
    }

    const changedDevice = devices.find((device, index) => {
      const prior = previous[index];
      if (!prior) {
        return true;
      }
      return !devicesSemanticallyEqual([prior], [device]);
    });

    this.broadcast({
      device: changedDevice ?? devices[0] ?? LOCAL_DEVICE,
      devices,
    });

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
