import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { acquireDirectoryFileLock, withDirectoryFileLockSync } from './directoryFileLock';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('does not remove a lock whose owner is still being written', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'rdc-lock-initializing-'));
  roots.push(root);
  const lockPath = path.join(root, '.lock');
  writeFileSync(lockPath, '');
  await expect(acquireDirectoryFileLock(root, { lockFileName: '.lock', maxAttempts: 2 }))
    .rejects.toThrow('DIRECTORY_LOCK_TIMEOUT');
  expect(existsSync(lockPath)).toBe(true);
});

it('does not remove an initializing lock in the synchronous path', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'rdc-lock-initializing-sync-'));
  roots.push(root);
  const lockPath = path.join(root, '.lock');
  writeFileSync(lockPath, '');
  expect(() => withDirectoryFileLockSync(root, { lockFileName: '.lock', maxAttempts: 2 }, () => {}))
    .toThrow('DIRECTORY_LOCK_TIMEOUT');
  expect(existsSync(lockPath)).toBe(true);
});

it('does not steal an existing recovery marker', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'rdc-lock-recovery-held-'));
  roots.push(root);
  const dead = spawnSync(process.execPath, ['-e', '']);
  expect(dead.status).toBe(0);
  writeFileSync(path.join(root, '.lock'), JSON.stringify({ pid: dead.pid, createdAt: Date.now() }));
  writeFileSync(path.join(root, '.lock.recovery'), '');
  await expect(acquireDirectoryFileLock(root, { lockFileName: '.lock', maxAttempts: 2 }))
    .rejects.toThrow('DIRECTORY_LOCK_TIMEOUT');
  expect(() => withDirectoryFileLockSync(root, { lockFileName: '.lock', maxAttempts: 2 }, () => {}))
    .toThrow('DIRECTORY_LOCK_TIMEOUT');
  expect(existsSync(path.join(root, '.lock.recovery'))).toBe(true);
});

it('serializes asynchronous and synchronous dead-owner recovery across processes', { timeout: 15_000 }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'rdc-lock-recovery-race-'));
  roots.push(root);
  const dead = spawnSync(process.execPath, ['-e', '']);
  expect(dead.status).toBe(0);
  writeFileSync(path.join(root, '.lock'), JSON.stringify({ pid: dead.pid, createdAt: Date.now() - 1000 }));
  const worker = path.join(root, 'worker.cjs');
  writeFileSync(worker, `
const fs = require('node:fs');
const path = require('node:path');
const dir = process.env.LOCK_TEST_ROOT;
const role = process.env.LOCK_TEST_ROLE;
const marker = name => path.join(dir, name);
const wait = async name => { for(let i=0;i<500;i++){if(fs.existsSync(marker(name)))return;await new Promise(r=>setTimeout(r,10));}throw Error('timeout: '+name); };
require(process.env.LOCK_TEST_REGISTER);
if(role==='A') {
  const unlink = fs.promises.unlink;
  fs.promises.unlink = async function(p) {
    if(p===marker('.lock')) { fs.writeFileSync(marker('a-before-unlink'),''); await wait('allow-a'); }
    return unlink.call(this,p);
  };
}
const { acquireDirectoryFileLock, releaseDirectoryFileLock, withDirectoryFileLockSync } = require(process.env.LOCK_TEST_MODULE);
(async()=>{
  if(role==='A') {
    const held=await acquireDirectoryFileLock(dir,{lockFileName:'.lock',maxAttempts:30});
    fs.writeFileSync(marker('a-acquired'),'');
    await wait('release-a');
    await releaseDirectoryFileLock(held.lockPath);
  } else {
    fs.writeFileSync(marker('b-started'),'');
    withDirectoryFileLockSync(dir,{lockFileName:'.lock',maxAttempts:30},()=>fs.writeFileSync(marker('b-acquired'),''));
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
`);
  const start = (role: string) => spawn(process.execPath, [worker], { windowsHide: true, env: {
    ...process.env, LOCK_TEST_ROOT: root, LOCK_TEST_ROLE: role,
    LOCK_TEST_REGISTER: path.resolve('scripts/register-ts-source.cjs'), LOCK_TEST_MODULE: path.resolve('src/main/sessions/store/directoryFileLock.ts'),
  }, stdio: 'pipe' });
  const waitFor = async (name: string) => {
    for (let i = 0; i < 500; i++) {
      if (existsSync(path.join(root, name))) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${name}`);
  };
  const a = start('A');
  const aDone = new Promise<void>(resolve => a.once('close', () => resolve()));
  let b: ReturnType<typeof start> | undefined;
  let bDone: Promise<void> | undefined;
  try {
    await waitFor('a-before-unlink');
    b = start('B');
    bDone = new Promise<void>(resolve => b!.once('close', () => resolve()));
    await waitFor('b-started');
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(existsSync(path.join(root, 'b-acquired'))).toBe(false);
    writeFileSync(path.join(root, 'allow-a'), '');
    await waitFor('a-acquired');
    expect(existsSync(path.join(root, 'b-acquired'))).toBe(false);
    writeFileSync(path.join(root, 'release-a'), '');
    await waitFor('b-acquired');
  } finally {
    a.kill();
    b?.kill();
    await Promise.all([aDone, bDone]);
  }
});
