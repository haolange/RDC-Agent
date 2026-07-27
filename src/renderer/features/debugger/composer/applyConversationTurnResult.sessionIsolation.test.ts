import { beforeEach, describe, expect, it } from 'vitest';
import type { ConversationTurnResult } from '@shared/types/conversation';
import { useConversationStore } from '../../../stores/conversationStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionProjectionStore } from '../../../stores/sessionProjectionStore';
import { useWorkflowStore } from '../../../stores/workflowStore';
import { applyConversationTurnResult } from './composerSendHelpers';

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
    sessionId: 'session-a',
    projectId: 'project-1',
    title: 'A',
    goal: '',
    sessionPath: '/tmp/a',
    createdAt: 1,
    updatedAt: 1,
  },
} as unknown as ConversationTurnResult);

describe('applyConversationTurnResult session isolation', () => {
  beforeEach(() => {
    useConversationStore.getState().reset();
    useWorkflowStore.getState().reset();
    useSessionProjectionStore.getState().reset();
    useProjectStore.setState({
      rightRailTarget: 'project',
      currentSession: {
        sessionId: 'session-a',
        projectId: 'project-1',
        title: 'A',
        goal: '',
        sessionPath: '/tmp/a',
        createdAt: 1,
        updatedAt: 1,
      },
    });
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
      setCurrentSession: () => undefined,
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
    useProjectStore.setState({
      currentSession: {
        sessionId: 'session-b',
        projectId: 'project-1',
        title: 'B',
        goal: '',
        sessionPath: '/tmp/b',
        createdAt: 1,
        updatedAt: 1,
      },
    });

    const electronAPI = {
      project: { list: async () => ({ projects: [] }) },
      session: { list: async () => ({ sessions: [] }) },
      run: { list: async () => ({ runs: [] }) },
    } as never;

    await applyConversationTurnResult({
      electronAPI,
      result: baseTurn(),
      currentProject: { projectId: 'project-1' } as never,
      setCurrentSession: () => undefined,
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
});
