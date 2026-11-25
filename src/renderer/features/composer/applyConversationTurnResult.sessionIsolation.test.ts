import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConversationStore } from '../../stores/conversationStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionRecordStore } from '../../stores/sessionRecordStore';
import { useSessionProjectionStore } from '../../stores/sessionProjectionStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { applyConversationTurnResult } from '../../stores/conversationSendHelpers';
import type { ConversationTurnResult } from '@shared/types/conversation';

const baseTurn = (): ConversationTurnResult => ({
  requestId: 'req-stop',
  mode: 'talk',
  executionTransition: {
    kind: 'continue',
  },
  preparedContext: {} as ConversationTurnResult['preparedContext'],
  userMessage: {
    id: 'user-1',
    requestId: 'req-stop',
    turnId: 'turn-real',
    sessionId: 'session-a',
    projectId: 'project-1',
    role: 'user',
    content: 'hi',
    status: 'complete',
    createdAt: 1,
    updatedAt: 1,
  },
  assistantDraftMessage: {
    id: 'assistant-1',
    requestId: 'req-stop',
    turnId: 'turn-real',
    sessionId: 'session-a',
    projectId: 'project-1',
    role: 'assistant',
    content: 'streaming again',
    status: 'streaming',
    createdAt: 2,
    updatedAt: 2,
  },
  messages: [
    {
      id: 'user-1',
      requestId: 'req-stop',
      turnId: 'turn-real',
      sessionId: 'session-a',
      projectId: 'project-1',
      role: 'user',
      content: 'hi',
      status: 'complete',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'assistant-1',
      requestId: 'req-stop',
      turnId: 'turn-real',
      sessionId: 'session-a',
      projectId: 'project-1',
      role: 'assistant',
      content: 'streaming again',
      status: 'streaming',
      createdAt: 2,
      updatedAt: 2,
    },
  ],
  session: {
    record: {
      schemaVersion: '1',
      sessionId: 'session-a',
      projectId: 'project-1',
      title: 'A',
      goal: '',
      sessionPath: '/tmp/a',
      createdAt: 1,
      updatedAt: 1,
    },
    revision: { epoch: 'run-1', n: 4 },
  },
} as unknown as ConversationTurnResult);

