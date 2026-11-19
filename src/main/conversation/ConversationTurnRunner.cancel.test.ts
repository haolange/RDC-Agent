import { describe, expect, it, vi } from 'vitest';
import type { ConversationMessage, ConversationStreamEvent } from '@shared/types/conversation';

const orchestrator = vi.hoisted(() => ({
  sendProfileMessage: vi.fn(),
  releaseProviderRuntimeCredentials: vi.fn(),
  backgroundSubagents: { beforeParentProviderRequestMessages: vi.fn(() => []) },
}));
const storage = vi.hoisted(() => ({ updateSession: vi.fn(), updateRun: vi.fn(), commitConversationTerminal: vi.fn() }));

vi.mock('../agent-runtime/orchestration/AgentOrchestrator', () => ({ agentOrchestrator: orchestrator }));
vi.mock('../sessions/store/StorageAdapter', () => ({ storageAdapter: storage }));
vi.mock('./ConversationAttachmentMaterializer', () => ({ hydrateFrozenUserContent: vi.fn(async () => 'inspect') }));
vi.mock('../runtime/RuntimeLogService', () => ({ runtimeLogService: { log: vi.fn() } }));
vi.mock('./approvedPlanExit', () => ({ verifyApprovedPlanExit: (_session: string, _turn: string, approved: unknown) => Boolean(approved) }));

import { completeProfileTurn, type CompleteProfileTurnInput, type ConversationTurnRunnerHost } from './ConversationTurnRunner';

function message(role: 'user' | 'assistant', status: ConversationMessage['status']): ConversationMessage {
  return { id: role, role, turnId: 'turn-1', content: role === 'user' ? 'inspect' : '', status, createdAt: 1 } as ConversationMessage;
}

const messageOf = (event: ConversationStreamEvent | undefined): ConversationMessage | undefined => (event as { message?: ConversationMessage } | undefined)?.message;

function runTurn(withApprovedExecution = false): { events: ConversationStreamEvent[]; done: Promise<void> } {
  const events: ConversationStreamEvent[] = [];
  const host: ConversationTurnRunnerHost = {
    persistConversationSnapshot: () => null,
    emitConversationEvent: (event) => { events.push(event); },
    publishRunStatus: vi.fn(),
    publishConversationTrace: vi.fn(),
    registerActiveTurn: vi.fn(),
    clearActiveTurn: vi.fn(),
    assertTerminalContextOwnership: vi.fn(),
    ephemeralTraceSessionId: (turnId) => `conversation-${turnId}`,
  };
  const input = {
    context: { session: withApprovedExecution ? { sessionId: 'session' } : null, projectId: null, currentRun: null },
    requestedProfileId: 'general',
    requestedAgentId: 'general',
    rawMessage: 'inspect',
    importedAttachments: [],
    userMessage: message('user', 'complete'),
    assistantDraftMessage: message('assistant', 'streaming'),
    requestId: 'request-1',
    routePreflight: { providerId: 'provider', modelId: 'model' },
    planning: { ok: true, plan: { executionIdentity: {}, effectiveModelId: 'model', providerId: 'provider' }, controls: undefined, warnings: [] },
    preparedPrompt: { projectRootPath: null, promptPlan: { systemPrompt: '' }, visibleTurnIds: [] },
    preparedTurn: {
      effectiveModel: {}, frozenUserContent: 'inspect', attachmentManifest: null,
      runtime: { effectivePlan: { fingerprint: 'frozen-plan', profileHandoffs: [] }, mcpLease: null, credentialHandle: null,
        ...(withApprovedExecution ? { approvedExecution: { offer: { offerId: '11111111-1111-4111-8111-111111111111',
          plan: { uri: 'session://plans/frozen.md', hash: 'a'.repeat(64) } } } } : {}) },
    },
  } as unknown as CompleteProfileTurnInput;
  return { events, done: completeProfileTurn(host, input) };
}

