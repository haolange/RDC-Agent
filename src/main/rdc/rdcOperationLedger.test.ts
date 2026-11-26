import { beforeEach, describe, expect, it, vi } from 'vitest';

const { record } = vi.hoisted(() => ({
  record: vi.fn((_event: { outcome?: string; errorCode?: string }) => true),
}));
vi.mock('../runtime/LifecycleLedger', () => ({ lifecycleLedger: { record } }));

import { withProcessExecutionOwner } from '../runtime/ResourceExecutionLifetime';
import { recordRdcOperationStarted, recordRdcOperationTerminal } from './rdcOperationLedger';

const identity = { operation: 'rd.debug.run_to', requestId: 'rdc-agent-1', contextId: 'ctx-1' };
const result = (stdout: string, exitCode = 0) => ({ stdout, stderr: '', exitCode, duration_ms: 1 });

describe('rdc operation ledger events', () => {
  beforeEach(() => record.mockClear());

  it('names the owning session and context when an operation starts', async () => {
    await withProcessExecutionOwner('session-1', async () => recordRdcOperationStarted(identity));
    expect(record).toHaveBeenCalledWith({
      kind: 'rdc_operation',
      phase: 'started',
      sessionId: 'session-1',
      contextId: 'ctx-1',
      operation: 'rd.debug.run_to',
      requestId: 'rdc-agent-1',
    });
  });

  it('records a stuck worker with its exit facts and nothing from the arguments', () => {
    const envelope = {
      ok: false,
      error: {
        code: 'worker_stuck',
        details: { reason: 'no_progress', worker: { pid: 42, start_generation: 'g' }, worker_exit_confirmed: true },
      },
    };
    recordRdcOperationTerminal(identity, result(JSON.stringify(envelope)));
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'terminal',
        outcome: 'stuck',
        errorCode: 'worker_stuck',
        workerExit: { pid: 42, reason: 'no_progress', confirmed: true },
      }),
    );
  });

  it('maps success, cancellation, unreadable output and thrown failures', () => {
    recordRdcOperationTerminal(identity, result(JSON.stringify({ ok: true, error: null })));
    recordRdcOperationTerminal(identity, result(JSON.stringify({ ok: false, error: { code: 'operation_cancelled' } })));
    recordRdcOperationTerminal(identity, result('not json', 124));
    recordRdcOperationTerminal(identity, Object.assign(new Error('gap'), { code: 'RDC_DAEMON_UNRESPONSIVE' }));
    expect(record.mock.calls.map(([event]) => [event.outcome, event.errorCode])).toEqual([
      ['completed', undefined],
      ['cancelled', 'operation_cancelled'],
      ['failed', 'exit_124'],
      ['failed', 'RDC_DAEMON_UNRESPONSIVE'],
    ]);
  });
});
