import type { ExperimentRecord } from '@shared/types/renderdocInvestigation';
import { RdxExecutionReceipts, rdxExecutionReceipts } from '../tools/RdxExecutionReceipts';
import { InvestigationError } from './investigationErrors';

const MEASUREMENTS = new Set([
  'rd.perf.get_frame_timing', 'rd.perf.get_event_durations', 'rd.perf.sample_counters',
  'rd.export.screenshot', 'rd.export.texture',
]);
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
        || record.leaseVersion !== baseline.leaseVersion || record.contextId === 'default'
        || !record.turnId || !record.toolCallId || record.completedAt < record.startedAt
        || (i > 0 && records[i - 1].completedAt > record.startedAt)) {
        throw new Error('receipt experiment, ownership or execution order mismatch');
      }
    }
    if (!MEASUREMENTS.has(baseline.operation) || baseline.operation !== variant.operation
      || baseline.operation !== restored.operation || baseline.argsFingerprint !== variant.argsFingerprint
      || baseline.argsFingerprint !== restored.argsFingerprint) throw new Error('baseline/variant/restored must use the same measurement');
    if (intervention.operation !== 'rd.shader.edit_and_replace' || rollback.operation !== 'rd.shader.revert_replacement'
      || typeof intervention.result.replacement_id !== 'string' || !intervention.result.replacement_id
      || rollback.args.replacement_id !== intervention.result.replacement_id
      || rollback.result.replacement_id !== intervention.result.replacement_id || rollback.result.reverted !== true) {
      throw new Error('intervention and successful rollback must target the same replacement');
    }
  } catch (error) {
    throw new InvestigationError('INVESTIGATION_INVARIANT_VIOLATION',
      'RDX_EXECUTION_EVIDENCE_REQUIRED: ' + (error instanceof Error ? error.message : String(error)),
      { invariantId: 'S-RDC-01', details: { experimentId: experiment.experimentId } });
  }
}
