import { beforeEach, describe, expect, it, vi } from 'vitest';

const audit = vi.hoisted(() => ({ record: vi.fn() }));
const evaluate = vi.hoisted(() => vi.fn());
vi.mock('../../runtime/AuditLog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../runtime/AuditLog')>()),
  auditLog: audit,
}));
vi.mock('./AgentPermissionPolicy', () => ({ agentPermissionPolicyService: { evaluate } }));

import { registerAdmissionAdapter, TurnAdmission, type AdmissionAssessment } from './PermissionAdmission';
import { authorizeToolPermission, ToolPermissionDenied } from './ToolPermissionAuthorization';
import type { PermissionReviewer } from './PermissionReviewRuntime';
import type { RuntimePermissionState } from '@shared/types/runtimePermission';

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
function flow(reviewer: PermissionReviewer, admission = turn()) {
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
});
