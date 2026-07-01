import { describe, expect, it, vi, afterEach } from 'vitest';
import type { ConversationMessage, ConversationTurnResult } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import {
  applyConversationTurnResult,
  syncE2EConversationState,
} from './composerSendHelpers';

const makeMessage = (
  id: string,
  turnId: string,
  role: ConversationMessage['role'],
  content = '',
): ConversationMessage => ({
  id,
  turnId,
  sessionId: 'session-1',
  projectId: 'project-1',
  role,
  content,
  status: role === 'assistant' ? 'streaming' : 'complete',
  createdAt: 1,
  updatedAt: 1,
});

const branchState: ConversationBranchState = {
  sessionId: 'session-1',
  rootBranchId: 'branch-root',
  activeLeafBranchId: 'branch-new',
  forks: [],
};

const makeElectronApi = () => ({
  project: { list: vi.fn().mockResolvedValue({ projects: [] }) },
  session: { list: vi.fn().mockResolvedValue({ sessions: [] }) },
  run: { list: vi.fn().mockResolvedValue({ runs: [] }) },
  conversation: { getHistory: vi.fn() },
  trace: { getProjection: vi.fn().mockResolvedValue(null) },
}) as unknown as NonNullable<Window['electronAPI']>;

describe('composerSendHelpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { navigator?: Navigator }).navigator;
  });

  it('replaces visible conversation when turn result carries canonical messages', async () => {
    const visibleMessages = [
      makeMessage('user-new', 'turn-new', 'user', 'edited prompt'),
      makeMessage('assistant-new', 'turn-new', 'assistant'),
    ];
    const result: ConversationTurnResult = {
      session: null,
      mode: 'talk',
      userMessage: visibleMessages[0],
      assistantDraftMessage: visibleMessages[1],
      messages: visibleMessages,
      branchState,
      executionTransition: { action: 'none' },
    };
    const setConversationMessages = vi.fn();
    const upsertConversationMessages = vi.fn();
    const setBranchState = vi.fn();

    await applyConversationTurnResult({
      electronAPI: makeElectronApi(),
      result,
      currentProject: null,
      setCurrentSession: vi.fn(),
      setSessions: vi.fn(),
      setCurrentRun: vi.fn(),
      setRuns: vi.fn(),
      setTracePresentation: vi.fn(),
      setConversationMessages,
      setBranchState,
      upsertConversationMessages,
    });

    expect(setConversationMessages).toHaveBeenCalledWith(visibleMessages);
    expect(setBranchState).toHaveBeenCalledWith(branchState);
    expect(upsertConversationMessages).not.toHaveBeenCalled();
  });

  it('uses direct upsert only for results without canonical messages', async () => {
    const userMessage = makeMessage('user-1', 'turn-1', 'user', 'prompt');
    const assistantDraftMessage = makeMessage('assistant-1', 'turn-1', 'assistant');
    const result: ConversationTurnResult = {
      session: null,
      mode: 'talk',
      userMessage,
      assistantDraftMessage,
      executionTransition: { action: 'none' },
    };
    const setConversationMessages = vi.fn();
    const upsertConversationMessages = vi.fn();

    await applyConversationTurnResult({
      electronAPI: makeElectronApi(),
      result,
      currentProject: null,
      setCurrentSession: vi.fn(),
      setSessions: vi.fn(),
      setCurrentRun: vi.fn(),
      setRuns: vi.fn(),
      setTracePresentation: vi.fn(),
      setConversationMessages,
      setBranchState: vi.fn(),
      upsertConversationMessages,
    });

    expect(upsertConversationMessages).toHaveBeenCalledWith([userMessage, assistantDraftMessage]);
    expect(setConversationMessages).not.toHaveBeenCalled();
  });

  it('does not let stale terminal sync overwrite a newer active branch', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { webdriver: true },
      configurable: true,
    });
    const electronAPI = makeElectronApi();
    const assistantDone = {
      ...makeMessage('assistant-old', 'turn-old', 'assistant', 'done'),
      status: 'complete' as const,
    };
    vi.mocked(electronAPI.conversation.getHistory).mockResolvedValue({
      messages: [assistantDone],
      branchState,
    });
    const setConversationMessages = vi.fn();
    const setTracePresentation = vi.fn();

    await syncE2EConversationState({
      electronAPI,
      sessionId: 'session-1',
      turnId: 'turn-old',
      setConversationMessages,
      setTracePresentation,
      setBranchState: vi.fn(),
      shouldApply: () => false,
    });

    expect(electronAPI.conversation.getHistory).toHaveBeenCalledTimes(1);
    expect(setConversationMessages).not.toHaveBeenCalled();
    expect(setTracePresentation).not.toHaveBeenCalled();
  });
});
