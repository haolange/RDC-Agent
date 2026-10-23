import fs from 'fs';
import path from 'path';
import { execFileSync } from 'node:child_process';

export interface UserDataInstanceLockOwner {
  pid: number;
  mode: 'browser' | 'desktop' | 'unknown';
  startTs: string;
}

export type UserDataInstanceLockResult =
  | { acquired: true; lockPath: string; release: () => void }
  | { acquired: false; lockPath: string; owner: UserDataInstanceLockOwner | null };

function defaultIsProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // An inaccessible live process is not evidence of a dead owner.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export function readWindowsProcessStartedAt(pid: number): number | null {
  if (process.platform !== 'win32' || !Number.isSafeInteger(pid) || pid <= 0) return null;
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !path.isAbsolute(systemRoot)) return null;
  try {
    const value = execFileSync(path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
      '-NoProfile', '-NonInteractive', '-Command',
      `[System.Diagnostics.Process]::GetProcessById(${pid}).StartTime.ToUniversalTime().ToString('o')`,
    ], { encoding: 'utf8', windowsHide: true, timeout: 2_000, maxBuffer: 1_024, stdio: ['ignore', 'pipe', 'ignore'] });
    const startedAt = Date.parse(value.trim());
    return Number.isFinite(startedAt) ? startedAt : null;
  } catch {
    return null;
  }
}

function readLockOwner(lockPath: string): UserDataInstanceLockOwner | null {
  try {
    const value = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Partial<UserDataInstanceLockOwner>;
    if (typeof value.pid !== 'number') return null;
    return {
      pid: value.pid,
      mode: value.mode === 'browser' || value.mode === 'desktop' ? value.mode : 'unknown',
      startTs: typeof value.startTs === 'string' ? value.startTs : 'unknown',
    };
  } catch {
    return null;
  }
}

export function acquireUserDataInstanceLock(
  userDataPath: string,
  owner: UserDataInstanceLockOwner,
  isProcessAlive: (pid: number) => boolean = defaultIsProcessAlive,
  readProcessStartedAt: (pid: number) => number | null = readWindowsProcessStartedAt,
): UserDataInstanceLockResult {
  const lockPath = path.join(path.resolve(userDataPath), 'instance.lock');
  const payload = `${JSON.stringify(owner)}\n`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.writeFileSync(lockPath, payload, { encoding: 'utf8', flag: 'wx' });
      return {
        acquired: true,
        lockPath,
        release: () => {
          const currentOwner = readLockOwner(lockPath);
          if (currentOwner?.pid === owner.pid && currentOwner.startTs === owner.startTs) {
            fs.rmSync(lockPath, { force: true });
          }
        },
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;

      const existingOwner = readLockOwner(lockPath);
      if (existingOwner && isProcessAlive(existingOwner.pid)) {
        const parsedLockTime = Date.parse(existingOwner.startTs);
        const lockStartedAt = Number.isFinite(parsedLockTime)
          && new Date(parsedLockTime).toISOString() === existingOwner.startTs ? parsedLockTime : Number.NaN;
        const processStartedAt = Number.isFinite(lockStartedAt) ? readProcessStartedAt(existingOwner.pid) : null;
        // A process born after this lock cannot be its owner: the PID was reused.
        // Unknown birth times and legacy/invalid timestamps remain fail-closed.
        if (processStartedAt === null || !Number.isFinite(processStartedAt) || processStartedAt <= lockStartedAt) {
          return { acquired: false, lockPath, owner: existingOwner };
        }
      }

      try {
        fs.rmSync(lockPath, { force: true });
      } catch (removeError) {
        if ((removeError as NodeJS.ErrnoException).code !== 'ENOENT') throw removeError;
      }
    }
  }

  return { acquired: false, lockPath, owner: readLockOwner(lockPath) };
}
