import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handlers, syncSessionSlots, storage } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  syncSessionSlots: vi.fn(),
  storage: {
    readSession: vi.fn(),
    listRuns: vi.fn(() => []),
    removeSession: vi.fn(),
    listSessions: vi.fn(() => []),
    setCurrentSessionId: vi.fn(async () => undefined),
    setCurrentProjectId: vi.fn(),
    getLatestRun: vi.fn(() => null),
  },
}));

vi.mock('electron', () => ({
  dialog: {},
  ipcMain: {
    handle: (channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    },
  },
}));

vi.mock('../sessions/StorageAdapter', () => ({
  storageAdapter: storage,
}));

vi.mock('../workflow/debugger/AgentOrchestrator', () => ({
  agentOrchestrator: { syncSessionSlots },
}));

vi.mock('../workflow/debugger/RunExecutionService', () => ({
  runExecutionService: {
    stopRun: vi.fn(),
    listActiveRuns: vi.fn(() => []),
  },
}));

vi.mock('../tools/RdxCliInvokerService', () => ({
  rdxCliInvokerService: { abortRun: vi.fn() },
}));

import { registerProjectSessionHandlers } from './projectSessionHandlers';
import type { WorkbenchIpcContext } from './workbenchContext';

describe('session:remove slot sync', () => {
  beforeEach(() => {
    handlers.clear();
    syncSessionSlots.mockReset();
    storage.readSession.mockReset();
    storage.listRuns.mockReset();
    storage.removeSession.mockReset();
    storage.listSessions.mockReset();
    storage.listRuns.mockReturnValue([]);
    storage.listSessions.mockReturnValue([]);
  });

  it('calls syncSessionSlots when removing a session', async () => {
    storage.readSession.mockReturnValue({
      sessionId: 'sess_1',
      projectId: 'proj_1',
      title: 't',
      goal: '',
      sessionPath: 'D:/sess_1',
      createdAt: 1,
      updatedAt: 1,
    });
    registerProjectSessionHandlers({
      state: { currentSessionId: null, currentProjectId: 'proj_1', currentRunId: null },
      broadcastToRenderer: vi.fn(),
      broadcastRunStatusChanged: vi.fn(),
      applyCurrentLlmConfig: vi.fn(),
      setRunLifecycleState: vi.fn(async () => undefined),
      selectCurrentProject: vi.fn(async () => ({ project: null, currentSession: null, currentRun: null })),
      initializeIpcState: vi.fn(async () => undefined),
    } as unknown as WorkbenchIpcContext);

    const handler = handlers.get('session:remove');
    expect(handler).toBeTypeOf('function');
    const result = await handler!({}, 'sess_1');
    expect(result).toMatchObject({ success: true });
    expect(storage.removeSession).toHaveBeenCalledWith('sess_1');
    expect(syncSessionSlots).toHaveBeenCalledWith('sess_1');
  });
});
