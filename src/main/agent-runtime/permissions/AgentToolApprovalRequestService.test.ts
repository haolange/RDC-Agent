import { expect, it, vi } from 'vitest';
import { AgentToolApprovalRequestService } from './AgentToolApprovalRequestService';
const base = { agentId: 'general', sessionId: 'session', turnId: 'turn', toolCallId: 'call', toolName: 'shell',
  risk: 'medium', reason: 'Owned replay change', context: { sessionId: 'session', turnId: 'turn', agentId: 'general' },
  action: { tool: 'shell', arguments: { rdc: {} }, reason: 'Owned replay change' } } as const;
it('approves rule-safe actions without requesting a model verdict', async () => {
  const reviewer = vi.fn(); const onEvent = vi.fn();
  const result = await new AgentToolApprovalRequestService().autoReview({ ...base, risk: 'low', reviewer, onEvent });
  expect(result).toMatchObject({ approved: true, reason: expect.stringContaining('RULE_APPROVED') });
  expect(reviewer).not.toHaveBeenCalled(); expect(onEvent).toHaveBeenCalledTimes(2);
});
it.each([true, false])('publishes the actual model verdict %s and reason once', async approved => {
  const reviewer = vi.fn(async () => ({ approved, reason: 'Exact action reviewed.' })); const onEvent = vi.fn();
  await expect(new AgentToolApprovalRequestService().autoReview({ ...base, reviewer, onEvent })).resolves.toEqual({ approved, reason: 'Exact action reviewed.' });
  expect(reviewer).toHaveBeenCalledOnce(); expect(JSON.stringify(onEvent.mock.calls)).toContain('Exact action reviewed.');
});
it('refuses unavailable or failed reviewers instead of silently asking or allowing', async () => {
  const service = new AgentToolApprovalRequestService();
  await expect(service.autoReview(base)).resolves.toMatchObject({ approved: false, reason: expect.stringContaining('UNAVAILABLE') });
  await expect(service.autoReview({ ...base, reviewer: async () => { throw new Error('provider offline'); } })).resolves.toMatchObject({ approved: false, reason: expect.stringContaining('provider offline') });
});
it('cancellation defeats an otherwise approved answer', async () => {
  const abort = new AbortController(); const onEvent = vi.fn();
  const result = await new AgentToolApprovalRequestService().autoReview({ ...base, signal: abort.signal, onEvent,
    reviewer: async () => { abort.abort(); return { approved: true, reason: 'late' }; } });
  expect(result.approved).toBe(false); expect(JSON.stringify(onEvent.mock.calls)).toContain('cancelled');
});
