import { BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import { toolBridge } from './ToolBridge';
import type { ReplayDeviceEntry, ReplayDeviceStatusChangedPayload } from '@shared/types/device';
import { generateShortId } from '@shared/utils/id';
import type { ToolCallResult } from '@shared/types/tool';

const POLL_INTERVAL_MS = 5000;
const ACTIVATE_TIMEOUT_MS = 25000;

const LOCAL_DEVICE: ReplayDeviceEntry = {
  id: 'local',
  label: 'Local',
  type: 'local',
  status: 'online',
  transport: 'local',
  detailText: 'Local replay ready',
};

function sanitizeDeviceId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function isToolError(result: ToolCallResult, fallback: string): string {
  return result.error?.message ?? fallback;
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

  let detailText = 'Ready to start remote server';
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
  private probeContexts = new Map<string, string>();

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
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

  private async performRefresh(): Promise<ReplayDeviceEntry[]> {
    const detectedDevices = await this.detectAdbDevices();
    const now = Date.now();
    const nextDevices = new Map<string, ReplayDeviceEntry>([[LOCAL_DEVICE.id, { ...LOCAL_DEVICE, lastSeen: now }]]);
    const detectedIds = new Set<string>(['local']);

    for (const detected of detectedDevices) {
      detectedIds.add(detected.id);
      const previous = this.devices.get(detected.id);
      if (previous && previous.status !== 'offline' && detected.lastError === undefined) {
        nextDevices.set(detected.id, {
          ...detected,
          status: previous.status,
          detailText: previous.detailText ?? detected.detailText,
          lastError: previous.lastError,
          remoteId: previous.remoteId,
          lastSeen: detected.lastSeen ?? previous.lastSeen,
        });
      } else {
        nextDevices.set(detected.id, detected);
      }
    }

    for (const [deviceId, device] of this.devices.entries()) {
      if (detectedIds.has(deviceId) || deviceId === 'local') {
        continue;
      }

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
      detailText: 'Running remote server command...',
      lastError: undefined,
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
      const failedDevice: ReplayDeviceEntry = {
        ...(this.devices.get(deviceId) ?? device),
        status: 'offline',
        detailText: message,
        lastError: message,
      };
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

    const contextId = `ctx-device-${sanitizeDeviceId(device.serial)}-${generateShortId()}`;
    this.probeContexts.set(deviceId, contextId);

    const contextResult = await toolBridge.call({
      toolName: 'rd.session.create_context',
      args: { context_id: contextId },
    });
    if (!contextResult.ok) {
      throw new Error(isToolError(contextResult, 'Failed to create a replay device context.'));
    }

    const initResult = await toolBridge.call({
      toolName: 'rd.core.init',
      args: {},
      contextId,
    });
    if (!initResult.ok) {
      throw new Error(isToolError(initResult, 'Failed to initialize remote capability.'));
    }

    const connectResult = await toolBridge.call({
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
      throw new Error(isToolError(connectResult, 'Failed to connect to the Android RenderDoc server.'));
    }

    const remoteId = typeof connectResult.data?.remote_id === 'string'
      ? connectResult.data.remote_id
      : undefined;
    if (!remoteId) {
      throw new Error('Remote connect did not return a remote_id.');
    }

    this.updateDevice({
      ...device,
      status: 'connected',
      remoteId,
      detailText: 'Remote server connected',
      lastError: undefined,
      lastSeen: Date.now(),
    });

    const pingResult = await toolBridge.call({
      toolName: 'rd.remote.ping',
      args: { remote_id: remoteId },
      contextId,
    });
    if (!pingResult.ok) {
      throw new Error(isToolError(pingResult, 'Remote server ping failed.'));
    }

    const targetsResult = await toolBridge.call({
      toolName: 'rd.remote.list_targets',
      args: { remote_id: remoteId },
      contextId,
    });
    if (!targetsResult.ok) {
      throw new Error(isToolError(targetsResult, 'Remote target discovery failed.'));
    }

    return {
      ...device,
      status: 'online',
      remoteId,
      detailText: 'Remote server ready',
      lastError: undefined,
      lastSeen: Date.now(),
    };
  }

  private async ensureDaemonReady(): Promise<void> {
    const statusResult = await toolBridge.executeCLI('daemon', ['status']);
    if (statusResult.exitCode === 0) {
      return;
    }

    const startResult = await toolBridge.executeCLI('daemon', ['start']);
    if (startResult.exitCode !== 0) {
      const stderr = startResult.stderr.trim();
      throw new Error(stderr || 'Failed to start the rdx daemon.');
    }
  }

  private async runAdbCommand(args: string[]): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const proc = spawn('adb', args, {
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
    this.devices.set(device.id, device);
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



