import { describe, expect, it, vi } from 'vitest';
import type { ConversationMessage, ConversationStreamEvent } from '@shared/types/conversation';

const orchestrator = vi.hoisted(() => ({
  sendProfileMessage: vi.fn(),
  releaseProviderRuntimeCredentials: vi.fn(),
  backgroundSubagents: { beforeParentProviderRequestMessages: vi.fn(() => []) },
}));

vi.mock('../workflow/debugger/AgentOrchestrator', () => ({ agentOrchestrator: orchestrator }));
vi.mock('../sessions/StorageAdapter', () => ({ storageAdapter: { updateSession: vi.fn(), updateRun: vi.fn() } }));
vi.mock('./ConversationAttachmentMaterializer', () => ({ hydrateFrozenUserContent: vi.fn(async () => 'inspect') }));
vi.mock('../runtime/RuntimeLogService', () => ({ runtimeLogService: { log: vi.fn() } }));

import { completeProfileTurn, type CompleteProfileTurnInput, type ConversationTurnRunnerHost } from './ConversationTurnRunner';

function message(role: 'user' | 'assistant', status: ConversationMessage['status']): ConversationMessage {
  return { id: role, role, turnId: 'turn-1', content: role === 'user' ? 'inspect' : '', status, createdAt: 1 } as ConversationMessage;
}

const messageOf = (event: ConversationStreamEvent | undefined): ConversationMessage | undefined => (event as { message?: ConversationMessage } | undefined)?.message;

function runTurn(): { events: ConversationStreamEvent[]; done: Promise<void> } {
  const events: ConversationStreamEvent[] = [];
  const host: ConversationTurnRunnerHost = {
    validateCompletion: vi.fn(),
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
    context: { session: null, projectId: null, currentRun: null },
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
      runtime: { effectivePlan: { profileHandoffs: [] }, mcpLease: null, credentialHandle: null },
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
});
