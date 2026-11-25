import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  applyConversationTurnResult,
  buildOptimisticConversationTurn,
  resolveComposerProfileId,
} from '../../stores/conversationSendHelpers';
import { useConversationStore } from '../../stores/conversationStore';
import type { ConversationMessage, ConversationTurnResult } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';

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

const preparedContext: ConversationTurnResult['preparedContext'] = {
  requestId: 'request-1',
  turnId: 'turn-1',
  route: {
    providerId: 'provider-1',
    adapterId: 'openai-compatible',
    selectedModelId: 'model-1',
    effectiveModelId: 'model-1',
    protocol: 'OpenAICompatibleChatCompletions',
    catalogRevision: 'catalog-1',
    routeRevision: 'route-1',
    bindingIds: [],
  },
  wirePatch: { headers: {}, body: {} },
  controls: { reasoningLevel: 'off', maxContextMode: false, fastModel: false },
  contextMode: 'normal',
  preparedInputTokens: 10,
  uncompactedInputTokens: 10,
  promptBudgetTokens: 100,
  contextWindowTokens: 128,
  maxOutputTokens: 28,
  compactionThresholdTokens: 80,
  usagePercent: 10,
  breakdown: [],
  compactionApplied: false,
  filteredArtifactCount: 0,
  continuation: {
    executionFingerprint: 'test-execution',
    strategy: 'semantic-replay',
    replayedArtifactCount: 0,
    droppedArtifactCount: 0,
    decisionCounts: [],
  },
  cache: {
    enabled: false,
    mode: 'none',
    keyCarrier: 'none',
    breakpointCarrier: 'none',
    ttl: 'none',
    breakpoint: 'none',
    stableTokenEstimate: 0,
    stableSegmentCount: 0,
    providerReported: false,
    reason: 'test fixture',
  },
  preparedAt: 1,
};

const makeElectronApi = () => ({
  project: { list: vi.fn().mockResolvedValue({ projects: [] }) },
  session: { list: vi.fn().mockResolvedValue({ sessions: [] }) },
  conversation: { getHistory: vi.fn() },
  trace: { getProjection: vi.fn().mockResolvedValue(null) },
}) as unknown as NonNullable<Window['electronAPI']>;

describe('composerSendHelpers', () => {
  it('defaults an empty composer identity to general instead of ask', () => {
    expect(resolveComposerProfileId(undefined)).toBe('general');
    expect(resolveComposerProfileId('')).toBe('general');
    const optimistic = buildOptimisticConversationTurn({
      requestId: 'req-1',
      trimmed: 'hello',
      currentProject: null,
      currentSession: null,
      currentRun: null,
      pendingAttachments: [],
    });
    expect(optimistic.userMessage.profileId).toBe('general');
    expect(optimistic.assistantDraftMessage.agentId).toBe('general');
    expect(optimistic.assistantDraftMessage.agentId).not.toBe('ask');
  });

  it('shows a plan handoff as its plan reference from the first frame', () => {
    const planReference = { intent: 'execute' as const, planId: 'plan', revision: 2, hash: 'a'.repeat(64),
      uri: 'session://plans/plan.md', title: 'Find the draw', agentId: 'general' };
    const optimistic = buildOptimisticConversationTurn({
      requestId: 'req-plan', trimmed: 'Execute the frozen plan.', currentProject: null,
      currentSession: null, currentRun: null, pendingAttachments: [], selectedAgentId: 'general', planReference,
    });
    expect(optimistic.userMessage.planReference).toEqual(planReference);
    expect(buildOptimisticConversationTurn({ requestId: 'req-plain', trimmed: 'hi', currentProject: null,
      currentSession: null, currentRun: null, pendingAttachments: [] }).userMessage).not.toHaveProperty('planReference');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useConversationStore.getState().reset();
    delete (globalThis as { navigator?: Navigator }).navigator;
  });

  it('replaces visible conversation when turn result carries canonical messages', async () => {
    const visibleMessages = [
      makeMessage('user-new', 'turn-new', 'user', 'edited prompt'),
      makeMessage('assistant-new', 'turn-new', 'assistant'),
    ];
    const result: ConversationTurnResult = {
      requestId: 'request-1',
      preparedContext,
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
    const setConversationSnapshot = vi.fn();

    await applyConversationTurnResult({
      electronAPI: makeElectronApi(),
      result,
      currentProject: null,
      setSessions: vi.fn(),
      setCurrentRun: vi.fn(),
      setTracePresentation: vi.fn(),
      setConversationMessages,
      setBranchState,
      setConversationSnapshot,
      upsertConversationMessages,
    });

    expect(setConversationSnapshot).toHaveBeenCalledWith(visibleMessages, branchState);
    expect(setConversationMessages).not.toHaveBeenCalled();
    expect(setBranchState).not.toHaveBeenCalled();
    expect(upsertConversationMessages).not.toHaveBeenCalled();
  });

  it('keeps the newer SSE terminal message when invoke returns a stale draft snapshot', async () => {
    const userMessage = makeMessage('user-1', 'turn-1', 'user', 'prompt');
    const staleAssistantDraft = {
      ...makeMessage('assistant-1', 'turn-1', 'assistant', ''),
      status: 'streaming' as const,
      updatedAt: 2,
    };
    const terminalAssistant = {
      ...staleAssistantDraft,
      content: 'done',
      status: 'complete' as const,
      updatedAt: 10,
    };
    useConversationStore.getState().setConversationMessages([userMessage, terminalAssistant]);

    const result: ConversationTurnResult = {
      requestId: 'request-1',
      preparedContext,
      session: null,
      mode: 'talk',
      userMessage,
      assistantDraftMessage: staleAssistantDraft,
      messages: [userMessage, staleAssistantDraft],
      executionTransition: { action: 'none' },
    };
    const setConversationMessages = vi.fn();

    await applyConversationTurnResult({
      electronAPI: makeElectronApi(),
      result,
      currentProject: null,
      setSessions: vi.fn(),
      setCurrentRun: vi.fn(),
      setTracePresentation: vi.fn(),
      setConversationMessages,
      setBranchState: vi.fn(),
      upsertConversationMessages: vi.fn(),
    });

    expect(setConversationMessages).toHaveBeenCalledWith([userMessage, terminalAssistant]);
  });

  it('uses direct upsert only for results without canonical messages', async () => {
    const userMessage = makeMessage('user-1', 'turn-1', 'user', 'prompt');
    const assistantDraftMessage = makeMessage('assistant-1', 'turn-1', 'assistant');
    const result: ConversationTurnResult = {
      requestId: 'request-1',
      preparedContext,
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
      setSessions: vi.fn(),
      setCurrentRun: vi.fn(),
      setTracePresentation: vi.fn(),
      setConversationMessages,
      setBranchState: vi.fn(),
      upsertConversationMessages,
    });

    expect(upsertConversationMessages).toHaveBeenCalledWith([userMessage, assistantDraftMessage]);
    expect(setConversationMessages).not.toHaveBeenCalled();
  });
});
