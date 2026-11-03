import { BrowserWindow } from 'electron';
import { rdcCliInvokerService } from '../RdcCliInvokerService';
import { settingsService } from '../../settings/settings-core/SettingsService';
import { withRdcHostRuntimeEnv } from '../withRdcHostRuntimeEnv';
import { rendererEventHub } from '../../browserAppBridge/rendererEventHub';
import { processSupervisor } from '../../runtime/ProcessSupervisor';
import type { ReplayDeviceEntry, ReplayDeviceSnapshot } from '@shared/types/device';
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
import { parseAdbDeviceLine } from './replayDeviceParse';

export const WATCH_POLL_MS = 2500;
export const WATCH_LEASE_TTL_MS = 10_000;

const LOCAL_DEVICE: ReplayDeviceEntry = {
  id: 'local',
  label: 'Local',
  type: 'local',
  status: 'online',
  transport: 'local',
};

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
  private readonly listeners = new Set<(snapshot: ReplayDeviceSnapshot) => void>();
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
  }
  subscribe(listener: (snapshot: ReplayDeviceSnapshot) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
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
      detectedDevices = this.getSortedDevices()
        .filter((device) => device.id !== 'local')
        .map((device) => ({
          ...device,
          status: 'offline' as const,
          adbState: 'unknown' as const,
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
      detectedIds.add(detected.id);
      const previous = this.devices.get(detected.id);
      nextDevices.set(detected.id, previous && devicesSemanticallyEqual([previous], [{ ...detected, lastSeen: previous.lastSeen }])
        ? { ...detected, lastSeen: previous.lastSeen } : detected);
    }

    for (const [deviceId, device] of this.devices.entries()) {
      if (detectedIds.has(deviceId) || deviceId === 'local') {
        continue;
      }


      nextDevices.set(deviceId, {
        ...device,
        status: 'offline',
        adbState: 'missing',
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
    for (const listener of this.listeners) listener(payload);
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
