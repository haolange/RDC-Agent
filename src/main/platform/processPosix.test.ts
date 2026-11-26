import { describe, expect, it, vi } from 'vitest';
import { createPosixProcessBackend } from './processPosix';

const BOOT_ID = '0f6b7c2e-4a51-4f0e-9a0d-2d6c3f6a9b11';

function stat(pid: number, state: string, processGroup: number, startTicks: number): string {
  // comm may contain spaces and parentheses; fields resume after the last ')'.
  const tail = [state, 1, processGroup, ...Array.from({ length: 16 }, () => 0), startTicks, 0, 0];
  return `${pid} (worker (py) x) ${tail.join(' ')}`;
}

function fakeProc(
  files: Record<string, string>,
  kill = vi.fn((_pid: number, _signal: number | NodeJS.Signals): boolean => true),
) {
  const readFile = (filePath: string): string => {
    if (filePath in files) return files[filePath]!;
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  };
  return { kill, backend: createPosixProcessBackend({ procRoot: '/proc', readFile, kill, selfPid: 10 }) };
}

const base = {
  '/proc/self/stat': stat(10, 'S', 10, 50),
  '/proc/10/stat': stat(10, 'S', 10, 50),
  '/proc/sys/kernel/random/boot_id': `${BOOT_ID}\n`,
};

describe('POSIX process primitives', () => {
  it('reads the RDC-Tool Linux birth token and treats zombies and missing pids as exited', () => {
    const { backend } = fakeProc({
      ...base,
      '/proc/42/stat': stat(42, 'S', 42, 987654),
      '/proc/43/stat': stat(43, 'Z', 43, 5),
    });
    expect(backend.readBirth(42)).toBe(`linux-start-ticks:${BOOT_ID}:987654`);
    expect(backend.readBirth(43)).toBeNull();
    expect(backend.readBirth(44)).toBeNull();
    expect(backend.isRunning(42)).toBe(true);
    expect(backend.isRunning(43)).toBe(false);
  });

  it('fails instead of guessing when stat is malformed or /proc is absent', () => {
    expect(() => fakeProc({ ...base, '/proc/42/stat': '42 (x) S 1' }).backend.readBirth(42)).toThrow(
      /PROCESS_QUERY_FAILED/,
    );
    const kill = vi.fn((_pid: number, _signal: number | NodeJS.Signals): boolean => {
      throw Object.assign(new Error('denied'), { code: 'EPERM' });
    });
    const noProc = fakeProc({}, kill).backend;
    expect(() => noProc.readBirth(42)).toThrow(/requires \/proc/);
    expect(noProc.isRunning(42)).toBe(true);
  });

  it('kills a daemon group it leads, but only the pid when it shares the caller group', () => {
    const { backend, kill } = fakeProc({
      ...base,
      '/proc/42/stat': stat(42, 'S', 42, 1),
      '/proc/43/stat': stat(43, 'S', 10, 1),
    });
    expect(backend.killTree(42, 1000)).toBe(true);
    expect(backend.killTree(43, 1000)).toBe(true);
    expect(kill.mock.calls).toEqual([
      [-42, 'SIGKILL'],
      [43, 'SIGKILL'],
    ]);
  });

  it('reads the NUL-separated command line', () => {
    const { backend } = fakeProc({ ...base, '/proc/42/cmdline': 'python\0-m\0rdc_tool.daemon.server\0' });
    expect(backend.readCommandLine(42)).toBe('python -m rdc_tool.daemon.server');
    expect(backend.readCommandLine(44)).toBeNull();
  });
});
