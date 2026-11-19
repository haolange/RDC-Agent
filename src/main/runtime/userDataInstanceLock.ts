import fs from 'fs';
import path from 'path';
import { probeProcess, type ProcessIdentity, type ProcessLiveness } from '../platform/process';

/** The owner's process identity plus the acquisition stamp; an empty birth was not recorded. */
export interface UserDataInstanceLockOwner extends ProcessIdentity {
  mode: 'browser' | 'desktop' | 'unknown';
  startTs: string;
}

export type UserDataInstanceLockResult =
  | { acquired: true; lockPath: string; release: () => void }
  | { acquired: false; lockPath: string; owner: UserDataInstanceLockOwner | null };

function readLockOwner(lockPath: string): UserDataInstanceLockOwner | null {
  try {
    const value = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Partial<UserDataInstanceLockOwner>;
    if (typeof value.pid !== 'number') return null;
    return {
      pid: value.pid,
      birth: typeof value.birth === 'string' ? value.birth : '',
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
  probe: (identity: ProcessIdentity) => ProcessLiveness = probeProcess,
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
      // Only a proven exit frees the lock: a reused PID has another birth, while an
      // unreadable identity or an unrecorded birth on a live PID stays fail-closed.
      if (existingOwner && probe(existingOwner) !== 'exited') {
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
