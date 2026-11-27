import { describe, expect, it } from 'vitest';
import {
  decideAdmission,
  registerAdmissionAdapter,
  TurnAdmission,
  type AdmissionAssessment,
  type AdmissionFact,
  type AdmissionRequest,
} from './PermissionAdmission';

const holds = (check: AdmissionFact['check']): AdmissionFact => ({ check, state: 'holds', basis: `${check} holds.` });
const fails = (check: AdmissionFact['check']): AdmissionFact => ({ check, state: 'fails', basis: `${check} fails.` });

describe('admission decision order', () => {
  it('admits a low-risk action without an adapter by rule and sends any other to the model without facts', () => {
    expect(decideAdmission(null, 'low', 'Read inside the project')).toEqual({
      route: 'rule',
      verdict: { verdict: 'allow', failedChecks: [], reason: 'RULE_APPROVED: Read inside the project' },
    });
    expect(decideAdmission(null, 'medium', 'Shell command')).toEqual({ route: 'model', facts: [] });
  });

  it('refuses by rule and names every failing check, whatever the coverage', () => {
    const assessment: AdmissionAssessment = {
      coverage: 'covered',
      facts: [holds('authorized'), fails('source-bound'), fails('rollback-available')],
    };
    expect(decideAdmission(assessment, 'medium', 'x')).toMatchObject({
      route: 'rule',
      verdict: { verdict: 'deny', failedChecks: ['source-bound', 'rollback-available'] },
    });
  });

  it('admits a covered action by rule when every fact holds, and never sends a host fact to the model', () => {
    expect(
      decideAdmission({ coverage: 'covered', facts: [holds('authorized'), holds('target-matches')] }, 'medium', 'x'),
    ).toMatchObject({ route: 'rule', verdict: { verdict: 'allow', failedChecks: [] } });
    // A fact the host cannot verify fails; the model is never asked to settle host state.
    expect(
      decideAdmission({ coverage: 'covered', facts: [holds('authorized'), fails('baseline-recorded')] }, 'low', 'x'),
    ).toMatchObject({ route: 'rule', verdict: { verdict: 'deny', failedChecks: ['baseline-recorded'] } });
  });

  it('never admits an uncovered action by rule, even when every fact it has holds', () => {
    const facts = [holds('source-bound'), holds('identity-current')];
    expect(decideAdmission({ coverage: 'uncovered', facts }, 'low', 'x')).toEqual({ route: 'model', facts });
  });
});

describe('turn admission memory', () => {
  let current: AdmissionAssessment = { coverage: 'uncovered', facts: [holds('identity-current')] };
  registerAdmissionAdapter((request) => (request.toolCall.name === 'memory-probe' ? current : null));
  const turn = new TurnAdmission({
    sessionId: 'session',
    projectId: 'project',
    turnId: 'turn',
    agentId: 'general',
    accessCeiling: 'full',
    approved: null,
    captureReadiness: () => null,
  });
  const request = {
    decision: { action: 'auto_review', risk: 'medium', reason: 'Probe', temporaryPathRoots: [] },
    toolCall: { id: 'call', name: 'memory-probe', arguments: {} },
    tool: { spec: {} },
  } as unknown as AdmissionRequest;
  const refused = { verdict: 'deny', failedChecks: ['authorized'], reason: 'Outside the plan.' } as const;

  it('refuses the same action again without the model until one of its facts changes', () => {
    const first = turn.assess(request, 'a'.repeat(64));
    expect(first.route.route).toBe('model');
    first.settle({ ...refused, failedChecks: [...refused.failedChecks] });
    expect(turn.assess(request, 'a'.repeat(64)).route).toMatchObject({
      route: 'rule',
      verdict: { verdict: 'deny', failedChecks: ['authorized'] },
    });
    expect(turn.assess(request, 'b'.repeat(64)).route.route).toBe('model');
    current = { coverage: 'uncovered', facts: [holds('identity-current'), holds('source-bound')] };
    expect(turn.assess(request, 'a'.repeat(64)).route.route).toBe('model');
  });

  it("keeps the user's refusal final for the turn even after the facts change", () => {
    turn.assess(request, 'c'.repeat(64)).settle({ ...refused, failedChecks: ['authorized'] }, { byUser: true });
    current = { coverage: 'uncovered', facts: [holds('identity-current'), holds('rollback-available')] };
    expect(turn.assess(request, 'c'.repeat(64)).route).toMatchObject({ route: 'rule', verdict: { verdict: 'deny' } });
  });
});