describe('completeProfileTurn kernel cancellation', () => {
  it('commits a stopped terminal when the turn handle aborts without a session Stop', async () => {
    orchestrator.sendProfileMessage.mockImplementationOnce(async (_agent, _content, options) => {
      options.onTerminalContext({ messages: [], executionIdentity: {}, status: 'stopped' });
      throw new DOMException('Aborted', 'AbortError');
    });
    const { events, done } = runTurn();
    await done;
    const terminal = events.at(-1);
    expect(terminal?.type).toBe('message_completed');
    expect(messageOf(terminal)?.status).toBe('stopped');
    expect(messageOf(terminal)?.workTrace?.status).toBe('stopped');
    expect(events.some((event) => messageOf(event)?.diagnostic?.code === 'CONVERSATION_LLM_REQUEST_FAILED')).toBe(false);
  });

  it('still reports a genuine provider failure as an error', async () => {
    orchestrator.sendProfileMessage.mockImplementationOnce(async (_agent, _content, options) => {
      options.onTerminalContext({ messages: [], executionIdentity: {}, status: 'error' });
      throw new Error('upstream 500');
    });
    const { events, done } = runTurn();
    await done;
    expect(messageOf(events.at(-1))?.status).toBe('error');
  });

  it('consumes the owning Agent receipt without calling a domain validator', async () => {
    orchestrator.sendProfileMessage.mockImplementationOnce(async (_agent, _content, options) => {
      options.onTerminalContext({ messages: [], executionIdentity: {}, status: 'complete',
        completionReceipt: { turnId: 'turn-1', runtimePlanFingerprint: 'frozen-plan', finalAnswerText: 'Canonical final' } });
      return 'Noncanonical response text';
    });
    const { events, done } = runTurn();
    await done;
    expect(messageOf(events.at(-1))).toMatchObject({ status: 'complete', content: 'Canonical final' });
  });

  it.each(['completed', 'partial'] as const)('commits the approved execution receipt only for %s', async disposition => {
    storage.commitConversationTerminal.mockClear();
    orchestrator.sendProfileMessage.mockImplementationOnce(async (_agent, _content, options) => {
      options.onTerminalContext({ messages: [], executionIdentity: {}, status: 'complete', completionDeclaration: { disposition, evidenceRefs: [] },
        completionReceipt: { turnId: 'turn-1', runtimePlanFingerprint: 'frozen-plan', finalAnswerText: 'Final' } });
    });
    const { done } = runTurn(true);
    await done;
    const contextEntry = storage.commitConversationTerminal.mock.calls[0]?.[4];
    expect(contextEntry).toBeDefined();
    if (disposition === 'completed') expect(contextEntry.approvedExecutionCompletion).toEqual({
      offerId: '11111111-1111-4111-8111-111111111111', planUri: 'session://plans/frozen.md', planHash: 'a'.repeat(64),
    });
    else expect(contextEntry.approvedExecutionCompletion).toBeUndefined();
  });

  it('preserves a Mission contract failure as failure', async () => {
    const { MissionCompletionError } = await import('../investigation/missionCompletionContract');
    orchestrator.sendProfileMessage.mockImplementationOnce(async (_agent, _content, options) => {
      options.onTerminalContext({ messages: [], executionIdentity: {}, status: 'error' });
      throw new MissionCompletionError('missing_report', 'report missing');
    });
    const { events, done } = runTurn();
    await done;
    expect(messageOf(events.at(-1))).toMatchObject({ status: 'error', diagnostic: { code: 'MISSION_COMPLETION_DENIED' } });
  });

  it('preserves an approved plan exit without inventing a final answer', async () => {
    orchestrator.sendProfileMessage.mockImplementationOnce(async (_agent, _content, options) => {
      options.onTerminalContext({ messages: [], executionIdentity: {}, status: 'complete', approvedPlan: {},
        completionReceipt: { turnId: 'turn-1', runtimePlanFingerprint: 'frozen-plan', finalAnswerText: '' } });
      return '';
    });
    const { events, done } = runTurn();
    await done;
    expect(messageOf(events.at(-1))).toMatchObject({ status: 'complete', content: '' });
  });
});
