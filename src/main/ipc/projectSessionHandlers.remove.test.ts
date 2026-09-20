import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handlers, syncSessionSlots, abortBackgroundSession, storage, conversation } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  syncSessionSlots: vi.fn(),
  abortBackgroundSession: vi.fn(async () => undefined),
  conversation: {
    cancelActiveTurn: vi.fn(async () => ({ success: true })),
  },
  storage: {
    readSession: vi.fn(),
    getProjectById: vi.fn(),
    listRuns: vi.fn((): Array<{ runId: string; status: string }> => []),
    removeSession: vi.fn(),
    removeProject: vi.fn(),
    listSessions: vi.fn((): Array<{ sessionId: string }> => []),
    setCurrentSessionId: vi.fn(async () => undefined),
    setCurrentProjectId: vi.fn(),
    getLatestRun: vi.fn(() => null),
    executionOffers: { read: vi.fn(() => null), write: vi.fn(), clear: vi.fn(), discardRemovedHandoffState: vi.fn() },
  },
}));

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd() },
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
vi.mock('./projectInputLifecycleHandlers', () => ({ registerProjectInputLifecycleHandlers: vi.fn() }));
vi.mock('../sessions', () => ({ rdcSessionService: { clearOpenedCaptureForSession: vi.fn(async () => true) } }));

vi.mock('../workflow/debugger/AgentOrchestrator', () => ({
  agentOrchestrator: { syncSessionSlots, releaseSessionToolState: vi.fn(), backgroundSubagents: { abortSession: abortBackgroundSession } },
}));

vi.mock('../conversation/ConversationService', () => ({
  conversationService: conversation,
}));

vi.mock('../conversation/ConversationRoutePreflight', () => ({
  resolveEnabledAgentDefinition: vi.fn(() => ({ id: 'general' })),
}));

vi.mock('../hooks/sessionLifecycle', () => ({
  createSessionWithHooks: vi.fn(),
  removeSessionWithHooks: vi.fn(async (sessionId: string) => {
    storage.removeSession(sessionId);
  }),
}));

vi.mock('../conversation/AttachmentStagingService', () => ({
  attachmentStagingService: {
    releaseBySessionId: vi.fn(),
  },
}));

vi.mock('../workflow/debugger/RunExecutionService', () => ({
  runExecutionService: {
    stopRun: vi.fn(),
    listActiveRuns: vi.fn(() => []),
  },
}));

vi.mock('../tools/RdcCliInvokerService', () => ({
  rdcCliInvokerService: { abortRun: vi.fn() },
}));

import { registerProjectSessionHandlers } from './projectSessionHandlers';
import type { WorkbenchIpcContext } from './workbenchContext';

describe('session:remove slot sync', () => {
  beforeEach(() => {
    handlers.clear();
    syncSessionSlots.mockReset();
    abortBackgroundSession.mockReset();
    abortBackgroundSession.mockResolvedValue(undefined);
    conversation.cancelActiveTurn.mockReset();
    conversation.cancelActiveTurn.mockResolvedValue({ success: true });
    storage.readSession.mockReset();
    storage.getProjectById.mockReset();
    storage.listRuns.mockReset();
    storage.removeSession.mockReset();
    storage.removeProject.mockReset();
    storage.listSessions.mockReset();
    storage.listRuns.mockReturnValue([]);
    storage.listSessions.mockReturnValue([]);
    storage.getProjectById.mockReturnValue({ projectId: 'proj_1', rootPath: 'D:/proj_1' });
  });

  it('does not remove a project when background abort-and-join fails', async () => {
    storage.listSessions.mockReturnValue([{ sessionId: 'sess_1' }]);
    conversation.cancelActiveTurn.mockRejectedValueOnce(new Error('join not confirmed'));
    registerProjectSessionHandlers({
      state: { currentSessionId: null, currentProjectId: 'proj_1', currentRunId: null },
      broadcastToRenderer: vi.fn(), broadcastRunStatusChanged: vi.fn(), applyCurrentLlmConfig: vi.fn(),
      setRunLifecycleState: vi.fn(async () => undefined),
      selectCurrentProject: vi.fn(async () => ({ project: null, currentSession: null, currentRun: null })),
      initializeIpcState: vi.fn(async () => undefined),
    } as unknown as WorkbenchIpcContext);
    const result = await handlers.get('project:remove')!({}, 'proj_1');
    expect(result).toMatchObject({ success: false, error: 'join not confirmed' });
    expect(storage.removeProject).not.toHaveBeenCalled();
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
    // Diagnosed 2026-09-03: ipcId allows underscore (`sess_1` matches
    // /^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/). The real payload was
    // {"success":false,"error":"__vite_ssr_import_0__.storageAdapter.getProjectById is not a function"}
    // because unmocked removeSessionWithHooks called storageAdapter.getProjectById,
    // which the hoisted storage stub omitted. attachmentStagingService is also
    // imported by the handler and is mocked so this test does not load AppPathService/HookEngine.
    expect(result, `session:remove payload=${JSON.stringify(result)}`).toMatchObject({ success: true });
    expect(conversation.cancelActiveTurn).toHaveBeenCalledWith({ sessionId: 'sess_1' });
    expect(storage.removeSession).toHaveBeenCalledWith('sess_1');
    expect(syncSessionSlots).toHaveBeenCalledWith('sess_1');
  });

  it('returns the persisted session agentId on session:select', async () => {
    storage.readSession.mockReturnValue({
      sessionId: 'sess_1',
      projectId: 'proj_1',
      title: 't',
      goal: '',
      sessionPath: 'D:/sess_1',
      createdAt: 1,
      updatedAt: 1,
      agentId: 'general',
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

    const handler = handlers.get('session:select');
    const result = await handler!({}, 'sess_1');
    expect(result).toMatchObject({
      success: true,
      session: expect.objectContaining({ sessionId: 'sess_1', agentId: 'general' }),
    });
  });

  it('cancels an active run without writing lastStage', async () => {
    storage.readSession.mockReturnValue({
      sessionId: 'sess_1',
      projectId: 'proj_1',
      title: 't',
      goal: '',
      sessionPath: 'D:/sess_1',
      createdAt: 1,
      updatedAt: 1,
    });
    storage.listRuns.mockReturnValue([
      { runId: 'run_1', status: 'running' },
    ]);
    const setRunLifecycleState = vi.fn(async (
      _sessionId: string,
      _runId: string,
      _patch: Record<string, unknown>,
    ) => undefined);
    registerProjectSessionHandlers({
      state: { currentSessionId: 'sess_1', currentProjectId: 'proj_1', currentRunId: 'run_1' },
      broadcastToRenderer: vi.fn(),
      broadcastRunStatusChanged: vi.fn(),
      applyCurrentLlmConfig: vi.fn(),
      setRunLifecycleState,
      selectCurrentProject: vi.fn(async () => ({ project: null, currentSession: null, currentRun: null })),
      initializeIpcState: vi.fn(async () => undefined),
    } as unknown as WorkbenchIpcContext);

    const handler = handlers.get('session:remove');
    const result = await handler!({}, 'sess_1');
    expect(result).toMatchObject({ success: true });
    expect(setRunLifecycleState).toHaveBeenCalledWith('sess_1', 'run_1', {
      status: 'cancelled',
      stopReason: 'Session removed',
      stoppedAt: expect.any(Number),
      finishedAt: expect.any(Number),
    });
    const patch = setRunLifecycleState.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('lastStage');
    expect(JSON.stringify(patch)).not.toContain('lastStage');
  });
});
