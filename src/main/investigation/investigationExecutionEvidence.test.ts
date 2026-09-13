import { describe, expect, it } from 'vitest';
import { createInvestigationHarness, recordedExperiment, SESSION_ID } from './investigationTestFixtures';
import { RdxExecutionReceipts } from '../tools/RdxExecutionReceipts';
import { seedExecutionEvidence } from './investigationExecutionFixtures';
import { assertExecutionEvidence } from './investigationExecutionEvidence';

function harness() {
  const { resolver } = createInvestigationHarness();
  const store = new RdxExecutionReceipts(resolver, () => 'test-evidence-signing-key');
  const experiment = recordedExperiment({
    experimentId: 'experiment-1', hypothesisClaimId: 'hypothesis-1', baselineWorldStateId: 'baseline',
    variantWorldStateId: 'variant', restoredWorldStateId: 'restored', verifyEvidenceIds: ['evidence-1'],
  });
  return { resolver, store, experiment };
}
describe('native execution evidence', () => {
  it('accepts a signed ordered same-context experiment, including after store recreation', () => {
    const { resolver, store, experiment } = harness();
    experiment.executionEvidence = seedExecutionEvidence(store, SESSION_ID, experiment.experimentId);
    expect(() => assertExecutionEvidence(SESSION_ID, experiment, new RdxExecutionReceipts(resolver, () => 'test-evidence-signing-key'))).not.toThrow();
  });
  it('does not accept booleans without receipts', () => {
    const { store, experiment } = harness();
    expect(() => assertExecutionEvidence(SESSION_ID, experiment, store)).toThrow(/executionEvidence/);
  });
  it.each(['foreign-experiment', 'foreign-context', 'wrong-order', 'missing-intervention', 'rollback-denied', 'wrong-replacement', 'different-measurement'])('%s cannot close', (scenario) => {
    const { store, experiment } = harness();
    experiment.executionEvidence = seedExecutionEvidence(store, SESSION_ID, experiment.experimentId, (records) => {
      if (scenario === 'foreign-experiment') records[0].experimentId = 'old-experiment';
      if (scenario === 'foreign-context') records[2].contextId = 'foreign';
      if (scenario === 'wrong-order') records[2].startedAt = 0;
      if (scenario === 'missing-intervention') records[1].evidence = { kind: 'measurement', method: 'event_durations', conditionsFingerprint: 'b'.repeat(64), values: [2] };
      if (scenario === 'rollback-denied') records[3].exitCode = 1 as 0;
      if (scenario === 'wrong-replacement') records[3].args.replacement_id = 'other';
      if (scenario === 'different-measurement') records[4].operation = 'rd.export.screenshot';
    });
    expect(() => assertExecutionEvidence(SESSION_ID, experiment, store)).toThrow(/RDX_EXECUTION_EVIDENCE_REQUIRED/);
  });
  it('rejects signed content under a different main key and wrong hashes', () => {
    const { resolver, store, experiment } = harness();
    experiment.executionEvidence = seedExecutionEvidence(store, SESSION_ID, experiment.experimentId);
    expect(() => assertExecutionEvidence(SESSION_ID, experiment, new RdxExecutionReceipts(resolver, () => 'forged-key'))).toThrow(/signature/);
    experiment.executionEvidence.baseline.expectedHash = '0'.repeat(64);
    expect(() => assertExecutionEvidence(SESSION_ID, experiment, store)).toThrow();
  });
  it('rejects a hand-written JSON receipt even when the content hash is correct', () => {
    const { resolver, store, experiment } = harness();
    experiment.executionEvidence = seedExecutionEvidence(store, SESSION_ID, experiment.experimentId);
    const fake = resolver.write(SESSION_ID, 'session://tool-outputs/forged.json', JSON.stringify({ ok: true, rollback: true }));
    experiment.executionEvidence.baseline = { uri: fake.uri, expectedHash: fake.hash };
    expect(() => assertExecutionEvidence(SESSION_ID, experiment, store)).toThrow(/unsigned/);
  });
});

it('rejects changed sampling conditions despite identical method and parameters', () => {
  const { store, experiment } = harness();
  experiment.executionEvidence = seedExecutionEvidence(store, SESSION_ID, experiment.experimentId, records => {
    if (records[2].evidence.kind === 'measurement') records[2].evidence.conditionsFingerprint = 'c'.repeat(64);
  });
  expect(() => assertExecutionEvidence(SESSION_ID, experiment, store)).toThrow(/sampling/);
});
