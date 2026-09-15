import { afterEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const mocks = vi.hoisted(() => ({
  readImage: vi.fn(),
  readLive: vi.fn(),
  readSession: vi.fn(),
  getProjectById: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler); },
  },
}));
vi.mock('../sessions', () => ({ rdxSessionService: { clearReplayHistoryForSession: vi.fn() } }));
vi.mock('../captures/replay/ReplayHistoryStore', () => ({
  replayHistoryStore: { readSelection: vi.fn(), list: vi.fn(), readImage: mocks.readImage },
}));
vi.mock('../captures/replay/ReplayLivePreviewStore', () => ({
  replayLivePreviewStore: { read: mocks.readLive },
}));
vi.mock('../sessions/StorageAdapter', () => ({
  storageAdapter: { readSession: mocks.readSession, getProjectById: mocks.getProjectById },
}));

import { registerCaptureReplayHistoryHandlers } from './captureReplayHistoryHandlers';

describe('captureReplayHistoryHandlers', () => {
  afterEach(() => {
    handlers.clear();
    vi.clearAllMocks();
  });

  it('returns PNG bytes for history and live preview', async () => {
    mocks.readSession.mockReturnValue({ projectId: 'p' });
    mocks.getProjectById.mockReturnValue({ rootPath: '/project' });
    mocks.readImage.mockResolvedValue(Buffer.from('hist'));
    mocks.readLive.mockResolvedValue(Buffer.from('live'));
    registerCaptureReplayHistoryHandlers();
    const hash = 'a'.repeat(64);
    const history = await handlers.get('capture:readReplayImage')!({}, { projectId: 'p', sessionId: 's1', captureHash: hash, imageHash: hash });
    const live = await handlers.get('capture:readLivePreview')!({}, { projectId: 'p', sessionId: 's1' });
    expect(history).toEqual(Buffer.from('hist'));
    expect(live).toEqual(Buffer.from('live'));
    expect(Buffer.isBuffer(history)).toBe(true);
    expect(String(history)).not.toContain('data:image');
  });
});
