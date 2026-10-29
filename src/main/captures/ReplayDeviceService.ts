import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { rdcCliInvokerService } from '../tools/RdcCliInvokerService';
import { parseRdcNativeResult, RdcNativeFailure } from '../tools/RdcNativeProtocol';
import type { RdcCliInvokerSettings } from '@shared/types/settings';
type RemoteActivationOptions = { contextId?: string; signal?: AbortSignal; cli?: RdcCliInvokerSettings };
import { settingsService } from '../settings/SettingsService';
import { withRdcHostRuntimeEnv } from '../tools/withRdcHostRuntimeEnv';
import { storageAdapter } from '../sessions/StorageAdapter';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { rendererEventHub } from '../browserAppBridge/rendererEventHub';
import { processSupervisor } from '../runtime/ProcessSupervisor';
import type {
  AndroidBootstrapMetadata,
  ReplayDeviceEntry,
  ReplayDeviceSnapshot,
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
import {
  applyActivationFailure,
  buildRemoteReadyText,
  parseAdbDeviceLine,
  parseRemoteBootstrap,
  parseResumeCacheRecord,
  readActionString,
  type DeviceResumeCachePayload,
  type DeviceResumeCacheRecord,
} from './replayDeviceParse';

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

export interface PreparedRemoteSurface {
  deviceId: string;
  serial: string;
  contextId: string;
  remoteId: string;
  validatedAt: number;
  bootstrap?: AndroidBootstrapMetadata;
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
  private revision = 0;
  private generation = 0;
  private discovery: ReplayDeviceSnapshot['discovery'] = { status: 'idle' };
  private refreshController: AbortController | null = null;
  private validatedDiscoveryCli = '';
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

    this.adbStartServerState.startServerAttempted = false;
    this.pollIntervalMs = POLL_BASE_MS;
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
    this.generation += 1;
    this.refreshController?.abort();
    this.refreshController = null;
    this.refreshPromise = null;
    if (this.discovery.status === 'scanning') this.setDiscovery({ status: 'idle' });
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

  getSnapshot(): ReplayDeviceSnapshot {
    return { revision: this.revision, devices: this.getSortedDevices(), discovery: { ...this.discovery } };
  }

  private setDiscovery(value: ReplayDeviceSnapshot['discovery']): void {
    if (JSON.stringify(value) === JSON.stringify(this.discovery)) return;
    this.discovery = value;
    this.broadcast();
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
    if (!this.refreshPromise) {
      this.adbExecutable.invalidate();
      this.validatedDiscoveryCli = '';
    }
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

    const controller = new AbortController();
    this.refreshController = controller;
    const generation = this.generation;
    this.setDiscovery({ status: 'scanning' });
    const pending = this.performRefresh(controller.signal, generation);
    this.refreshPromise = pending;
    try {
      return await pending;
    } finally {
      if (this.refreshPromise === pending) this.refreshPromise = null;
      if (this.refreshController === controller) this.refreshController = null;
    }
  }

  async activateDevice(deviceId: string, options: RemoteActivationOptions = {}): Promise<ReplayDeviceEntry> {
    options.signal?.throwIfAborted();
    const existingPromise = this.activationPromises.get(deviceId);
    if (existingPromise) {
      if (options.contextId) throw new Error('RDC_REMOTE_BUSY: cannot join an activation outside the frozen turn binding.');
      return existingPromise;
    }

    const activationPromise = this.performActivation(deviceId, options)
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

  consumePreparedRemote(deviceId: string, contextId: string): PreparedRemoteSurface | null {
    const prepared = this.resolvePreparedRemote(deviceId);
    if (!prepared || prepared.contextId !== contextId) {
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

  private async performRefresh(signal: AbortSignal, generation: number): Promise<ReplayDeviceEntry[]> {
    let adbAvailable = true;
    let detectedDevices: ReplayDeviceEntry[] = [];
    let discoveryError: string | undefined;

    try {
      detectedDevices = await this.detectAdbDevices(signal);
      signal.throwIfAborted();
    } catch (error) {
      if (signal.aborted || generation !== this.generation) return this.listDevices();
      adbAvailable = false;
      const message = error instanceof Error ? error.message : String(error);
      discoveryError = message;
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

    if (signal.aborted || generation !== this.generation) return this.listDevices();
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
        adbState: 'missing',
        remoteId: undefined,
        activationPhase: 'idle',
        detailText: 'ADB device not detected.',
        lastError: 'ADB device not detected.',
      });
    }

    const devices = this.replaceDevices(nextDevices);
    this.setDiscovery(discoveryError ? { status: 'failed', error: discoveryError } : { status: 'ready' });
    return devices;
  }

  private async detectAdbDevices(signal: AbortSignal): Promise<ReplayDeviceEntry[]> {
    const cli = withRdcHostRuntimeEnv(settingsService.getAll().tooling.rdcCli);
    const key = JSON.stringify(cli);
    if (this.validatedDiscoveryCli !== key) {
      await rdcCliInvokerService.loadCatalog(cli);
      signal.throwIfAborted();
      this.validatedDiscoveryCli = key;
    }
    signal.throwIfAborted();
    const adb = await this.adbExecutable.resolveAdbExecutableAsync(cli);
    signal.throwIfAborted();
    const lines = await queryAdbDevicesLinesWithServerBootstrap({
      queryLines: () => queryAdbDevicesLines({ signal }),
      startServer: () => this.runAdbCommand(adb, ['start-server'], signal),
      state: this.adbStartServerState,
    });
    return lines
      .map((line) => parseAdbDeviceLine(line))
      .filter((device): device is ReplayDeviceEntry => device !== null);
  }

  private async performActivation(deviceId: string, options: RemoteActivationOptions): Promise<ReplayDeviceEntry> {
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

    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new Error('Timed out while starting the remote server.')), ACTIVATE_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;

    try {
      const activated = await this.activateRemoteDevice(deviceId, { ...options, signal });
      signal.throwIfAborted();
      this.updateDevice(activated);
      return activated;
    } catch (error) {
      this.preparedRemotes.delete(deviceId);
      const message = error instanceof Error ? error.message : String(error);
      const currentDevice = this.devices.get(deviceId) ?? device;
      const failedDevice = applyActivationFailure(
        currentDevice,
        currentDevice.activationPhase ?? 'connect',
        message,
        error instanceof RdcNativeFailure ? error.nativeError.code : currentDevice.activationErrorCode,
      );
      this.updateDevice(failedDevice);
      return failedDevice;
    } finally {
      clearTimeout(timer);
    }
  }

  private async activateRemoteDevice(deviceId: string, options: RemoteActivationOptions): Promise<ReplayDeviceEntry> {
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

    if (!options.contextId || !options.cli) throw new Error('RDC_REMOTE_CONTEXT_REQUIRED: remote activation requires an owning context and frozen CLI.');
    options.signal?.throwIfAborted();
    const result = parseRdcNativeResult(await rdcCliInvokerService.executeCLI('call', [
      'rd.remote.connect', '--args-json', JSON.stringify({ options: { transport: 'adb_android', device_serial: device.serial } }),
      '--daemon-context', options.contextId,
    ], { contextId: options.contextId, abortSignal: options.signal, settings: options.cli }), options.contextId, 'rd.remote.connect');
    options.signal?.throwIfAborted();
    const contextId = options.contextId;
    const remoteId = readActionString(result.data, ['remote_id']);
    if (!remoteId) {
      throw new Error('RDC remote connect result must include remote_id.');
    }

    const bootstrap = parseRemoteBootstrap(result.data);

    const validatedAt = Date.now();
    await this.persistResumeCache({
      ...device,
      bootstrap,
    }, validatedAt);
    options.signal?.throwIfAborted();
    this.preparedRemotes.set(deviceId, {
      deviceId,
      serial: device.serial,
      contextId,
      remoteId,
      validatedAt,
      bootstrap,
    });

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

  private async runAdbCommand(adbPath: string, args: string[], signal: AbortSignal): Promise<string[]> {
    signal.throwIfAborted();
    const supervised = processSupervisor.spawn('replay', adbPath, args, {
      windowsHide: true,
      abortSignal: signal,
      timeoutMs: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const info = await supervised.join(10_000);
    signal.throwIfAborted();
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
    this.broadcast();
  }

  private replaceDevices(nextDevices: Map<string, ReplayDeviceEntry>): ReplayDeviceEntry[] {
    const previous = this.getSortedDevices();
    this.devices = nextDevices;
    const devices = this.getSortedDevices();

    if (devicesSemanticallyEqual(previous, devices)) {
      return devices;
    }

    this.broadcast();

    return devices;
  }

  private broadcast(): void {
    this.revision += 1;
    const payload = this.getSnapshot();
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
