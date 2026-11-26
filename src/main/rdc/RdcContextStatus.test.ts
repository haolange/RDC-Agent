import { beforeEach, expect, it, vi } from 'vitest';

const executeCLI = vi.hoisted(() => vi.fn());
vi.mock('./RdcCliInvokerService', () => ({ rdcCliInvokerService: { executeCLI } }));

import { stuckContextStatus } from '../testing/rdcContextStatusFixture';
import { readRdcContextStatus, rdcRecoveryObservation } from './RdcContextStatus';
import { parseRdcNativeResult } from './RdcNativeProtocol';
import { observedRdcProcessIdentity } from './RdcProcessIdentity';

const cli = {
  enabled: true,
  command: 'rdc',
  argsPrefix: [],
  workingDirectory: '',
  env: {},
  noProgressTimeoutMs: 300_000,
};

const envelope = (data: unknown) => ({
  exitCode: 0,
  stdout: JSON.stringify({ ok: true, schema_version: '3.0.0', result_kind: 'rdc_tool.context.status', data }),
  stderr: '',
  duration_ms: 1,
});

beforeEach(() => executeCLI.mockReset());

it('reads the context status through the read-only control command, never an operation call', async () => {
  executeCLI.mockResolvedValue(envelope(stuckContextStatus()));
  const status = await readRdcContextStatus({ contextId: 'ctx', settings: cli });
  expect(executeCLI).toHaveBeenCalledOnce();
  expect(executeCLI).toHaveBeenCalledWith('context', ['status', '--daemon-context', 'ctx'], {
    settings: cli,
    abortSignal: undefined,
  });
  expect(rdcRecoveryObservation(status, 'replay')).toEqual({
    source: 'daemon',
    daemon: { state: 'alive', pid: 10, start_generation: 'windows-filetime:1' },
    worker: { state: 'exited', pid: 11, start_generation: 'windows-filetime:2' },
    replaySession: {
      isLive: false,
      requiresRestart: true,
      workerExit: {
        pid: 11,
        startGeneration: 'windows-filetime:2',
        reason: 'no_progress',
        traceId: 'trace',
        requestId: 'rdc-agent-1',
        stackLogPath: '/state/worker.log',
      },
    },
  });
});

it('rejects a status of another context or with fields outside the public contract', async () => {
  executeCLI.mockResolvedValueOnce(envelope({ ...stuckContextStatus(), context_id: 'other' }));
  await expect(readRdcContextStatus({ contextId: 'ctx', settings: cli })).rejects.toThrow('RDC_CONTEXT_MISMATCH');
  const extra = stuckContextStatus();
  executeCLI.mockResolvedValueOnce(envelope({ ...extra, worker: { ...extra.worker, birth: 'x' } }));
  await expect(readRdcContextStatus({ contextId: 'ctx', settings: cli })).rejects.toThrow('RDC_CLI_PROTOCOL');
});

it('remembers the process identity each successful call reported for its daemon context', () => {
  const identity = {
    status: 'available',
    daemon: { pid: 20, start_generation: 'windows-filetime:5' },
    worker: { pid: 21, start_generation: 'windows-filetime:6' },
  };
  const result = (meta: unknown) => ({
    exitCode: 0,
    stdout: JSON.stringify({ ok: true, result_kind: 'rd.event.list', data: { context_id: 'ctx-observed' }, meta }),
    stderr: '',
    duration_ms: 1,
  });
  parseRdcNativeResult(result({ process_identity: identity }));
  expect(observedRdcProcessIdentity('ctx-observed')).toEqual(identity);
  parseRdcNativeResult(result({ process_identity: { ...identity, worker: { pid: 22, start_generation: 'x' } } }));
  parseRdcNativeResult(result({}));
  expect(observedRdcProcessIdentity('ctx-observed')).toEqual(identity);
});
