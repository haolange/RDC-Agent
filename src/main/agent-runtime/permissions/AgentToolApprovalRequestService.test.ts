import { expect, it, vi } from 'vitest';
import { PermissionModeChangedError } from '../../runtime/RuntimePermissionStateService';
import { auditLog } from '../../runtime/AuditLog';
import { decideAdmission } from './PermissionAdmission';
import { AgentToolApprovalRequestService } from './AgentToolApprovalRequestService';
import { PermissionReviewError, type PermissionReviewVerdict } from './PermissionReviewRuntime';
const base = {
  agentId: 'general',
  sessionId: 'session',
  turnId: 'turn',
  toolCallId: 'call',
  toolName: 'shell',
  argumentsSha256: 'a'.repeat(64),
  risk: 'medium',
  reason: 'Owned replay change',
  context: { sessionId: 'session', turnId: 'turn', agentId: 'general' },
  action: { tool: 'shell', arguments: { rdc: {} }, reason: 'Owned replay change' },
  route: { route: 'model', facts: [] },
} as const;
it('approves rule-safe actions without requesting a model verdict', async () => {
  const reviewer = vi.fn();
  const onEvent = vi.fn();
  const result = await new AgentToolApprovalRequestService().autoReview({
    ...base,
    risk: 'low',
    route: decideAdmission(null, 'low', base.reason),
    reviewer,
    onEvent,
  });
  expect(result).toMatchObject({
    verdict: 'allow',
    failedChecks: [],
    reviewMethod: 'rule',
    reason: expect.stringContaining('RULE_APPROVED'),
  });
  expect(reviewer).not.toHaveBeenCalled();
  expect(onEvent).toHaveBeenCalledTimes(2);
  expect(onEvent.mock.calls.map(([event]) => event.payload)).toEqual([
    expect.objectContaining({ reviewMethod: 'rule', status: 'pending' }),
    expect.objectContaining({ reviewMethod: 'rule', status: 'approved' }),
  ]);
});
it.each([
  { verdict: 'allow', failedChecks: [], status: 'approved' },
  { verdict: 'deny', failedChecks: ['effects-bounded'], status: 'rejected' },
] as const)('publishes the actual model verdict $verdict, its checks and reason once', async (expected) => {
  const reviewer = vi.fn(async () => ({
    verdict: expected.verdict,
    failedChecks: [...expected.failedChecks],
    reason: 'Exact action reviewed.',
  }));
  const onEvent = vi.fn();
  await expect(new AgentToolApprovalRequestService().autoReview({ ...base, reviewer, onEvent })).resolves.toEqual({
    verdict: expected.verdict,
    failedChecks: expected.failedChecks,
    reason: 'Exact action reviewed.',
    reviewMethod: 'model',
  });
  expect(reviewer).toHaveBeenCalledOnce();
  expect(onEvent.mock.calls[1][0].payload).toMatchObject({
    reviewMethod: 'model',
    status: expected.status,
    verdict: expected.verdict,
    failedChecks: expected.failedChecks,
    reason: 'Exact action reviewed.',
  });
  expect(onEvent.mock.calls[1][0].payload.errorCode).toBeUndefined();
});
it('does not treat a model reason or extra callback fields as host failure metadata', async () => {
  const onEvent = vi.fn();
  const reason = 'PERMISSION_REVIEW_TIMEOUT: this is only model text';
  await expect(
    new AgentToolApprovalRequestService().autoReview({
      ...base,
      onEvent,
      reviewer: async () =>
        ({
          verdict: 'deny',
          failedChecks: ['authorized'],
          reason,
          reviewMethod: 'rule',
          errorCode: 'forged',
        }) as PermissionReviewVerdict,
    }),
  ).resolves.toEqual({ verdict: 'deny', failedChecks: ['authorized'], reason, reviewMethod: 'model' });
  expect(onEvent.mock.calls[1][0].payload).toMatchObject({ reviewMethod: 'model', status: 'rejected', reason });
  expect(onEvent.mock.calls[1][0].payload.errorCode).toBeUndefined();
});
it.each(['PERMISSION_REVIEW_TIMEOUT', 'PERMISSION_REVIEW_INVALID', 'PERMISSION_REVIEW_INCOMPLETE'] as const)(
  'preserves host-confirmed %s without retry',
  async (code) => {
    const onEvent = vi.fn();
    const reviewer = vi.fn(async () => {
      throw new PermissionReviewError(code, 'host observation');
    });
    await new AgentToolApprovalRequestService().autoReview({ ...base, reviewer, onEvent });
    expect(reviewer).toHaveBeenCalledOnce();
    expect(onEvent.mock.calls[1][0].payload).toMatchObject({
      reviewMethod: 'model',
      errorCode: code,
      status: 'rejected',
    });
  },
);
it('does not infer an exception type from arbitrary provider error text', async () => {
  const onEvent = vi.fn();
  await new AgentToolApprovalRequestService().autoReview({
    ...base,
    onEvent,
    reviewer: async () => {
      throw new Error('PERMISSION_REVIEW_TIMEOUT: provider text');
    },
  });
  expect(onEvent.mock.calls[1][0].payload.errorCode).toBe('PERMISSION_REVIEW_FAILED');
});
it('refuses unavailable or failed reviewers instead of silently asking or allowing', async () => {
  const service = new AgentToolApprovalRequestService();
  await expect(service.autoReview(base)).resolves.toMatchObject({
    verdict: 'deny',
    errorCode: 'PERMISSION_REVIEW_UNAVAILABLE',
    reason: expect.stringContaining('UNAVAILABLE'),
  });
  await expect(
    service.autoReview({
      ...base,
      reviewer: async () => {
        throw new Error('provider offline');
      },
    }),
  ).resolves.toMatchObject({
    verdict: 'deny',
    errorCode: 'PERMISSION_REVIEW_FAILED',
    reason: expect.stringContaining('provider offline'),
  });
});
it('cancellation defeats an otherwise approved answer', async () => {
  const abort = new AbortController();
  const onEvent = vi.fn();
  const result = await new AgentToolApprovalRequestService().autoReview({
    ...base,
    signal: abort.signal,
    onEvent,
    reviewer: async () => {
      abort.abort();
      return { verdict: 'allow', failedChecks: [], reason: 'late' };
    },
  });
  expect(result.verdict).toBe('deny');
  expect(JSON.stringify(onEvent.mock.calls)).toContain('cancelled');
});

