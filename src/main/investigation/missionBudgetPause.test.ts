import { rmSync } from 'node:fs';
import { expect, it } from 'vitest';
import { baselineWorld, createInvestigationHarness, sampleCheckpoint, writeDraft } from './investigationTestFixtures';
import { enforceMissionTurnCompletion } from './missionCompletionContract';

it('requires current budget evidence and the exact Mission checkpoint for a General budget pause', () => {
  const { service, sessionPath, sessionId } = createInvestigationHarness();
  try {
    writeDraft(service, 'world_state', baselineWorld('budget-world'));
    const checkpoint = writeDraft(service, 'checkpoint', { ...sampleCheckpoint({ currentWorldStateId: 'budget-world' }), unresolvedFrontier: 'Measure the remaining pass.' });
    const base = { profileId: 'general', completionContract: 'investigation-report' as const, investigationMission: 'debugger' as const,
      sessionId, finalAnswerText: 'Paused with remaining work.', disposition: 'budget_paused' as const, service };
    const ref = { uri: checkpoint.contentUri, hash: checkpoint.contentHash };
    expect(() => enforceMissionTurnCompletion({ ...base, evidenceRefs: [ref] })).toThrow('current root limit');
    expect(() => enforceMissionTurnCompletion({ ...base, evidenceRefs: [{ ...ref, hash: '0'.repeat(64) }],
      budgetEvidence: { kind: 'provider-turns', remaining: 2, limit: 10 } })).toThrow('checkpoint');
    expect(() => enforceMissionTurnCompletion({ ...base, evidenceRefs: [ref],
      budgetEvidence: { kind: 'provider-turns', remaining: 2, limit: 10 } })).not.toThrow();
  } finally { rmSync(sessionPath, { recursive: true, force: true }); }
});
