import { describe, expect, it, vi } from 'vitest';
import { createWin32ProcessBackend, WINDOWS_QUERY_TIMEOUT_MS, windowsPowerShellPath } from './processWin32';
import type { spawnSync } from 'node:child_process';

type SpawnResult = { status: number | null; stdout?: string; error?: Error };

function backendWith(results: SpawnResult[], kill: (pid: number, signal: number | NodeJS.Signals) => boolean = () => true) {
  const spawn = vi.fn((..._args: unknown[]) => results.shift() ?? { status: 1, stdout: '' });
  const backend = createWin32ProcessBackend({
    spawnSync: spawn as unknown as typeof spawnSync,
    kill,
    systemRoot: () => 'C:\\Windows',
  });
  return { spawn, backend };
}

describe('Windows process primitives', () => {
  it('reads the creation FILETIME through a bounded system PowerShell query', () => {
    const { spawn, backend } = backendWith([{ status: 0, stdout: '134056776108390740\r\n' }]);
    expect(backend.readBirth(212)).toBe('windows-filetime:134056776108390740');
    const [command, args, options] = spawn.mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(command).toBe(windowsPowerShellPath('C:\\Windows'));
    expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command']);
    expect(args[3]).toContain('Get-Process -Id 212');
    expect(options).toMatchObject({ timeout: WINDOWS_QUERY_TIMEOUT_MS, windowsHide: true });
  });

  it('reports a missing pid as exited without spawning and fails closed on query errors', () => {
    const missing = backendWith([], () => { throw Object.assign(new Error('absent'), { code: 'ESRCH' }); });
    expect(missing.backend.readBirth(212)).toBeNull();
    expect(missing.spawn).not.toHaveBeenCalled();
    expect(backendWith([{ status: 0, stdout: 'absent' }]).backend.readBirth(212)).toBeNull();
    expect(() => backendWith([{ status: 1, stdout: '' }]).backend.readBirth(212)).toThrow(/PROCESS_QUERY_FAILED/);
    expect(() => backendWith([{ status: 0, stdout: 'invalid' }]).backend.readBirth(212)).toThrow(/PROCESS_QUERY_FAILED/);
    expect(() => backendWith([{ status: null, error: new Error('timeout') }]).backend.readBirth(212)).toThrow('timeout');
    expect(() => windowsPowerShellPath('relative')).toThrow(/PROCESS_QUERY_UNAVAILABLE/);
  });

  it('kills the whole tree with a bounded forced tree kill', () => {
    const { spawn, backend } = backendWith([{ status: 0 }, { status: 128 }]);
    expect(backend.killTree(212, 3000)).toBe(true);
    expect(backend.killTree(212, 3000)).toBe(false);
    expect(spawn.mock.calls[0]?.slice(0, 2)).toEqual(['taskkill', ['/PID', '212', '/T', '/F']]);
    expect(backend.childGroupOptions).toEqual({});
  });
});
