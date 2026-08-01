import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  const owner = (pid: number, mode: UserDataInstanceLockOwner['mode'] = 'browser') => ({
    pid,
    mode,
    startTs: `start-${pid}`,
  });

  it('acquires and releases an unowned canonical userData directory', () => {
    const lock = acquireUserDataInstanceLock(tempRoot, owner(101), () => false);

    expect(lock.acquired).toBe(true);
    expect(fs.existsSync(path.join(tempRoot, 'instance.lock'))).toBe(true);
    if (lock.acquired) lock.release();
    expect(fs.existsSync(path.join(tempRoot, 'instance.lock'))).toBe(false);
  });

  it('fails closed when another live carrier owns the same userData', () => {
    fs.writeFileSync(
      path.join(tempRoot, 'instance.lock'),
      `${JSON.stringify(owner(202, 'desktop'))}\n`,
      'utf8',
    );

    const lock = acquireUserDataInstanceLock(tempRoot, owner(303), (pid) => pid === 202);

    expect(lock).toMatchObject({
      acquired: false,
      owner: { pid: 202, mode: 'desktop' },
    });
  });

  it('fails closed for a live lock written by an older carrier version', () => {
    fs.writeFileSync(
      path.join(tempRoot, 'instance.lock'),
      `${JSON.stringify({ pid: 212, mode: 'browser-qa', startTs: 'legacy-start' })}\n`,
      'utf8',
    );

    const lock = acquireUserDataInstanceLock(tempRoot, owner(313), (pid) => pid === 212);

    expect(lock).toMatchObject({ acquired: false, owner: { pid: 212, mode: 'unknown' } });
  });

  it('reclaims a stale lock without changing userData paths', () => {
    fs.writeFileSync(path.join(tempRoot, 'instance.lock'), `${JSON.stringify(owner(404))}\n`, 'utf8');

    const lock = acquireUserDataInstanceLock(tempRoot, owner(505), () => false);

    expect(lock.acquired).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(path.join(tempRoot, 'instance.lock'), 'utf8')) as { pid: number };
    expect(persisted.pid).toBe(505);
    if (lock.acquired) lock.release();
  });

  it('does not let an old owner release a replacement lock', () => {
    const first = acquireUserDataInstanceLock(tempRoot, owner(606), () => false);
    expect(first.acquired).toBe(true);
    fs.writeFileSync(path.join(tempRoot, 'instance.lock'), `${JSON.stringify(owner(707))}\n`, 'utf8');

    if (first.acquired) first.release();

    expect(fs.existsSync(path.join(tempRoot, 'instance.lock'))).toBe(true);
  });
});
