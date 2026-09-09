import type { ExperimentRecord } from '@shared/types/renderdocInvestigation';
import { RdxExecutionReceipts, rdxDigest, type RdxExecutionReceipt } from '../tools/RdxExecutionReceipts';

/** Signed fixture results model a successful native A-B-A; never a production evidence source. */
export function executionReceiptFixtures(sessionId: string, experimentId: string): RdxExecutionReceipt[] {
  return ['baseline', 'intervention', 'variant', 'rollback', 'restored'].map((phase, index) => {
    const operation = phase === 'intervention' ? 'rd.shader.edit_and_replace'
      : phase === 'rollback' ? 'rd.shader.revert_replacement' : 'rd.perf.get_frame_timing';
    const args: Record<string, unknown> = { session_id: 'replay-fixture', ...(phase === 'rollback' ? { replacement_id: 'replacement-fixture' } : {}) };
    const result: Record<string, unknown> = phase === 'intervention' ? { replacement_id: 'replacement-fixture' }
      : phase === 'rollback' ? { replacement_id: 'replacement-fixture', reverted: true } : { duration_ms: 2 };
    return { schemaVersion: 1, sessionId, projectId: 'project-fixture', turnId: 'turn-fixture', toolCallId: phase,
      experimentId, contextId: 'context-fixture', leaseVersion: 1, replaySessionId: 'replay-fixture',
      operation, args, argsFingerprint: rdxDigest(args), result, resultHash: rdxDigest(result),
      startedAt: index * 10, completedAt: index * 10 + 1, exitCode: 0 };
  });
}
export function seedExecutionEvidence(
  store: RdxExecutionReceipts, sessionId: string, experimentId: string,
  transform?: (records: RdxExecutionReceipt[]) => void,
): NonNullable<ExperimentRecord['executionEvidence']> {
  const records = executionReceiptFixtures(sessionId, experimentId);
  transform?.(records);
  const [baseline, intervention, variant, rollback, restored] = records.map((record) => store.write(record));
  return { baseline, intervention, variant, rollback, restored };
}
