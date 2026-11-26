import { describe, expect, it, vi } from 'vitest';
import { processSupervisor, type ProcessExitInfo, type SupervisedProcess } from '../runtime/ProcessSupervisor';
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

it('removes inherited environment keys when the invocation explicitly unsets them', async () => {
  vi.stubEnv('PYTHONHOME', 'ambient-python');
  vi.stubEnv('PYTHONPATH', 'ambient-modules');
  try {
    const result = await new ShellInvocationService().invoke({
      command: process.execPath,
      args: [
        '-e',
        'console.log(JSON.stringify([Object.hasOwn(process.env,"PYTHONHOME"),Object.hasOwn(process.env,"PYTHONPATH")]))',
      ],
      env: { PYTHONHOME: undefined, PYTHONPATH: undefined },
      timeoutMs: 5000,
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([false, false]);
  } finally {
    vi.unstubAllEnvs();
  }
});

it('retains an unconfirmed process until actual close and keeps it cancellable', async () => {
  let close!: (info: ProcessExitInfo) => void;
  const exit = new Promise<ProcessExitInfo>((resolve) => {
    close = resolve;
  });
  const abort = vi.fn();
  const process = {
    id: 'orphan',
    orphaned: true,
    exit,
    abort,
    stdout: { toString: () => '', receivedByteLength: () => 0, wasTruncated: () => false },
    stderr: { toString: () => '' },
    join: async () => ({ reason: 'unconfirmed_orphan', code: null, signal: null, durationMs: 1 }),
  } as unknown as SupervisedProcess;
  const spawn = vi.spyOn(processSupervisor, 'spawn').mockReturnValue(process);
  try {
    const service = new ShellInvocationService();
    expect(
      await service.invoke({ command: 'native', timeoutMs: null, runId: 'run', contextId: 'owned' }),
    ).toMatchObject({
      processExitReason: 'unconfirmed_orphan',
    });
    expect(service.hasUnconfirmedProcesses()).toBe(true);
    expect(service.hasUnconfirmedProcesses('other')).toBe(false);
    expect(service.hasUnconfirmedProcesses('owned')).toBe(true);
    service.abortRun('run');
    expect(abort).toHaveBeenCalledWith('abort');
    close({ reason: 'exit', code: 1, signal: null, durationMs: 2 });
    await exit;
    expect(service.hasUnconfirmedProcesses()).toBe(false);
  } finally {
    spawn.mockRestore();
  }
});

it('preserves a complete machine result above the default process ring limit', async () => {
  const result = await new ShellInvocationService().invoke({
    command: process.execPath,
    args: ['-e', "process.stdout.write(JSON.stringify({data:'x'.repeat(300000)}))"],
    outputBufferBytes: 8 * 1024 * 1024,
    timeoutMs: 10_000,
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).data).toHaveLength(300000);
  expect(result.stdoutTruncated).toBe(false);
  expect(result.stdoutByteLength).toBe(Buffer.byteLength(result.stdout, 'utf8'));
});

it('streams every stderr line, split multibyte characters included, while still buffering stderr', async () => {
  const lines: string[] = [];
  const script = [
    "const bytes = Buffer.from('第一行\\r\\n二', 'utf8');",
    'process.stderr.write(bytes.subarray(0, 2));',
    "setTimeout(() => { process.stderr.write(bytes.subarray(2)); process.stderr.write('行\\nlast'); }, 20);",
  ].join('\n');
  const result = await new ShellInvocationService().invoke({
    command: process.execPath,
    args: ['-e', script],
    timeoutMs: null,
    onStderrLine: (line) => lines.push(line),
  });
  expect(result.exitCode).toBe(0);
  expect(lines).toEqual(['第一行', '二行', 'last']);
  expect(result.stderr).toBe('第一行\r\n二行\nlast');
});

it('waits for a process without a wall until it closes', async () => {
  const result = await new ShellInvocationService().invoke({
    command: process.execPath,
    args: ['-e', 'setTimeout(() => process.stdout.write("done"), 300)'],
    timeoutMs: null,
  });
  expect(result).toMatchObject({ exitCode: 0, stdout: 'done' });
});
