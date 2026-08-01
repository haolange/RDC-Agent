import fs from 'fs';
import path from 'path';

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
  } catch {
    return false;
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
        return { acquired: false, lockPath, owner: existingOwner };
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
