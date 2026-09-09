import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handlers, syncSessionSlots, storage, conversation } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  syncSessionSlots: vi.fn(),
  conversation: {
    cancelUnfinishedHandoff: vi.fn(),
    cancelActiveTurn: vi.fn(async () => ({ success: true })),
  },
  storage: {
    readSession: vi.fn(),
    getProjectById: vi.fn(),
    listRuns: vi.fn((): Array<{ runId: string; status: string }> => []),
    removeSession: vi.fn(),
    listSessions: vi.fn(() => []),
    setCurrentSessionId: vi.fn(async () => undefined),
    setCurrentProjectId: vi.fn(),
    getLatestRun: vi.fn(() => null),
    handoffs: { readDocument: vi.fn(() => null), getActive: vi.fn((): { handoffId: string; lifecycle: string; toAgentId: string } | null => null) },
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

vi.mock('../workflow/debugger/AgentOrchestrator', () => ({
  agentOrchestrator: { syncSessionSlots },
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
    storage.getProjectById.mockReset();
    storage.listRuns.mockReset();
    storage.removeSession.mockReset();
    storage.listSessions.mockReset();
    storage.listRuns.mockReturnValue([]);
    storage.listSessions.mockReturnValue([]);
    storage.getProjectById.mockReturnValue({ projectId: 'proj_1', rootPath: 'D:/proj_1' });
    storage.handoffs.getActive.mockReset();
    storage.handoffs.getActive.mockReturnValue(null);
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
    expect(conversation.cancelUnfinishedHandoff).toHaveBeenCalledWith('sess_1', 'session_close');
    expect(conversation.cancelActiveTurn).toHaveBeenCalledWith({ sessionId: 'sess_1' });
    expect(storage.removeSession).toHaveBeenCalledWith('sess_1');
    expect(syncSessionSlots).toHaveBeenCalledWith('sess_1');
  });

  it('projects toAgentId on session:select while a committed handoff is unconsumed', async () => {
    storage.readSession.mockReturnValue({
      sessionId: 'sess_1',
      projectId: 'proj_1',
      title: 't',
      goal: '',
      sessionPath: 'D:/sess_1',
      createdAt: 1,
      updatedAt: 1,
      agentId: 'plan',
    });
    storage.handoffs.getActive.mockReturnValue({
      handoffId: 'handoff-1',
      lifecycle: 'committed',
      toAgentId: 'edit',
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
      session: expect.objectContaining({ sessionId: 'sess_1', agentId: 'edit' }),
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
