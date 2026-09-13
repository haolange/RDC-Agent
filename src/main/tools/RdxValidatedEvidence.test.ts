import { expect, it } from 'vitest';
import type { RdxOperationDefinition } from '@shared/types/tool';
import type { ToolExecutionContext } from '../agent-runtime/agent/AgentTool';
import { validateExecutionEvidence, verifyRollbackIdentity } from './RdxValidatedEvidence';
const definition = { evidence_kind: 'measurement' } as RdxOperationDefinition;
const context = {} as ToolExecutionContext;
it.each([{ event_durations: [] }, { event_durations: [{ event_id: 1, duration_us: -1 }] }, { event_durations: [{ event_id: 1, duration_us: Infinity }] }, { perf: { samples: [] } }, { duration_ms: 0 }])('rejects unusable measurement %j', async result => {
  await expect(validateExecutionEvidence(definition, {}, result, context, 'owned', 'experiment')).rejects.toThrow(/EVIDENCE_INVALID/);
});
it('records sampling identity separately from measured values', async () => {
  const first = await validateExecutionEvidence(definition, {}, { event_durations: [{ event_id: 1, duration_us: 3 }] }, context, 'owned', 'experiment');
  const changed = await validateExecutionEvidence(definition, {}, { event_durations: [{ event_id: 2, duration_us: 3 }] }, context, 'owned', 'experiment');
  expect(first.kind).toBe('measurement'); expect(first).not.toEqual(changed);
});
it('requires a verified applied replacement before signing rollback', async () => {
  const intervention = { evidence_kind: 'intervention' } as RdxOperationDefinition;
  const rollback = { evidence_kind: 'rollback' } as RdxOperationDefinition;
  expect(() => verifyRollbackIdentity(rollback, { replacement_id: 'r' }, 'owned', 'e')).toThrow();
  await expect(validateExecutionEvidence(intervention, {}, { replacement_id: 'r', status: 'noop' }, context, 'owned', 'e')).rejects.toThrow();
  await validateExecutionEvidence(intervention, {}, { replacement_id: 'r', status: 'applied', resolved_event_id: 1, replacement: { replacement_id: 'r', status: 'applied' } }, context, 'owned', 'e');
  expect(() => verifyRollbackIdentity(rollback, { replacement_id: 'r' }, 'foreign', 'e')).toThrow();
  await expect(validateExecutionEvidence(rollback, { replacement_id: 'r' }, { replacement_id: 'r', reverted: false }, context, 'owned', 'e')).rejects.toThrow();
  expect(await validateExecutionEvidence(rollback, { replacement_id: 'r' }, { replacement_id: 'r', reverted: true }, context, 'owned', 'e')).toEqual({ kind: 'rollback', replacementId: 'r' });
  expect(() => verifyRollbackIdentity(rollback, { replacement_id: 'r' }, 'owned', 'e')).toThrow();
});

const frameContext = { rdxBinding: { identity: { runtimeContext: { captureFileId: 'capture-owned' } } } } as ToolExecutionContext;
const frameResult = {
  capture_file_id: 'capture-owned', replacement_ids: [],
  frame_timing: { method: 'gpu_timestamp_full_replay', unit: 'seconds', valid: true,
    scope: 'single_queue_complete_replay', range: { first_event_id: 1, last_event_id: 21 },
    samples: [0.001, 0.002], sampling: { samples: 2, warmup: 1 }, includes_initial_contents: false,
    includes_replay_scheduling_gaps: true, original_application_frame_time: false },
};
it('accepts full replay samples and binds method, capture, range and sampling conditions', async () => {
  const first = await validateExecutionEvidence(definition, { samples: 2 }, frameResult, frameContext, 'frame-context', 'e');
  const changed = await validateExecutionEvidence(definition, { samples: 2, warmup: 0 }, {
    ...frameResult, frame_timing: { ...frameResult.frame_timing, sampling: { samples: 2, warmup: 0 } },
  }, frameContext, 'frame-context', 'e');
  expect(first).toMatchObject({ kind: 'measurement', method: 'frame_timing', values: [0.001, 0.002] });
  expect(first).not.toEqual(changed);
});
it.each([
  { capture_file_id: 'foreign' }, { replacement_ids: ['unverified'] },
  { frame_timing: { ...frameResult.frame_timing, unit: 'milliseconds' } },
  { frame_timing: { ...frameResult.frame_timing, method: 'sum_event_durations' } },
  { frame_timing: { ...frameResult.frame_timing, samples: [0, 0.1] } },
  { frame_timing: { ...frameResult.frame_timing, samples: [0.1] } },
  { frame_timing: { ...frameResult.frame_timing, sampling: { samples: 2, warmup: 0 } } },
])('rejects invalid frame evidence %j', async override => {
  await expect(validateExecutionEvidence(definition, { samples: 2 }, { ...frameResult, ...override },
    frameContext, 'frame-context', 'e')).rejects.toThrow(/EVIDENCE_INVALID/);
});
