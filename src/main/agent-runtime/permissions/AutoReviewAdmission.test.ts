import { beforeEach, describe, expect, it, vi } from 'vitest';

const audit = vi.hoisted(() => ({ record: vi.fn() }));
const evaluate = vi.hoisted(() => vi.fn());
vi.mock('../../runtime/AuditLog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../runtime/AuditLog')>()),
  auditLog: audit,
}));
vi.mock('./AgentPermissionPolicy', () => ({ agentPermissionPolicyService: { evaluate } }));

import { agentToolApprovalRequestService } from './AgentToolApprovalRequestService';
import { registerAdmissionAdapter, TurnAdmission, type AdmissionAssessment } from './PermissionAdmission';
import { authorizeToolPermission, ToolPermissionDenied } from './ToolPermissionAuthorization';
import type { PermissionReviewer } from './PermissionReviewRuntime';
import type { RuntimePermissionState } from '@shared/types/runtimePermission';
import type { AgentEvent } from '@shared/types/agentRuntime';

let assessment: AdmissionAssessment | null = null;
registerAdmissionAdapter((request) => (request.toolCall.name === 'admission-flow' ? assessment : null));

const turn = () =>
  new TurnAdmission({
    sessionId: 'session',
    projectId: 'project',
    turnId: 'turn',
    agentId: 'general',
    accessCeiling: 'full',
    approved: null,
    captureBaseline: () => ({ available: false, reason: 'none' }),
  });
function flow(reviewer: PermissionReviewer, admission = turn(), onEvent: (event: AgentEvent) => void = () => {}) {
  return authorizeToolPermission(
    {
      decision: {
        toolCall: { type: 'toolCall', id: 'call', name: 'admission-flow', arguments: { change: 1 } },
        tool: { spec: {} },
      },
      approval: {
        agentId: 'general',
        sessionId: 'session',
        turnId: 'turn',
        toolCallId: 'call',
        toolName: 'admission-flow',
        context: { sessionId: 'session', turnId: 'turn' },
        onEvent,
      },
      review: { reviewPermission: reviewer, admission },
      assertLive: vi.fn(),
    } as unknown as Parameters<typeof authorizeToolPermission>[0],
    {} as RuntimePermissionState,
    new AbortController().signal,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  evaluate.mockReturnValue({ action: 'auto_review', risk: 'medium', reason: 'Change', temporaryPathRoots: [] });
});

describe('auto-review admission', () => {
  it('admits an action the approved plan covers, with every host fact holding, by rule and with no model request', async () => {
    assessment = {
      coverage: 'covered',
      facts: [
        { check: 'authorized', state: 'holds', basis: 'Covered.' },
        { check: 'target-matches', state: 'holds', basis: 'Same target.' },
        { check: 'rollback-available', state: 'holds', basis: 'Revertible.' },
      ],
    };
    const reviewer = vi.fn<PermissionReviewer>();
    await expect(flow(reviewer)).resolves.toMatchObject({ action: 'auto_review' });
    expect(reviewer).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ decidedBy: 'auto-review', reviewMethod: 'rule', verdict: 'allow', approved: true }),
    );
  });

  it('refuses a failing host fact by rule and names it, with no model request', async () => {
    assessment = {
      coverage: 'covered',
      facts: [
        { check: 'authorized', state: 'holds', basis: 'Covered.' },
        { check: 'source-bound', state: 'fails', basis: 'Unbound.' },
      ],
    };
    const reviewer = vi.fn<PermissionReviewer>();
    const refusal = await flow(reviewer).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ToolPermissionDenied);
    expect((refusal as ToolPermissionDenied).details).toMatchObject({
      failedChecks: [{ check: 'source-bound', remedy: 'agent' }],
    });
    expect(reviewer).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ decidedBy: 'auto-review', reviewMethod: 'rule', verdict: 'deny' }),
    );
  });

  it('gives the model the host facts it cannot settle and does not resample an unchanged refusal', async () => {
    assessment = { coverage: 'uncovered', facts: [{ check: 'authorized', state: 'unavailable', basis: 'Open.' }] };
    const reviewer = vi.fn<PermissionReviewer>(async () => ({
      verdict: 'deny',
      failedChecks: ['authorized'],
      reason: 'Outside the request.',
    }));
    const admission = turn();
    await expect(flow(reviewer, admission)).rejects.toBeInstanceOf(ToolPermissionDenied);
    expect(reviewer.mock.calls[0]?.[0].facts).toMatchObject({ hostChecks: assessment.facts });
    await expect(flow(reviewer, admission)).rejects.toBeInstanceOf(ToolPermissionDenied);
    expect(reviewer).toHaveBeenCalledOnce();
  });

  describe('when the review cannot decide', () => {
    const undecidable = vi.fn<PermissionReviewer>(async () => ({
      verdict: 'undecidable',
      failedChecks: ['baseline-recorded'],
      reason: 'The baseline cannot be established from text.',
    }));
    const answering = (approved: boolean, cards: AgentEvent[]) => (event: AgentEvent) => {
      if (event.type !== 'approval.requested') return;
      const payload = event.payload as { approvalId: string; reviewer?: string };
      if (payload.reviewer === 'auto_review') return;
      cards.push(event);
      queueMicrotask(() =>
        agentToolApprovalRequestService.answer({
          sessionId: 'session',
          turnId: 'turn',
          approvalId: payload.approvalId,
          approved,
        }),
      );
    };
    beforeEach(() => {
      assessment = { coverage: 'uncovered', facts: [{ check: 'authorized', state: 'unavailable', basis: 'Open.' }] };
    });

    it('asks the user exactly once, naming what it could not establish, and runs the approved call', async () => {
      const cards: AgentEvent[] = [];
      await expect(flow(undecidable, turn(), answering(true, cards))).resolves.toMatchObject({ action: 'auto_review' });
      expect(cards).toHaveLength(1);
      expect(cards[0]?.payload).toMatchObject({
        escalatedFrom: { reviewer: 'auto_review', reviewMethod: 'model', failedChecks: ['baseline-recorded'] },
      });
      expect(audit.record.mock.calls.map(([record]) => [record.decidedBy, record.verdict])).toEqual([
        ['auto-review', 'undecidable'],
        ['user', undefined],
      ]);
      expect(audit.record).toHaveBeenLastCalledWith(expect.objectContaining({ escalatedFrom: 'auto-review' }));
    });

    it("keeps the user's refusal final: the same call is refused again without another card or review", async () => {
      const cards: AgentEvent[] = [];
      const admission = turn();
      await expect(flow(undecidable, admission, answering(false, cards))).rejects.toBeInstanceOf(ToolPermissionDenied);
      assessment = { coverage: 'uncovered', facts: [{ check: 'authorized', state: 'unavailable', basis: 'Changed.' }] };
      await expect(flow(undecidable, admission, answering(true, cards))).rejects.toBeInstanceOf(ToolPermissionDenied);
      expect(cards).toHaveLength(1);
      expect(undecidable).toHaveBeenCalledOnce();
    });
  });
});
