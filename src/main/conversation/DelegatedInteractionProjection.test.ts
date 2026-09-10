import { describe, expect, it, vi } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import { createAgentEventHandler } from './ConversationTurnAgentEventHandler';
import { reconcileDelegatedInteractionRequests } from './DelegatedInteractionRecovery';
import { findPendingUserInput } from '../../renderer/features/composer/userInputRequestModel';

describe('delegated request projection after parent completion', () => {
  it('persists a pending child question without reopening parent output and routes answer to child turn', () => {
    const message = { id: 'parent-message', sessionId: 'parent', turnId: 'parent-turn', role: 'assistant', status: 'complete', content: 'Work continues in a Task.', createdAt: 1, updatedAt: 1 } as ConversationMessage;
    const state = { assistantMessage: message };
    const host = { emitConversationEvent: vi.fn(), persistConversationSnapshot: vi.fn(() => null), publishConversationTrace: vi.fn() };
    const commit = vi.fn();
    const handler = createAgentEventHandler({ host, sessionId: 'parent', input: { userMessage: {} }, turnStreamState: state, commitAssistantMessage: commit } as unknown as Parameters<typeof createAgentEventHandler>[0]);
    handler({ id: 'event', type: 'approval.requested', sessionId: 'parent', turnId: 'child-turn', timestamp: 2, payload: { approvalId: 'ask-user-call', title: 'Question', status: 'pending', kind: 'ask_user', toolCallId: 'call', toolName: 'ask_user', questions: [{ questionId: 'scope', prompt: 'Which scope?', options: [], allowFreeform: true }], delegatedRequest: { executionId: 'exec-1', childSessionId: 'child', turnId: 'child-turn' } } });
    expect(commit).not.toHaveBeenCalled(); // parent stream scheduler may already be closed
    expect(state.assistantMessage.status).toBe('complete'); expect(state.assistantMessage.content).toBe(message.content);
    expect(host.persistConversationSnapshot).toHaveBeenCalledOnce();
    expect(findPendingUserInput([state.assistantMessage])).toMatchObject({ sessionId: 'parent', turnId: 'child-turn', toolCallId: 'call' });
    const restarted = reconcileDelegatedInteractionRequests('parent', state.assistantMessage);
    expect(findPendingUserInput([restarted])).toBeNull();
    expect(restarted.status).toBe('complete');
  });
});