describe('applyConversationTurnResult session isolation', () => {
  beforeEach(() => {
    useConversationStore.getState().reset();
    useWorkflowStore.getState().reset();
    useSessionProjectionStore.getState().reset();
    useSessionRecordStore.getState().reset();
    useProjectStore.setState({ rightRailTarget: 'project', currentSessionId: 'session-a' });
  });

  it('forces stopped when requestId was monotonically stopped before reconcile', async () => {
    useConversationStore.getState().markRequestMonotonicallyStopped('req-stop');
    useConversationStore.getState().markTurnMonotonicallyStopped('optimistic-turn-req-stop');

    const electronAPI = {
      project: { list: async () => ({ projects: [] }) },
      session: { list: async () => ({ sessions: [] }) },
      run: { list: async () => ({ runs: [] }) },
    } as never;

    await applyConversationTurnResult({
      electronAPI,
      result: baseTurn(),
      currentProject: { projectId: 'project-1' } as never,
      setSessions: () => undefined,
      setCurrentRun: () => undefined,
      setRuns: () => undefined,
      setTracePresentation: () => undefined,
      setConversationMessages: useConversationStore.getState().setConversationMessages,
      setBranchState: useConversationStore.getState().setBranchState,
      setConversationSnapshot: useConversationStore.getState().setConversationSnapshot,
      upsertConversationMessages: useConversationStore.getState().upsertConversationMessages,
    });

    const assistant = useConversationStore.getState().conversationMessages.find((m) => m.role === 'assistant');
    expect(assistant?.status).toBe('stopped');
    expect(useProjectStore.getState().rightRailTarget).toBe('session');
  });

  it('routes background session turn into projection cache', async () => {
    useProjectStore.setState({ currentSessionId: 'session-b' });

    const electronAPI = {
      project: { list: async () => ({ projects: [] }) },
      session: { list: async () => ({ sessions: [] }) },
      run: { list: async () => ({ runs: [] }) },
    } as never;

    await applyConversationTurnResult({
      electronAPI,
      result: baseTurn(),
      currentProject: { projectId: 'project-1' } as never,
      setSessions: () => undefined,
      setCurrentRun: () => undefined,
      setRuns: () => undefined,
      setTracePresentation: () => undefined,
      setConversationMessages: useConversationStore.getState().setConversationMessages,
      setBranchState: useConversationStore.getState().setBranchState,
      setConversationSnapshot: useConversationStore.getState().setConversationSnapshot,
      upsertConversationMessages: useConversationStore.getState().upsertConversationMessages,
    });

    expect(useConversationStore.getState().conversationMessages).toHaveLength(0);
    expect(
      useSessionProjectionStore.getState().bySessionId['session-a']?.allMessages.some((m) => m.id === 'assistant-1'),
    ).toBe(true);
    expect(useProjectStore.getState().rightRailTarget).toBe('project');
  });

  it('keeps a completed turn in its source project when another project root is selected', async () => {
    useProjectStore.setState({
      currentProject: { projectId: 'project-2' } as never,
      currentSessionId: null,
      rightRailTarget: 'project',
    });
    const projectList = vi.fn(async () => ({ projects: [] }));
    await applyConversationTurnResult({
      electronAPI: {
        project: { list: projectList },
        session: { list: async () => ({ sessions: [] }) },
        run: { list: async () => ({ runs: [] }) },
      } as never,
      result: baseTurn(),
      currentProject: { projectId: 'project-1' } as never,
      setSessions: vi.fn(),
      setCurrentRun: vi.fn(),
      setRuns: vi.fn(),
      setTracePresentation: vi.fn(),
      setConversationMessages: useConversationStore.getState().setConversationMessages,
      setBranchState: useConversationStore.getState().setBranchState,
      setConversationSnapshot: useConversationStore.getState().setConversationSnapshot,
      upsertConversationMessages: useConversationStore.getState().upsertConversationMessages,
    });

    expect(useProjectStore.getState().currentSessionId).toBeNull();
    expect(projectList).not.toHaveBeenCalled();
    expect(useProjectStore.getState().currentProject?.projectId).toBe('project-2');
    expect(useConversationStore.getState().conversationMessages).toHaveLength(0);
    expect(useSessionProjectionStore.getState().bySessionId['session-a']?.allMessages).toHaveLength(2);
  });

  it('still applies the first turn when its own project has no selected session', async () => {
    useProjectStore.setState({ currentProject: { projectId: 'project-1' } as never, currentSessionId: null });
    await applyConversationTurnResult({
      electronAPI: {
        project: { list: async () => ({ projects: [] }) },
        session: { list: async () => ({ sessions: [] }) },
        run: { list: async () => ({ runs: [] }) },
      } as never,
      result: baseTurn(),
      currentProject: { projectId: 'project-1' } as never,
      setSessions: vi.fn(),
      setCurrentRun: vi.fn(),
      setRuns: vi.fn(),
      setTracePresentation: vi.fn(),
      setConversationMessages: useConversationStore.getState().setConversationMessages,
      setBranchState: useConversationStore.getState().setBranchState,
      setConversationSnapshot: useConversationStore.getState().setConversationSnapshot,
      upsertConversationMessages: useConversationStore.getState().upsertConversationMessages,
    });

    expect(useProjectStore.getState().currentSessionId).toBe('session-a');
    expect(useSessionRecordStore.getState().records['session-a']?.revision).toEqual({ epoch: 'run-1', n: 4 });
    expect(useConversationStore.getState().conversationMessages).toHaveLength(2);
  });
});
