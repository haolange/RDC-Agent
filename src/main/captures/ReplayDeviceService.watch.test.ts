import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as adbServerClient from './adbServerClient';
import {
  ReplayDeviceService,
  WATCH_LEASE_TTL_MS,
  WATCH_POLL_MS,
} from './ReplayDeviceService';
import { POLL_BASE_MS } from './replayDeviceDiff';

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
  await Promise.resolve();
  await Promise.resolve();
}

describe('ReplayDeviceService watch lease', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(adbServerClient, 'queryAdbDevicesLines').mockResolvedValue([]);
    vi.spyOn(adbServerClient, 'queryAdbDevicesLinesWithServerBootstrap').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not poll after initialize', async () => {
    const service = createService();
    await service.initialize();

    vi.advanceTimersByTime(30_000);
    expect(refreshCallCount()).toBe(0);
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
