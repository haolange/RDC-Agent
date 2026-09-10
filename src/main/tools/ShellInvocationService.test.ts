import { processSupervisor, type ProcessExitInfo, type SupervisedProcess } from '../runtime/ProcessSupervisor';
import { describe, expect, it, vi } from 'vitest';
import { resolveExitCode, ShellInvocationService } from './ShellInvocationService';

describe('ShellInvocationService exit codes', () => {
  it('preserves explicit exit codes', () => {
    expect(resolveExitCode(0, null)).toBe(0);
    expect(resolveExitCode(2, null)).toBe(2);
  });

  it('maps signal exits to 128+signal instead of success', () => {
    expect(resolveExitCode(null, 'SIGTERM')).toBe(128 + 15);
    expect(resolveExitCode(null, 'SIGKILL')).toBe(128 + 9);
  });

  it('fails closed when code and signal are both missing', () => {
    expect(resolveExitCode(null, null)).toBe(1);
  });
});

it('retains an unconfirmed process until actual close and keeps it cancellable', async () => {
  let close!: (info: ProcessExitInfo) => void;
  const exit = new Promise<ProcessExitInfo>(resolve => { close = resolve; });
  const abort = vi.fn();
  const process = { id: 'orphan', orphaned: true, exit, abort,
    stdout: { toString: () => '' }, stderr: { toString: () => '' },
    join: async () => ({ reason: 'unconfirmed_orphan', code: null, signal: null, durationMs: 1 }),
  } as unknown as SupervisedProcess;
  const spawn = vi.spyOn(processSupervisor, 'spawn').mockReturnValue(process);
  try {
    const service = new ShellInvocationService();
    expect(await service.invoke({ command: 'native', runId: 'run', contextId: 'owned' })).toMatchObject({ processExitReason: 'unconfirmed_orphan' });
    expect(service.hasUnconfirmedProcesses()).toBe(true);
    expect(service.hasUnconfirmedProcesses('other')).toBe(false);
    expect(service.hasUnconfirmedProcesses('owned')).toBe(true);
    service.abortRun('run');
    expect(abort).toHaveBeenCalledWith('abort');
    close({ reason: 'exit', code: 1, signal: null, durationMs: 2 });
    await exit;
    expect(service.hasUnconfirmedProcesses()).toBe(false);
  } finally { spawn.mockRestore(); }
});
