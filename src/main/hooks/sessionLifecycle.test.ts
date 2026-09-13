import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getProjectById,
  createSession,
  readSession,
  removeSession,
  dispatchRuntimeHooks,
  closeReplay,
  clearReplayHistory,
} = vi.hoisted(() => ({
  getProjectById: vi.fn(),
  createSession: vi.fn(),
  readSession: vi.fn(),
  removeSession: vi.fn(),
  dispatchRuntimeHooks: vi.fn(async () => true),
  closeReplay: vi.fn(async () => true),
  clearReplayHistory: vi.fn(async () => undefined),
}));

vi.mock('../sessions/StorageAdapter', () => ({
  storageAdapter: {
    getProjectById,
    createSession,
    readSession,
    removeSession,
  },
}));

vi.mock('./runtimeHookDispatch', () => ({
  dispatchRuntimeHooks,
}));
vi.mock('../sessions', () => ({ rdxSessionService: { clearOpenedCaptureForSession: closeReplay } }));
vi.mock('../captures/replay/ReplayHistoryStore', () => ({ replayHistoryStore: { clearSession: clearReplayHistory } }));

import { createSessionWithHooks, removeSessionWithHooks } from './sessionLifecycle';

describe('sessionLifecycle hooks', () => {
  beforeEach(() => {
    getProjectById.mockReset().mockReturnValue({ projectId: 'proj-1', rootPath: 'D:/project' });
    createSession.mockReset().mockReturnValue({ sessionId: 'sess-1', projectId: 'proj-1' });
    readSession.mockReset().mockReturnValue({ sessionId: 'sess-1', projectId: 'proj-1' });
    removeSession.mockReset();
    closeReplay.mockReset().mockResolvedValue(true);
    clearReplayHistory.mockReset().mockResolvedValue(undefined);
    dispatchRuntimeHooks.mockReset().mockResolvedValue(true);
  });

  it('fires session.before-start before creating a session', async () => {
    await createSessionWithHooks('proj-1', 'Title');
    expect(dispatchRuntimeHooks).toHaveBeenCalledWith(
      'session.before-start',
      expect.objectContaining({ projectRoot: 'D:/project', payload: { projectId: 'proj-1', title: 'Title' } }),
    );
    expect(createSession).toHaveBeenCalledWith('proj-1', 'Title', '');
  });

  it('blocks session creation when session.before-start is denied', async () => {
    dispatchRuntimeHooks.mockResolvedValueOnce(false);
    await expect(createSessionWithHooks('proj-1')).rejects.toThrow(/HOOK_DENIED: session.before-start/);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('fires session.after-end after removing a session', async () => {
    await removeSessionWithHooks('sess-1');
    expect(removeSession).toHaveBeenCalledWith('sess-1');
    expect(closeReplay).toHaveBeenCalledBefore(clearReplayHistory);
    expect(clearReplayHistory).toHaveBeenCalledBefore(removeSession);
    expect(clearReplayHistory).toHaveBeenCalledWith('D:/project', 'sess-1');
    expect(dispatchRuntimeHooks).toHaveBeenCalledWith(
      'session.after-end',
      expect.objectContaining({
        sessionId: 'sess-1',
        projectRoot: 'D:/project',
        payload: { projectId: 'proj-1' },
      }),
    );
  });
  it('keeps the session and history when native release is unconfirmed', async () => {
    closeReplay.mockRejectedValueOnce(new Error('CLOSE_UNCONFIRMED'));
    await expect(removeSessionWithHooks('sess-1')).rejects.toThrow('CLOSE_UNCONFIRMED');
    expect(clearReplayHistory).not.toHaveBeenCalled();
    expect(removeSession).not.toHaveBeenCalled();
  });
  it('keeps the session when history cleanup fails so deletion can be retried', async () => {
    clearReplayHistory.mockRejectedValueOnce(new Error('ACCESS_DENIED'));
    await expect(removeSessionWithHooks('sess-1')).rejects.toThrow('ACCESS_DENIED');
    expect(removeSession).not.toHaveBeenCalled();
    expect(dispatchRuntimeHooks).not.toHaveBeenCalled();
  });
});
