import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@shared/types/agentRuntime';
import { AgentToolApprovalRequestService } from '../permissions/AgentToolApprovalRequestService';
import { AgentUserInputRequestService } from './AgentUserInputRequestService';
import { withDelegatedInteractionOwner } from './DelegatedInteractionOwner';

const owner = { ownerSessionId: 'parent', childSessionId: 'child', executionId: 'execution-1' };
const context = { sessionId: 'child', turnId: 'child-turn', agentId: 'general' as const };
describe('delegated controlled interactions', () => {
  it('projects tool approval to its owner and only accepts that owner once', async () => {
    const service = new AgentToolApprovalRequestService(); const events: AgentEvent[] = [];
    const pending = withDelegatedInteractionOwner(owner, () => service.request({ agentId: 'general', sessionId: 'child', turnId: 'child-turn', toolCallId: 'tool', toolName: 'shell', reason: 'run scoped command', risk: 'high', context, onEvent: (event) => events.push(event) }));
    expect(events[0]).toMatchObject({ sessionId: 'parent', turnId: 'child-turn', payload: { delegatedRequest: { executionId: 'execution-1', childSessionId: 'child', turnId: 'child-turn' } } });
    for (const sessionId of ['other', 'child', null]) expect(service.answer({ sessionId, turnId: 'child-turn', approvalId: 'tool-approval-tool', approved: true }).success).toBe(false);
    expect(service.answer({ sessionId: 'parent', turnId: 'child-turn', approvalId: 'tool-approval-tool', approved: true }).success).toBe(true);
    await expect(pending).resolves.toBe(true);
    expect(service.answer({ sessionId: 'parent', turnId: 'child-turn', approvalId: 'tool-approval-tool', approved: true }).success).toBe(false);
    expect(events[1]).toMatchObject({ sessionId: 'parent', payload: { status: 'approved' } });
  });
  it('answers child information requests through the owner and cancels pending requests', async () => {
    const service = new AgentUserInputRequestService(); const events: AgentEvent[] = [];
    const controller = new AbortController();
    const input = { agentId: 'general' as const, sessionId: 'child', turnId: 'child-turn', toolCallId: 'ask', questions: [{ questionId: 'q', prompt: 'Choose scope', options: [], allowFreeform: true }], context, signal: controller.signal, onEvent: (event: AgentEvent) => events.push(event) };
    const pending = withDelegatedInteractionOwner(owner, () => service.request(input));
    expect(service.answer({ sessionId: 'other', turnId: 'child-turn', toolCallId: 'ask', answers: [{ questionId: 'q', answer: 'x' }] }).success).toBe(false);
    expect(service.answer({ sessionId: 'parent', turnId: 'child-turn', toolCallId: 'ask', answers: [{ questionId: 'q', answer: 'read-only' }] }).success).toBe(true);
    await expect(pending).resolves.toContain('read-only');
    const cancelled = withDelegatedInteractionOwner(owner, () => service.request(input));
    const rejection = expect(cancelled).rejects.toThrow('cancelled'); controller.abort(); await rejection;
    expect(events.at(-1)).toMatchObject({ sessionId: 'parent', payload: { status: 'cancelled' } });
    expect(service.answer({ sessionId: 'parent', turnId: 'child-turn', toolCallId: 'ask', answers: [{ questionId: 'q', answer: 'late' }] }).success).toBe(false);
  });
});
