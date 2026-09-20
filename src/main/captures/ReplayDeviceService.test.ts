import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplayDeviceEntry } from '@shared/types/device';
import { AdbExecutableCache } from './adbExecutable';
import {
  AdbServerProtocolError,
  AdbServerUnreachableError,
  queryAdbDevicesLinesWithServerBootstrap,
} from './adbServerClient';
import {
  deviceIdentityKey,
  devicesSemanticallyEqual,
  nextPollIntervalMs,
  POLL_BASE_MS,
  POLL_MAX_MS,
} from './replayDeviceDiff';

function makeDevice(overrides: Partial<ReplayDeviceEntry> = {}): ReplayDeviceEntry {
  return {
    id: 'android-pixel',
    label: 'Pixel',
    type: 'android',
    status: 'offline',
    transport: 'adb_android',
    serial: 'SERIAL1',
    detailText: 'Ready to connect to Android RenderDoc server',
    lastSeen: 1_000,
    ...overrides,
  };
}

describe('replayDeviceDiff', () => {
  it('treats lastSeen-only changes as unchanged', () => {
    const previous = makeDevice({ lastSeen: 1_000 });
    const next = makeDevice({ lastSeen: 9_999 });
    expect(deviceIdentityKey(previous)).toBe(deviceIdentityKey(next));
    expect(devicesSemanticallyEqual([previous], [next])).toBe(true);
  });

  it('treats status / detail changes as changed', () => {
    const previous = makeDevice({ status: 'offline', detailText: 'Ready' });
    const next = makeDevice({ status: 'online', detailText: 'Connected', lastSeen: previous.lastSeen });
    expect(devicesSemanticallyEqual([previous], [next])).toBe(false);
  });

  it('grows poll interval on failure and resets to BASE on success', () => {
    let interval = POLL_BASE_MS;
    interval = nextPollIntervalMs(interval, false);
    expect(interval).toBe(10_000);
    interval = nextPollIntervalMs(interval, false);
    expect(interval).toBe(20_000);
    interval = nextPollIntervalMs(interval, false);
    expect(interval).toBe(40_000);
    interval = nextPollIntervalMs(interval, false);
    expect(interval).toBe(60_000);
    interval = nextPollIntervalMs(interval, false);
    expect(interval).toBe(POLL_MAX_MS);
    interval = nextPollIntervalMs(interval, true);
    expect(interval).toBe(POLL_BASE_MS);
  });
});

describe('AdbExecutableCache', () => {
  const previousAdbPath = process.env.RDC_ANDROID_ADB_PATH;
  const previousPath = process.env.PATH;
  const previousAndroidHome = process.env.ANDROID_HOME;
  const previousAndroidSdkRoot = process.env.ANDROID_SDK_ROOT;
  const previousAdb = process.env.ADB;
  const previousLocalAppData = process.env.LOCALAPPDATA;

  beforeEach(() => {
    delete process.env.RDC_ANDROID_ADB_PATH;
    delete process.env.ADB;
    delete process.env.ANDROID_HOME;
    delete process.env.ANDROID_SDK_ROOT;
    delete process.env.LOCALAPPDATA;
    process.env.PATH = '';
  });

  afterEach(() => {
    if (previousAdbPath === undefined) delete process.env.RDC_ANDROID_ADB_PATH;
    else process.env.RDC_ANDROID_ADB_PATH = previousAdbPath;
    if (previousAdb === undefined) delete process.env.ADB;
    else process.env.ADB = previousAdb;
    if (previousAndroidHome === undefined) delete process.env.ANDROID_HOME;
    else process.env.ANDROID_HOME = previousAndroidHome;
    if (previousAndroidSdkRoot === undefined) delete process.env.ANDROID_SDK_ROOT;
    else process.env.ANDROID_SDK_ROOT = previousAndroidSdkRoot;
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    vi.restoreAllMocks();
  });

  it('caches the resolved path and invalidates after access failure', async () => {
    const fakeAdb = path.join(path.sep === '\\' ? 'C:\\tools' : '/tools', 'adb.exe');
    process.env.RDC_ANDROID_ADB_PATH = fakeAdb;

    const accessSpy = vi.spyOn(fs.promises, 'access')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce(undefined);

    const cache = new AdbExecutableCache();
    const first = await cache.resolveAdbExecutableAsync();
    expect(first).toBe(path.resolve(fakeAdb));
    expect(cache.getCachedPath()).toBe(path.resolve(fakeAdb));

    // Cached path fails access → invalidate and re-resolve
    const second = await cache.resolveAdbExecutableAsync();
    expect(second).toBe(path.resolve(fakeAdb));
    expect(accessSpy).toHaveBeenCalledTimes(3);

    cache.invalidate();
    expect(cache.getCachedPath()).toBeNull();
  });

  it('throws when no candidate is accessible', async () => {
    vi.spyOn(fs.promises, 'access').mockRejectedValue(new Error('ENOENT'));
    const cache = new AdbExecutableCache();
    await expect(cache.resolveAdbExecutableAsync()).rejects.toThrow(/adb executable not found/i);
    expect(cache.getCachedPath()).toBeNull();
  });
});

