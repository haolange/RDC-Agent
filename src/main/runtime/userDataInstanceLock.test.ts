import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireUserDataInstanceLock, readWindowsProcessStartedAt, type UserDataInstanceLockOwner } from './userDataInstanceLock';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

describe('userData instance lock', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-agent-lock-test-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
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

  const lockTime = Date.parse('2026-09-28T14:05:39.106Z');
  const writeDatedLock = () => fs.writeFileSync(path.join(tempRoot, 'instance.lock'), JSON.stringify({
    pid: 212, mode: 'browser', startTs: new Date(lockTime).toISOString(),
  }));

  it('reclaims an old owner whose PID now belongs to a later-born process without signalling that process', () => {
    writeDatedLock();
    const signal = vi.spyOn(process, 'kill').mockReturnValue(true);
    const birth = vi.fn(() => Date.parse('2026-10-20T14:40:10.839Z'));
    const lock = acquireUserDataInstanceLock(tempRoot, owner(313), undefined, birth);
    expect(lock.acquired).toBe(true);
    expect(signal).toHaveBeenCalledExactlyOnceWith(212, 0);
    expect(birth).toHaveBeenCalledExactlyOnceWith(212);
    if (lock.acquired) lock.release();
  });

  it.each([lockTime - 1000, lockTime, null, Number.NaN])('keeps a live or unproven owner for birth time %s', birth => {
    writeDatedLock();
    const before = fs.readFileSync(path.join(tempRoot, 'instance.lock'), 'utf8');
    const lock = acquireUserDataInstanceLock(tempRoot, owner(313), () => true, () => birth);
    expect(lock.acquired).toBe(false);
    expect(fs.readFileSync(path.join(tempRoot, 'instance.lock'), 'utf8')).toBe(before);
  });

  it('does not treat a permission error as owner death when birth time is unavailable', () => {
    writeDatedLock();
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); });
    expect(acquireUserDataInstanceLock(tempRoot, owner(313), undefined, () => null).acquired).toBe(false);
  });

  it('reclaims a process proven absent without querying its birth time', () => {
    writeDatedLock();
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('absent'), { code: 'ESRCH' }); });
    const birth = vi.fn(() => null);
    const lock = acquireUserDataInstanceLock(tempRoot, owner(313), undefined, birth);
    expect(lock.acquired).toBe(true);
    expect(birth).not.toHaveBeenCalled();
    if (lock.acquired) lock.release();
  });

  it('does not probe a legacy timestamp or accept an invalid PID', () => {
    fs.writeFileSync(path.join(tempRoot, 'instance.lock'), JSON.stringify(owner(212)));
    const birth = vi.fn(() => lockTime + 1);
    expect(acquireUserDataInstanceLock(tempRoot, owner(313), () => true, birth).acquired).toBe(false);
    expect(birth).not.toHaveBeenCalled();
    expect(readWindowsProcessStartedAt(-1)).toBeNull();
    expect(readWindowsProcessStartedAt(1.5)).toBeNull();
  });

  it.skipIf(process.platform !== 'win32')('bounds the Windows birth query and fails closed on query failure or invalid output', () => {
    vi.stubEnv('SystemRoot', 'C:\\Windows');
    const query = vi.mocked(execFileSync);
    query.mockReturnValueOnce('2026-10-20T14:40:10.8390740Z\r\n');
    expect(readWindowsProcessStartedAt(212)).toBe(Date.parse('2026-10-20T14:40:10.839Z'));
    expect(query).toHaveBeenLastCalledWith('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      "[System.Diagnostics.Process]::GetProcessById(212).StartTime.ToUniversalTime().ToString('o')",
    ], expect.objectContaining({ timeout: 2000, maxBuffer: 1024, windowsHide: true }));
    query.mockImplementationOnce(() => { throw new Error('access denied'); });
    expect(readWindowsProcessStartedAt(212)).toBeNull();
    query.mockReturnValueOnce('invalid');
    expect(readWindowsProcessStartedAt(212)).toBeNull();
  });
});
