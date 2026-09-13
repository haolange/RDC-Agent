import type { ExperimentRecord } from '@shared/types/renderdocInvestigation';
import { RdxExecutionReceipts, rdxExecutionReceipts } from '../tools/RdxExecutionReceipts';
import { InvestigationError } from './investigationErrors';

/** Historical reads do not call this gate. Every new close/report completion does. */
export function assertExecutionEvidence(
  sessionId: string, experiment: ExperimentRecord, receipts: RdxExecutionReceipts = rdxExecutionReceipts,
): void {
  if (experiment.status !== 'recorded' && experiment.status !== 'rolled_back') return;
  try {
    const refs = experiment.executionEvidence;
    if (!refs) throw new Error('closed experiments require native executionEvidence');
    const phases = ['baseline', 'intervention', 'variant', 'rollback', 'restored'] as const;
    const records = phases.map((phase) => receipts.read(sessionId, refs[phase]));
    const [baseline, intervention, variant, rollback, restored] = records;
    if (new Set(phases.map((phase) => refs[phase].uri)).size !== phases.length) throw new Error('receipts must be distinct');
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (record.experimentId !== experiment.experimentId || record.contextId !== baseline.contextId
        || record.projectId !== baseline.projectId || record.replaySessionId !== baseline.replaySessionId
        || record.definitionsFingerprint !== baseline.definitionsFingerprint
        || record.leaseVersion !== baseline.leaseVersion || record.contextId === 'default'
        || !record.turnId || !record.toolCallId || record.completedAt < record.startedAt
        || (i > 0 && records[i - 1].completedAt > record.startedAt)) {
        throw new Error('receipt experiment, ownership or execution order mismatch');
      }
    }
    if (baseline.evidence.kind !== 'measurement' || variant.evidence.kind !== 'measurement' || restored.evidence.kind !== 'measurement'
      || baseline.operation !== variant.operation || baseline.operation !== restored.operation
      || baseline.evidence.method !== variant.evidence.method || baseline.evidence.method !== restored.evidence.method
      || baseline.evidence.conditionsFingerprint !== variant.evidence.conditionsFingerprint || baseline.evidence.conditionsFingerprint !== restored.evidence.conditionsFingerprint
      || baseline.argsFingerprint !== variant.argsFingerprint || baseline.argsFingerprint !== restored.argsFingerprint) throw new Error('baseline/variant/restored must use the same measurement and sampling conditions');
    if (intervention.evidence.kind !== 'intervention' || rollback.evidence.kind !== 'rollback'
      || !intervention.evidence.replacementId || intervention.evidence.replacementId !== rollback.evidence.replacementId
      || intervention.result.replacement_id !== intervention.evidence.replacementId
      || rollback.args.replacement_id !== intervention.evidence.replacementId
      || rollback.result.replacement_id !== intervention.evidence.replacementId || rollback.result.reverted !== true) {
      throw new Error('intervention and successful rollback must target the same replacement');
    }
  } catch (error) {
    throw new InvestigationError('INVESTIGATION_INVARIANT_VIOLATION',
      'RDX_EXECUTION_EVIDENCE_REQUIRED: ' + (error instanceof Error ? error.message : String(error)),
      { invariantId: 'S-RDC-01', details: { experimentId: experiment.experimentId } });
  }
}