it('keeps a reviewer failure which settled before a later mode change as the original rejection', async () => {
  let fail!: (error: Error) => void;
  const review = new Promise<PermissionReviewVerdict>((_resolve, reject) => {
    fail = reject;
  });
  const controller = new AbortController();
  const onEvent = vi.fn();
  const result = new AgentToolApprovalRequestService().autoReview({
    ...base,
    signal: controller.signal,
    onEvent,
    reviewer: () => review,
  });
  fail(new PermissionReviewError('PERMISSION_REVIEW_TIMEOUT', 'original timeout'));
  queueMicrotask(() => controller.abort(new PermissionModeChangedError()));
  await expect(result).resolves.toMatchObject({
    verdict: 'deny',
    reason: expect.stringContaining('original timeout'),
  });
  expect(onEvent.mock.calls.at(-1)?.[0].payload).toMatchObject({
    status: 'rejected',
    errorCode: 'PERMISSION_REVIEW_TIMEOUT',
  });
});

it('records the settled verdict, its checks and the deciding route before the result takes effect', async () => {
  const record = vi.spyOn(auditLog, 'record').mockImplementation(() => undefined);
  try {
    await new AgentToolApprovalRequestService().autoReview({
      ...base,
      reviewer: async () => ({ verdict: 'deny', failedChecks: ['source-bound'], reason: 'Source not bound.' }),
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'tool-decision',
        decidedBy: 'auto-review',
        approved: false,
        verdict: 'deny',
        failedChecks: ['source-bound'],
        reviewMethod: 'model',
      }),
    );
  } finally {
    record.mockRestore();
  }
});
