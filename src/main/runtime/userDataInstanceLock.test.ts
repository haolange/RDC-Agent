import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentProcessIdentity, type ProcessIdentity, type ProcessLiveness } from '../platform/process';
import { acquireUserDataInstanceLock, type UserDataInstanceLockOwner } from './userDataInstanceLock';

describe('userData instance lock', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-agent-lock-test-'));
  });

  afterEach(() => {
    const resolvedTemp = path.resolve(tempRoot);
    const expectedPrefix = `${path.resolve(os.tmpdir())}${path.sep}rdc-agent-lock-test-`;
    if (resolvedTemp.startsWith(expectedPrefix)) {
      fs.rmSync(resolvedTemp, { recursive: true, force: true });
    }
  });

  const owner = (pid: number, mode: UserDataInstanceLockOwner['mode'] = 'browser'): UserDataInstanceLockOwner => ({
    pid,
    birth: `birth-${pid}`,
    mode,
    startTs: `start-${pid}`,
  });
  const lockFile = () => path.join(tempRoot, 'instance.lock');
  const exited = (): ProcessLiveness => 'exited';

  it('acquires and releases an unowned canonical userData directory', () => {
    const lock = acquireUserDataInstanceLock(tempRoot, owner(101), exited);

    expect(lock.acquired).toBe(true);
    expect(JSON.parse(fs.readFileSync(lockFile(), 'utf8'))).toMatchObject({ pid: 101, birth: 'birth-101' });
    if (lock.acquired) lock.release();
    expect(fs.existsSync(lockFile())).toBe(false);
  });

  it('fails closed when another live carrier owns the same userData', () => {
    fs.writeFileSync(lockFile(), `${JSON.stringify(owner(202, 'desktop'))}\n`, 'utf8');
    const probe = vi.fn((identity: ProcessIdentity): ProcessLiveness => (identity.pid === 202 ? 'alive' : 'exited'));

    const lock = acquireUserDataInstanceLock(tempRoot, owner(303), probe);

    expect(lock).toMatchObject({ acquired: false, owner: { pid: 202, mode: 'desktop' } });
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ pid: 202, birth: 'birth-202' }));
  });

  it('keeps a lock whose owner identity cannot be read', () => {
    fs.writeFileSync(lockFile(), JSON.stringify(owner(212)), 'utf8');
    const before = fs.readFileSync(lockFile(), 'utf8');
    expect(acquireUserDataInstanceLock(tempRoot, owner(313), () => 'unknown').acquired).toBe(false);
    expect(fs.readFileSync(lockFile(), 'utf8')).toBe(before);
  });

  it('judges a lock without a recorded birth by its pid alone', () => {
    fs.writeFileSync(lockFile(), JSON.stringify({ pid: 212, mode: 'browser-qa', startTs: 'legacy-start' }), 'utf8');
    const probe = vi.fn((): ProcessLiveness => 'alive');

    const lock = acquireUserDataInstanceLock(tempRoot, owner(313), probe);

    expect(lock).toMatchObject({ acquired: false, owner: { pid: 212, mode: 'unknown' } });
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ pid: 212, birth: '' }));
  });

  it('reclaims a stale lock without changing userData paths', () => {
    fs.writeFileSync(lockFile(), `${JSON.stringify(owner(404))}\n`, 'utf8');

    const lock = acquireUserDataInstanceLock(tempRoot, owner(505), exited);

    expect(lock.acquired).toBe(true);
    expect((JSON.parse(fs.readFileSync(lockFile(), 'utf8')) as { pid: number }).pid).toBe(505);
    if (lock.acquired) lock.release();
  });

  it.skipIf(!currentProcessIdentity().birth)('reclaims a lock whose live PID now belongs to a process with another birth', () => {
    const self = currentProcessIdentity();
    fs.writeFileSync(lockFile(), JSON.stringify({ ...owner(self.pid), birth: `${self.birth}0` }), 'utf8');

    const lock = acquireUserDataInstanceLock(tempRoot, owner(313));

    expect(lock.acquired).toBe(true);
    if (lock.acquired) lock.release();
  });

  it('does not let an old owner release a replacement lock', () => {
    const first = acquireUserDataInstanceLock(tempRoot, owner(606), exited);
    expect(first.acquired).toBe(true);
    fs.writeFileSync(lockFile(), `${JSON.stringify(owner(707))}\n`, 'utf8');

    if (first.acquired) first.release();

    expect(fs.existsSync(lockFile())).toBe(true);
  });
});
