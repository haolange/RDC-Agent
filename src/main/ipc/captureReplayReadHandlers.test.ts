import { afterEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const mocks = vi.hoisted(() => ({
  readSelection: vi.fn(),
  readLive: vi.fn(),
  readSession: vi.fn(),
  getProjectById: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler); },
  },
}));
vi.mock('../captures/replay/ReplayHistoryStore', () => ({
  replayHistoryStore: { readSelection: mocks.readSelection },
}));
vi.mock('../captures/replay/ReplayLivePreviewStore', () => ({
  replayLivePreviewStore: { read: mocks.readLive },
}));
vi.mock('../sessions/StorageAdapter', () => ({
  storageAdapter: { readSession: mocks.readSession, getProjectById: mocks.getProjectById },
}));

import { registerCaptureReplayReadHandlers } from './captureReplayReadHandlers';

describe('captureReplayReadHandlers', () => {
  afterEach(() => {
    handlers.clear();
    vi.clearAllMocks();
  });

  it('returns owner-scoped selection and current PNG bytes', async () => {
    mocks.readSession.mockReturnValue({ projectId: 'p' });
    mocks.getProjectById.mockReturnValue({ rootPath: '/project' });
    mocks.readSelection.mockReturnValue({ inputId: 'input' });
    mocks.readLive.mockResolvedValue(Buffer.from('live'));
    registerCaptureReplayReadHandlers();
    const selection = await handlers.get('capture:getReplaySelection')!({}, { projectId: 'p', sessionId: 's1' });
    const live = await handlers.get('capture:readLivePreview')!({}, { projectId: 'p', sessionId: 's1' });
    expect(selection).toEqual({ inputId: 'input' });
    expect(live).toEqual(Buffer.from('live'));
    expect(Buffer.isBuffer(live)).toBe(true);
    expect(mocks.readLive).toHaveBeenCalledExactlyOnceWith('s1');
  });
  it('rejects mismatched sessions before reading pixels or remembered selection', async () => {
    mocks.readSession.mockReturnValue({ projectId: 'other' });
    mocks.getProjectById.mockReturnValue({ rootPath: '/project' });
    registerCaptureReplayReadHandlers();
    await expect(handlers.get('capture:readLivePreview')!({}, { projectId: 'p', sessionId: 's1' })).rejects.toThrow('REPLAY_SCOPE_DENIED');
    expect(() => handlers.get('capture:getReplaySelection')!({}, { projectId: 'p', sessionId: 's1' })).toThrow('REPLAY_SCOPE_DENIED');
    expect(mocks.readLive).not.toHaveBeenCalled();
    expect(mocks.readSelection).not.toHaveBeenCalled();
  });
});