describe('ReplayDeviceService detectAdbDevices policy', () => {
  it('uses TCP success without spawning start-server', async () => {
    const startServer = vi.fn(async () => undefined);
    const state = { startServerAttempted: false };
    const lines = await queryAdbDevicesLinesWithServerBootstrap({
      queryLines: async () => ['SERIAL1\tdevice'],
      startServer,
      state,
    });
    expect(lines).toEqual(['SERIAL1\tdevice']);
    expect(startServer).not.toHaveBeenCalled();
    expect(state.startServerAttempted).toBe(false);
  });

  it('spawns start-server once then retries on first unreachable', async () => {
    const startServer = vi.fn(async () => undefined);
    const queryLines = vi.fn()
      .mockRejectedValueOnce(new AdbServerUnreachableError('down'))
      .mockResolvedValueOnce(['SERIAL1\tdevice']);
    const state = { startServerAttempted: false };

    const lines = await queryAdbDevicesLinesWithServerBootstrap({
      queryLines,
      startServer,
      state,
    });

    expect(lines).toEqual(['SERIAL1\tdevice']);
    expect(startServer).toHaveBeenCalledTimes(1);
    expect(queryLines).toHaveBeenCalledTimes(2);
    expect(state.startServerAttempted).toBe(true);
  });

  it('skips start-server when already attempted (poll backoff path)', async () => {
    const startServer = vi.fn(async () => undefined);
    const error = new AdbServerUnreachableError('still down');
    await expect(queryAdbDevicesLinesWithServerBootstrap({
      queryLines: async () => {
        throw error;
      },
      startServer,
      state: { startServerAttempted: true },
    })).rejects.toBe(error);
    expect(startServer).not.toHaveBeenCalled();
  });

  it('manual refresh reset re-enables one start-server attempt', async () => {
    const startServer = vi.fn(async () => undefined);
    // Mirrors refreshDevices(): startServerAttempted = false before detect.
    const state = { startServerAttempted: true };
    state.startServerAttempted = false;

    const queryLines = vi.fn()
      .mockRejectedValueOnce(new AdbServerUnreachableError('down again'))
      .mockResolvedValueOnce(['SERIAL9\tdevice']);

    const lines = await queryAdbDevicesLinesWithServerBootstrap({
      queryLines,
      startServer,
      state,
    });

    expect(lines).toEqual(['SERIAL9\tdevice']);
    expect(startServer).toHaveBeenCalledTimes(1);
    expect(state.startServerAttempted).toBe(true);
  });

  it('does not start-server for protocol failures', async () => {
    const startServer = vi.fn(async () => undefined);
    const error = new AdbServerProtocolError('bad frame');
    await expect(queryAdbDevicesLinesWithServerBootstrap({
      queryLines: async () => {
        throw error;
      },
      startServer,
      state: { startServerAttempted: false },
    })).rejects.toBe(error);
    expect(startServer).not.toHaveBeenCalled();
  });
});
