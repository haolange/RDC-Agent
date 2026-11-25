import fs from 'fs';
import path from 'path';
import { z, type ZodType } from 'zod';
import { probeProcess, type ProcessIdentity, type ProcessLiveness } from '../platform/process';

/** The owner's process identity plus the acquisition stamp; an empty birth was not recorded. */
export interface UserDataInstanceLockOwner extends ProcessIdentity {
  mode: 'browser' | 'desktop' | 'unknown';
  startTs: string;
}

export type UserDataInstanceLockResult =
  | { acquired: true; lockPath: string; release: () => void }
  | { acquired: false; lockPath: string; owner: UserDataInstanceLockOwner | null };

/**
 * The lock is judged by its pid. A birth, mode or start stamp the owner did not record (or recorded in a form this
 * build does not know) is read as the type's "not recorded" marker, so such a lock still stays held while its pid lives.
 */
const UserDataInstanceLockOwnerSchema: ZodType<UserDataInstanceLockOwner> = z.object({
  pid: z.number(),
  birth: z.string().catch(''),
  mode: z.enum(['browser', 'desktop', 'unknown']).catch('unknown'),
  startTs: z.string().catch('unknown'),
});

/** The recorded owner, or null when the lock is not JSON or records no pid. */
function readLockOwner(lockPath: string): UserDataInstanceLockOwner | null {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
  const owner = UserDataInstanceLockOwnerSchema.safeParse(value);
  return owner.success ? owner.data : null;
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
