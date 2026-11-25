/**
 * Windows process primitives. Birth is the creation FILETIME in the same
 * `windows-filetime:<n>` form RDC-Tool records, read through the system
 * Windows PowerShell with a bounded query.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { AppError } from '@shared/errors/appError';
import type { ProcessBackend } from './processBackend';

export interface Win32ProcessDeps {
  spawnSync: typeof spawnSync;
  kill: (pid: number, signal: number | NodeJS.Signals) => boolean;
  systemRoot: () => string | undefined;
}

/** Bounds a cold Windows PowerShell start; a slower query reads as an unknown identity. */
export const WINDOWS_QUERY_TIMEOUT_MS = 5_000;

const defaultDeps: Win32ProcessDeps = {
  spawnSync,
  kill: (pid, signal) => process.kill(pid, signal),
  systemRoot: () => process.env.SystemRoot,
};

/** System Windows PowerShell 5.1, resolved from %SystemRoot% instead of PATH. */
export function windowsPowerShellPath(systemRoot: string | undefined = process.env.SystemRoot): string {
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) {
    throw new AppError('PROCESS_QUERY_UNAVAILABLE', '%SystemRoot% is not an absolute path.');
  }
  return path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export function createWin32ProcessBackend(deps: Win32ProcessDeps = defaultDeps): ProcessBackend {
  const query = (script: string): { status: number | null; stdout: string } => {
    const result = deps.spawnSync(windowsPowerShellPath(deps.systemRoot()), [
      '-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; ${script}`,
    ], {
      encoding: 'utf8', windowsHide: true, timeout: WINDOWS_QUERY_TIMEOUT_MS, maxBuffer: 64 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.error) throw result.error;
    return { status: result.status, stdout: String(result.stdout ?? '').trim() };
  };

  const isRunning = (pid: number): boolean => {
    try {
      deps.kill(pid, 0);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return false;
      if (code === 'EPERM') return true;
      throw error;
    }
  };

  return {
    isRunning,
    readBirth(pid) {
      if (!isRunning(pid)) return null;
      const result = query(`$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; `
        + "if ($null -eq $p -or $p.HasExited) { 'absent' } else { $p.StartTime.ToFileTimeUtc() }");
      if (result.status !== 0) throw new AppError('PROCESS_QUERY_FAILED', `birth of pid ${pid} is unreadable.`);
      if (result.stdout === 'absent') return null;
      if (!/^[1-9]\d*$/.test(result.stdout)) throw new AppError('PROCESS_QUERY_FAILED', `invalid birth for pid ${pid}.`);
      return `windows-filetime:${result.stdout}`;
    },
    readCommandLine(pid) {
      const result = query(`$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; `
        + 'if ($null -ne $p) { [string]$p.CommandLine }');
      return result.status === 0 && result.stdout ? result.stdout : null;
    },
    killTree(pid, timeoutMs) {
      const result = deps.spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true, stdio: 'ignore', timeout: timeoutMs, killSignal: 'SIGKILL',
      });
      return result.status === 0;
    },
    signalChildTree(pid, _signal, timeoutMs) {
      // taskkill has no graceful process-tree signal; /F is the only bounded abort.
      deps.spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true, stdio: 'ignore', timeout: timeoutMs, killSignal: 'SIGKILL',
      });
    },
    childGroupOptions: {},
  };
}
