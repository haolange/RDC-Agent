import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getProjectById,
  createSession,
  readSession,
  removeSession,
  dispatchRuntimeHooks,
} = vi.hoisted(() => ({
  getProjectById: vi.fn(),
  createSession: vi.fn(),
  readSession: vi.fn(),
  removeSession: vi.fn(),
  dispatchRuntimeHooks: vi.fn(async () => true),
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

import { createSessionWithHooks, removeSessionWithHooks } from './sessionLifecycle';

describe('sessionLifecycle hooks', () => {
  beforeEach(() => {
    getProjectById.mockReset().mockReturnValue({ projectId: 'proj-1', rootPath: 'D:/project' });
    createSession.mockReset().mockReturnValue({ sessionId: 'sess-1', projectId: 'proj-1' });
    readSession.mockReset().mockReturnValue({ sessionId: 'sess-1', projectId: 'proj-1' });
    removeSession.mockReset();
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
    expect(dispatchRuntimeHooks).toHaveBeenCalledWith(
      'session.after-end',
      expect.objectContaining({
        sessionId: 'sess-1',
        projectRoot: 'D:/project',
        payload: { projectId: 'proj-1' },
      }),
    );
  });
});
