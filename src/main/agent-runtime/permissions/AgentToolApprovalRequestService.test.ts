import { PermissionModeChangedError } from './RuntimePermissionStateService';
import { expect, it, vi } from 'vitest';
import { AgentToolApprovalRequestService } from './AgentToolApprovalRequestService';
import { PermissionReviewError } from './PermissionReviewRuntime';
const base = { agentId: 'general', sessionId: 'session', turnId: 'turn', toolCallId: 'call', toolName: 'shell',
  risk: 'medium', reason: 'Owned replay change', context: { sessionId: 'session', turnId: 'turn', agentId: 'general' },
  action: { tool: 'shell', arguments: { rdc: {} }, reason: 'Owned replay change' } } as const;
it('approves rule-safe actions without requesting a model verdict', async () => {
  const reviewer = vi.fn(); const onEvent = vi.fn();
  const result = await new AgentToolApprovalRequestService().autoReview({ ...base, risk: 'low', reviewer, onEvent });
  expect(result).toMatchObject({ approved: true, reason: expect.stringContaining('RULE_APPROVED') });
  expect(reviewer).not.toHaveBeenCalled(); expect(onEvent).toHaveBeenCalledTimes(2);
  expect(onEvent.mock.calls.map(([event]) => event.payload)).toEqual([
    expect.objectContaining({ reviewMethod: 'rule', status: 'pending' }),
    expect.objectContaining({ reviewMethod: 'rule', status: 'approved' }),
  ]);
});
it.each([true, false])('publishes the actual model verdict %s and reason once', async approved => {
  const reviewer = vi.fn(async () => ({ approved, reason: 'Exact action reviewed.' })); const onEvent = vi.fn();
  await expect(new AgentToolApprovalRequestService().autoReview({ ...base, reviewer, onEvent })).resolves.toEqual({ approved, reason: 'Exact action reviewed.' });
  expect(reviewer).toHaveBeenCalledOnce(); expect(JSON.stringify(onEvent.mock.calls)).toContain('Exact action reviewed.');
  expect(onEvent.mock.calls[1][0].payload).toMatchObject({ reviewMethod: 'model', status: approved ? 'approved' : 'rejected' });
  expect(onEvent.mock.calls[1][0].payload.errorCode).toBeUndefined();
});
it('does not treat a model reason or extra callback fields as host failure metadata', async () => {
  const onEvent = vi.fn();
  const reason = 'PERMISSION_REVIEW_TIMEOUT: this is only model text';
  await expect(new AgentToolApprovalRequestService().autoReview({ ...base, onEvent,
    reviewer: async () => ({ approved: false, reason, reviewMethod: 'rule', errorCode: 'forged' }),
  })).resolves.toEqual({ approved: false, reason });
  expect(onEvent.mock.calls[1][0].payload).toMatchObject({ reviewMethod: 'model', status: 'rejected', reason });
  expect(onEvent.mock.calls[1][0].payload.errorCode).toBeUndefined();
});
it.each(['PERMISSION_REVIEW_TIMEOUT', 'PERMISSION_REVIEW_INVALID', 'PERMISSION_REVIEW_INCOMPLETE'])('preserves host-confirmed %s without retry', async code => {
  const onEvent = vi.fn();
  const reviewer = vi.fn(async () => { throw new PermissionReviewError(code, 'host observation'); });
  await new AgentToolApprovalRequestService().autoReview({ ...base, reviewer, onEvent });
  expect(reviewer).toHaveBeenCalledOnce();
  expect(onEvent.mock.calls[1][0].payload).toMatchObject({ reviewMethod: 'model', errorCode: code, status: 'rejected' });
});
it('does not infer an exception type from arbitrary provider error text', async () => {
  const onEvent = vi.fn();
  await new AgentToolApprovalRequestService().autoReview({ ...base, onEvent,
    reviewer: async () => { throw new Error('PERMISSION_REVIEW_TIMEOUT: provider text'); },
  });
  expect(onEvent.mock.calls[1][0].payload.errorCode).toBe('PERMISSION_REVIEW_FAILED');
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

it('keeps a reviewer failure which settled before a later mode change as the original rejection', async () => {
  let fail!: (error: Error) => void;
  const review = new Promise<{ approved: boolean; reason: string }>((_resolve, reject) => { fail = reject; });
  const controller = new AbortController(); const onEvent = vi.fn();
  const result = new AgentToolApprovalRequestService().autoReview({ ...base, signal: controller.signal, onEvent, reviewer: () => review });
  fail(new PermissionReviewError('PERMISSION_REVIEW_TIMEOUT', 'original timeout'));
  queueMicrotask(() => controller.abort(new PermissionModeChangedError()));
  await expect(result).resolves.toMatchObject({ approved: false, reason: expect.stringContaining('original timeout') });
  expect(onEvent.mock.calls.at(-1)?.[0].payload).toMatchObject({ status: 'rejected', errorCode: 'PERMISSION_REVIEW_TIMEOUT' });
});
