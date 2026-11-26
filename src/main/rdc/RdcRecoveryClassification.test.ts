import { expect, it } from 'vitest';
import { liveContextStatus, stuckContextStatus } from '../testing/rdcContextStatusFixture';
import { classifyRecovery, RDC_RECOVERY_ATTEMPT_LIMIT } from './RdcRecoveryClassification';
import type { RdcContextStatus } from './RdcContextStatus';

const verified = {
  status: 'available' as const,
  daemon: { pid: 10, start_generation: 'windows-filetime:1' },
  worker: { pid: 11, start_generation: 'windows-filetime:2' },
};
const classify = (status: RdcContextStatus, extra: Partial<Parameters<typeof classifyRecovery>[0]> = {}) =>
  classifyRecovery({ verified, replaySessionId: 'replay', status, deviceActionPending: false, budget: null, ...extra });

/** Worker 11 exited under the watchdog and a later request started worker 12, which never served the replay. */
function replacedStatus(): RdcContextStatus {
  const status = stuckContextStatus();
  return {
    ...status,
    worker: { ...status.worker, state: 'alive', pid: 12, start_generation: 'windows-filetime:3' },
    worker_lifecycle: [
      ...status.worker_lifecycle,
      { event: 'started', pid: 12, start_generation: 'windows-filetime:3', at_ms: 3 },
    ],
  };
}

it('keeps a live replay on the verified daemon and worker', () => {
  expect(classify(liveContextStatus())).toEqual({ decision: 'keep', reason: 'verified-processes-live' });
});

it('rebuilds when every worker change is explained by a confirmed exit of the verified worker', () => {
  const lost = {
    workers: [
      {
        pid: 11,
        start_generation: 'windows-filetime:2',
        reason: 'no_progress',
        traceId: 'trace',
        requestId: 'rdc-agent-1',
        stackLogPath: '/state/worker.log',
      },
    ],
  };
  expect(classify(stuckContextStatus())).toEqual({ decision: 'rebuild', reason: 'worker-exited', lost });
  expect(classify(replacedStatus())).toEqual({ decision: 'rebuild', reason: 'worker-exited', lost });
  // The session's own worker_exit explains the last hop even after the bounded lifecycle dropped its entry.
  expect(classify({ ...stuckContextStatus(), worker_lifecycle: [] })).toMatchObject({ decision: 'rebuild' });
});

it('quarantines a worker change without an exit receipt of exactly the verified worker', () => {
  const unexplained = { decision: 'quarantined', code: 'RDC_RECOVERY_PROCESS_UNEXPLAINED' };
  const noReceipt = replacedStatus();
  noReceipt.worker_lifecycle = noReceipt.worker_lifecycle.filter((entry) => entry.event === 'started');
  noReceipt.sessions[0]!.recovery.worker_exit = null;
  expect(classify(noReceipt)).toMatchObject(unexplained);
  const unconfirmed = stuckContextStatus();
  unconfirmed.worker_lifecycle[1]!.exit_confirmed = false;
  unconfirmed.sessions[0]!.recovery.worker_exit = null;
  expect(classify(unconfirmed)).toMatchObject(unexplained);
  const reused = { ...verified, worker: { pid: 11, start_generation: 'windows-filetime:9' } };
  expect(classify(stuckContextStatus(), { verified: reused })).toMatchObject(unexplained);
  const daemon = stuckContextStatus();
  daemon.daemon = { ...daemon.daemon, pid: 30, start_generation: 'windows-filetime:7' };
  expect(classify(daemon)).toMatchObject(unexplained);
  expect(classify({ ...stuckContextStatus(), source: 'state_files' })).toMatchObject(unexplained);
  // The verified worker still runs, yet the replay needs a restart nobody's exit explains.
  const restart = liveContextStatus();
  restart.sessions[0]!.recovery = {
    ...restart.sessions[0]!.recovery,
    status: 'requires_restart',
    requires_restart: true,
  };
  restart.sessions[0]!.is_live = false;
  expect(classify(restart)).toMatchObject(unexplained);
});

it('stops before reading the chain when the attempt budget is spent or a device action is pending', () => {
  expect(
    classify(stuckContextStatus(), {
      budget: { attempts: RDC_RECOVERY_ATTEMPT_LIMIT, limit: RDC_RECOVERY_ATTEMPT_LIMIT },
    }),
  ).toMatchObject({ decision: 'quarantined', code: 'RDC_RECOVERY_BUDGET_EXHAUSTED' });
  expect(classify(stuckContextStatus(), { budget: { attempts: 1, limit: 2 } })).toMatchObject({ decision: 'rebuild' });
  expect(classify(stuckContextStatus(), { deviceActionPending: true })).toMatchObject({
    decision: 'quarantined',
    code: 'RDC_DEVICE_ACTION_UNCONFIRMED',
  });
});
