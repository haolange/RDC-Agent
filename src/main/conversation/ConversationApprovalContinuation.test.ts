import { expect, it, vi } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import type { AgentEvent } from '@shared/types/agentRuntime';
import { createAgentEventHandler } from './ConversationTurnAgentEventHandler';
it('independent review cannot request a human pause or clear another manual approval', () => {
 const state = { assistantMessage: { id: 'm', sessionId: 's', turnId: 't', role: 'assistant', status: 'streaming', content: '', createdAt: 1 } as ConversationMessage };
 const pending = { approval: false, userInput: false, planReview: false, handoff: false };
 const handler = createAgentEventHandler({ host: { emitConversationEvent: vi.fn() }, sessionId: 's', input: { userMessage: {} }, turnStreamState: state,
  pendingContinuation: pending, markLoopCommentary: vi.fn(), currentLoopOptions: () => ({}),
  commitAssistantMessage: (_type: string, patch: Partial<ConversationMessage>) => { state.assistantMessage = { ...state.assistantMessage, ...patch }; },
 } as unknown as Parameters<typeof createAgentEventHandler>[0]);
 const emit = (id: string, status: 'pending' | 'approved', automated = false) => handler({ id, type: status === 'pending' ? 'approval.requested' : 'approval.answered', sessionId: 's', timestamp: 1,
  payload: { kind: 'tool', approvalId: id, toolCallId: id, toolName: 'shell', status, ...(automated ? { reviewer: 'auto_review', reviewMethod: 'model' } : {}) },
 } as AgentEvent);
 emit('auto', 'pending', true); expect(pending.approval).toBe(false);
 emit('manual', 'pending'); emit('manual2', 'pending'); expect(pending.approval).toBe(true);
 emit('auto', 'approved', true); expect(pending.approval).toBe(true);
 emit('manual', 'approved'); expect(pending.approval).toBe(true);
 emit('manual2', 'approved'); expect(pending.approval).toBe(false);
});
