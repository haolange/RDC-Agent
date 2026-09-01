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
    listRuns: vi.fn(() => []),
    removeSession: vi.fn(),
    listSessions: vi.fn(() => []),
    setCurrentSessionId: vi.fn(async () => undefined),
    setCurrentProjectId: vi.fn(),
    getLatestRun: vi.fn(() => null),
    handoffs: { getActive: vi.fn((): { handoffId: string; lifecycle: string; toAgentId: string } | null => null) },
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
    expect(result).toMatchObject({ success: true });
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
});
