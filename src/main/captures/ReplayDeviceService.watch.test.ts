import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdbExecutableCache } from './adbExecutable';
import * as adbServerClient from './adbServerClient';
import {
  ReplayDeviceService,
  WATCH_LEASE_TTL_MS,
  WATCH_POLL_MS,
} from './ReplayDeviceService';
import { POLL_BASE_MS } from './replayDeviceDiff';

vi.mock('../settings/SettingsService', () => ({ settingsService: { getAll: () => ({ tooling: { rdcCli: { env: {} } } }) } }));
vi.mock('../tools/RdcCliInvokerService', () => ({ rdcCliInvokerService: { loadCatalog: vi.fn(async () => ({})) } }));
vi.mock('../tools/withRdcHostRuntimeEnv', () => ({ withRdcHostRuntimeEnv: (value: unknown) => value }));

vi.mock('../sessions/StorageAdapter', () => ({
  storageAdapter: {
    getWorkspacePath: () => '/tmp/rdc-agent-test-workspace',
  },
}));

vi.mock('../browserAppBridge/rendererEventHub', () => ({
  rendererEventHub: {
    emit: vi.fn(),
  },
}));

vi.mock('../runtime/RuntimeLogService', () => ({
  runtimeLogService: {
    log: vi.fn(),
  },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: () => false,
  };
});

function refreshCallCount(): number {
  return vi.mocked(adbServerClient.queryAdbDevicesLinesWithServerBootstrap).mock.calls.length;
}

function createService(): ReplayDeviceService {
  return new ReplayDeviceService();
}

async function flushWatchRefresh(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe('ReplayDeviceService watch lease', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(AdbExecutableCache.prototype, 'resolveAdbExecutableAsync').mockResolvedValue('/bundled/adb.exe');
    vi.spyOn(adbServerClient, 'queryAdbDevicesLines').mockResolvedValue([]);
    vi.spyOn(adbServerClient, 'queryAdbDevicesLinesWithServerBootstrap').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the first scan failure even when no Android device has ever been found', async () => {
    vi.mocked(adbServerClient.queryAdbDevicesLinesWithServerBootstrap).mockRejectedValueOnce(new Error('ADB missing'));
    const service = createService();
    await service.refreshDevices();
    expect(service.getSnapshot()).toMatchObject({ discovery: { status: 'failed', error: 'ADB missing' }, devices: [{ id: 'local' }] });
    service.dispose();
  });

  it('detects a hot-plugged device and does not publish a cancelled late scan', async () => {
    const service = createService(); service.startWatch(); await flushWatchRefresh();
    vi.mocked(adbServerClient.queryAdbDevicesLinesWithServerBootstrap).mockResolvedValueOnce(['PHONE\tdevice model:Phone']);
    service.renewWatch(); await vi.advanceTimersByTimeAsync(POLL_BASE_MS);
    expect(service.getSnapshot().devices).toContainEqual(expect.objectContaining({ serial: 'PHONE', adbState: 'device' }));
    let finish!: (rows: string[]) => void;
    vi.mocked(adbServerClient.queryAdbDevicesLinesWithServerBootstrap).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const scan = service.refreshDevices(); await flushWatchRefresh(); service.stopWatch();
    const revision = service.getSnapshot().revision; finish(['LATE\tdevice']); await scan;
    expect(service.getSnapshot().revision).toBe(revision);
    expect(service.getSnapshot().devices.some((device) => device.serial === 'LATE')).toBe(false);
    service.dispose();
  });

  it('does not poll after initialize', async () => {
    const service = createService();
    await service.initialize();

    vi.advanceTimersByTime(30_000);
    expect(refreshCallCount()).toBe(0);
    service.dispose();
  });

  it('coalesces concurrent scans and resets the bootstrap attempt on reopening', async () => {
    const service = createService();
    let finish!: (rows: string[]) => void;
    vi.mocked(adbServerClient.queryAdbDevicesLinesWithServerBootstrap).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = service.refreshDevices(); const second = service.refreshDevices(); await flushWatchRefresh();
    expect(refreshCallCount()).toBe(1); finish([]); await Promise.all([first, second]);
    const internals = service as unknown as { adbStartServerState: { startServerAttempted: boolean } };
    internals.adbStartServerState.startServerAttempted = true;
    service.startWatch(); await flushWatchRefresh();
    expect(internals.adbStartServerState.startServerAttempted).toBe(false);
    service.dispose();
  });

  it('distinguishes unauthorized, authorized, unplugged and reconnected transport state', async () => {
    const service = createService();
    const rows = vi.mocked(adbServerClient.queryAdbDevicesLinesWithServerBootstrap);
    rows.mockResolvedValueOnce(['PHONE\tunauthorized']); await service.refreshDevices();
    expect(service.getSnapshot().devices[1].lastError).toContain('authorization');
    rows.mockResolvedValueOnce(['PHONE\tdevice']); await service.refreshDevices();
    expect(service.getSnapshot().devices[1]).toMatchObject({ adbState: 'device', lastError: undefined });
    rows.mockResolvedValueOnce([]); await service.refreshDevices();
    expect(service.getSnapshot().devices[1]).toMatchObject({ adbState: 'missing', status: 'offline' });
    rows.mockResolvedValueOnce(['PHONE\tdevice transport_id:2']); await service.refreshDevices();
    expect(service.getSnapshot().devices[1]).toMatchObject({ adbState: 'device', lastError: undefined });
    service.dispose();
  });

  it('startWatch refreshes immediately and polls on watch interval', async () => {
    const service = createService();
    await service.initialize();

    service.startWatch();
    await flushWatchRefresh();

    expect(refreshCallCount()).toBe(1);

    const watchPollMs = Math.max(POLL_BASE_MS, WATCH_POLL_MS);
    await vi.advanceTimersByTimeAsync(watchPollMs);
    await flushWatchRefresh();
    expect(refreshCallCount()).toBe(2);

    service.dispose();
  });

  it('stops polling when the watch lease expires without renew', async () => {
    const service = createService();
    await service.initialize();

    service.startWatch();
    await flushWatchRefresh();
    expect(refreshCallCount()).toBe(1);

    vi.advanceTimersByTime(WATCH_LEASE_TTL_MS);
    await flushWatchRefresh();
    const callsAfterExpiry = refreshCallCount();

    vi.advanceTimersByTime(WATCH_POLL_MS * 4);
    await flushWatchRefresh();
    expect(refreshCallCount()).toBe(callsAfterExpiry);

    service.dispose();
  });

  it('stopWatch stops polling immediately', async () => {
    const service = createService();
    await service.initialize();

    service.startWatch();
    await flushWatchRefresh();
    expect(refreshCallCount()).toBe(1);

    service.stopWatch();

    vi.advanceTimersByTime(Math.max(POLL_BASE_MS, WATCH_POLL_MS) * 4);
    await flushWatchRefresh();
    expect(refreshCallCount()).toBe(1);

    service.dispose();
  });

  it('refreshDevices without watch performs a single refresh', async () => {
    const service = createService();
    await service.initialize();

    await service.refreshDevices();
    expect(refreshCallCount()).toBe(1);

    vi.advanceTimersByTime(30_000);
    await flushWatchRefresh();
    expect(refreshCallCount()).toBe(1);

    service.dispose();
  });
});
