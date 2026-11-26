import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rdcSessionService } from '../rdc/RdcSessionService';
import { registerProjectSessionHandlers } from './projectSessionHandlers';
import type { RunSummary } from '@shared/types/session';

import type { WorkbenchIpcContext } from './workbenchContext';

const { handlers, syncSessionSlots, abortBackgroundSession, storage, conversation } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  syncSessionSlots: vi.fn(),
  abortBackgroundSession: vi.fn(async () => undefined),
  conversation: {
    cancelActiveTurn: vi.fn(async () => ({ success: true })),
    isTurnActive: vi.fn(() => false),
    getHistory: vi.fn(async () => ({ messages: [], planReview: null, branchState: null })),
  },
  storage: {
    projects: { referenceProjectInput: vi.fn() },
    readSession: vi.fn(),
    getProjectById: vi.fn(),
    listRuns: vi.fn((): Array<{ runId: string; status: string }> => []),
    removeSession: vi.fn(),
    removeProject: vi.fn(),
    listSessions: vi.fn((): Array<{ sessionId: string }> => []),
    setCurrentSessionId: vi.fn(),
    setCurrentProjectId: vi.fn(),
    getLatestRun: vi.fn((): RunSummary | null => null),
    updateRun: vi.fn(async () => undefined),
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
vi.mock('../sessions/store/sessionStores', () => ({
  projectWorkspaceStore: { ...storage, ...storage.projects },
  sessionRecordStore: storage,
  executionOfferStore: storage.executionOffers,
}));
vi.mock('./projectInputLifecycleHandlers', () => ({ registerProjectInputLifecycleHandlers: vi.fn() }));
vi.mock('../rdc/RdcSessionService', () => ({
  rdcSessionService: { clearOpenedCaptureForSession: vi.fn(async () => true) },
}));
vi.mock('../agent-runtime/orchestration/agentRuntimeRoot', () => ({
  agentOrchestrator: {
    syncSessionSlots,
    releaseSessionToolState: vi.fn(),
    backgroundSubagents: { abortSession: abortBackgroundSession },
  },
}));
vi.mock('../conversation/ConversationService', () => ({
  conversationService: conversation,
}));
vi.mock('../agent-trace/TraceService', () => ({
  traceService: { getSession: vi.fn(async (sessionId: string) => ({ success: true, sessionId, presentation: null })) },
}));
vi.mock('../settings/agent-manifests/effectiveAgentSnapshot', () => ({
  resolveEnabledAgentDefinition: vi.fn(() => ({ id: 'general' })),
}));
vi.mock('../rdc/sessionLifecycle', () => ({
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
vi.mock('../agent-runtime/orchestration/RunExecutionService', () => ({
  runExecutionService: {
    stopRun: vi.fn(),
    listActiveRuns: vi.fn(() => []),
  },
}));
vi.mock('../rdc/RdcCliInvokerService', () => ({
  rdcCliInvokerService: { abortRun: vi.fn() },
}));

describe('session:remove slot sync', () => {
  beforeEach(() => {
    handlers.clear();
    syncSessionSlots.mockReset();
    abortBackgroundSession.mockReset();
    abortBackgroundSession.mockResolvedValue(undefined);
    conversation.cancelActiveTurn.mockReset();
    conversation.cancelActiveTurn.mockResolvedValue({ success: true });
    conversation.isTurnActive.mockReset();
    conversation.isTurnActive.mockReturnValue(false);
    storage.readSession.mockReset();
    storage.getLatestRun.mockReset();
    storage.getLatestRun.mockReturnValue(null);
    storage.updateRun.mockReset();
    storage.updateRun.mockResolvedValue(undefined);
    storage.getProjectById.mockReset();
    storage.listRuns.mockReset();
    storage.removeSession.mockReset();
    storage.removeProject.mockReset();
    storage.listSessions.mockReset();
    storage.listRuns.mockReturnValue([]);
    storage.listSessions.mockReturnValue([]);
    storage.getProjectById.mockReturnValue({ projectId: 'proj_1', rootPath: 'D:/proj_1' });
    vi.mocked(rdcSessionService.clearOpenedCaptureForSession).mockReset().mockResolvedValue(true);
  });

  it('registers only the exact explicitly supplied reference through the validated IPC boundary', async () => {
    const inputs = [{ inputId: 'reference_exact', source: 'external_reference' }];
    storage.projects.referenceProjectInput.mockResolvedValue(inputs);
    const broadcast = vi.fn();
    registerProjectSessionHandlers({ state: {}, broadcastToRenderer: broadcast } as unknown as WorkbenchIpcContext);
    expect(await handlers.get('project:inputs:reference')!({}, 'proj_1', 'D:/source/original.rdc')).toEqual({
      success: true,
      inputs,
    });
    expect(storage.projects.referenceProjectInput).toHaveBeenCalledWith('proj_1', 'D:/source/original.rdc');
    expect(broadcast).toHaveBeenCalledWith('project:inputsChanged', { projectId: 'proj_1', inputs });
    storage.projects.referenceProjectInput.mockClear();
    expect(await handlers.get('project:inputs:reference')!({}, 'proj_1', ['D:/source/original.rdc'])).toMatchObject({
      success: false,
    });
    expect(storage.projects.referenceProjectInput).not.toHaveBeenCalled();
  });

  it('does not remove a project when background abort-and-join fails', async () => {
    storage.listSessions.mockReturnValue([{ sessionId: 'sess_1' }]);
    conversation.cancelActiveTurn.mockRejectedValueOnce(new Error('join not confirmed'));
    registerProjectSessionHandlers({
      state: { currentSessionId: null, currentProjectId: 'proj_1', currentRunId: null },
      broadcastToRenderer: vi.fn(),
      broadcastRunStatusChanged: vi.fn(),
      applyCurrentLlmConfig: vi.fn(),
      setRunLifecycleState: vi.fn(async () => undefined),
      selectCurrentProject: vi.fn(async () => ({ project: null, currentSession: null, currentRun: null })),
      initializeIpcState: vi.fn(async () => undefined),
    } as unknown as WorkbenchIpcContext);
    const result = await handlers.get('project:remove')!({}, 'proj_1');
    expect(result).toMatchObject({ success: false, error: 'join not confirmed' });
    expect(storage.removeProject).not.toHaveBeenCalled();
  });
  it('keeps the project and its visible owner when device installation remains unconfirmed after native cleanup', async () => {
    storage.listSessions.mockReturnValue([{ sessionId: 'sess_1' }]);
    vi.mocked(rdcSessionService.clearOpenedCaptureForSession).mockRejectedValueOnce(
      new Error('RDC_DEVICE_ACTION_UNCONFIRMED'),
    );
    const state = { currentSessionId: 'sess_1', currentProjectId: 'proj_1', currentRunId: 'run_1' };
    registerProjectSessionHandlers({ state, broadcastToRenderer: vi.fn() } as unknown as WorkbenchIpcContext);
    expect(await handlers.get('project:remove')!({}, 'proj_1')).toEqual({
      success: false,
      error: 'RDC_DEVICE_ACTION_UNCONFIRMED',
    });
    expect(storage.removeProject).not.toHaveBeenCalled();
    expect(storage.removeSession).not.toHaveBeenCalled();
    expect(state).toEqual({ currentSessionId: 'sess_1', currentProjectId: 'proj_1', currentRunId: 'run_1' });
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
    // {"success":false,"error":"__vite_ssr_import_0__.projectWorkspaceStore.getProjectById is not a function"}
    // because unmocked removeSessionWithHooks called projectWorkspaceStore.getProjectById,
    // which the hoisted storage stub omitted. attachmentStagingService is also
    // imported by the handler and is mocked so this test does not load AppPathService/HookEngine.
    expect(result, `session:remove payload=${JSON.stringify(result)}`).toMatchObject({ success: true });
    expect(conversation.cancelActiveTurn).toHaveBeenCalledWith({ sessionId: 'sess_1' });
    expect(storage.removeSession).toHaveBeenCalledWith('sess_1');
    expect(syncSessionSlots).toHaveBeenCalledWith('sess_1');
  });

  it('opens a session with its persisted agentId, history, trace and runs in one result', async () => {
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

    const handler = handlers.get('session:open');
    const result = await handler!({}, 'sess_1');
    expect(result).toMatchObject({
      success: true,
      session: {
        record: expect.objectContaining({ sessionId: 'sess_1', agentId: 'general' }),
        revision: { epoch: expect.any(String), n: expect.any(Number) },
      },
      runs: [],
      history: { messages: [], planReview: null },
      trace: { success: true, sessionId: 'sess_1' },
    });
    expect(conversation.getHistory).toHaveBeenCalledWith('sess_1');
  });

  it('does not interrupt an active conversation run when the session is opened', async () => {
    storage.readSession.mockReturnValue({ sessionId: 'sess_1', projectId: 'proj_1', title: 't' });
    const running = { runId: 'run_1', turnId: 'turn_1', sessionId: 'sess_1', status: 'running' };
    storage.getLatestRun.mockReturnValue(running as RunSummary);
    conversation.isTurnActive.mockReturnValue(true);
    registerProjectSessionHandlers({
      state: { currentSessionId: null, currentProjectId: 'proj_1', currentRunId: null },
      broadcastToRenderer: vi.fn(),
      broadcastRunStatusChanged: vi.fn(),
      applyCurrentLlmConfig: vi.fn(),
      setRunLifecycleState: vi.fn(async () => undefined),
      selectCurrentProject: vi.fn(async () => ({ project: null, currentSession: null, currentRun: null })),
      initializeIpcState: vi.fn(async () => undefined),
    } as unknown as WorkbenchIpcContext);

    const result = await handlers.get('session:open')!({}, 'sess_1');
    expect(result).toMatchObject({ success: true, currentRun: running });
    expect(conversation.isTurnActive).toHaveBeenCalledWith('sess_1', 'turn_1');
    expect(storage.updateRun).not.toHaveBeenCalled();
  });

  it('interrupts a stale run when neither execution owner is active', async () => {
    storage.readSession.mockReturnValue({ sessionId: 'sess_1', projectId: 'proj_1', title: 't' });
    storage.getLatestRun.mockReturnValue({
      runId: 'run_1',
      turnId: 'turn_1',
      sessionId: 'sess_1',
      status: 'running',
    } as RunSummary);
    registerProjectSessionHandlers({
      state: { currentSessionId: null, currentProjectId: 'proj_1', currentRunId: null },
      broadcastToRenderer: vi.fn(),
      broadcastRunStatusChanged: vi.fn(),
      applyCurrentLlmConfig: vi.fn(),
      setRunLifecycleState: vi.fn(async () => undefined),
      selectCurrentProject: vi.fn(async () => ({ project: null, currentSession: null, currentRun: null })),
      initializeIpcState: vi.fn(async () => undefined),
    } as unknown as WorkbenchIpcContext);

    await handlers.get('session:open')!({}, 'sess_1');
    expect(storage.updateRun).toHaveBeenCalledWith(
      'sess_1',
      'run_1',
      expect.objectContaining({
        status: 'interrupted',
        stopReason: 'Recovered after app restart',
      }),
    );
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
    storage.listRuns.mockReturnValue([{ runId: 'run_1', status: 'running' }]);
    const setRunLifecycleState = vi.fn(
      async (_sessionId: string, _runId: string, _patch: Record<string, unknown>) => undefined,
    );
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
