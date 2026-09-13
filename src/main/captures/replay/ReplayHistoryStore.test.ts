import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {} }));
import { ReplayHistoryStore } from './ReplayHistoryStore';
import { hashCaptureFile } from './captureContentHash';
import type { ReplayHistoryScope } from './replayStorageTypes';

const roots: string[] = [];
const image = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const codec = { encode: (bytes: Buffer) => ({ png: bytes, width: 960, height: 540 }) };
const fact = { eventId: 8, operationId: 'operation-1', summary: 'Observed target' };
const hash = 'a'.repeat(64);
async function setup(): Promise<ReplayHistoryScope> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rdc-replay-store-'));
  roots.push(projectRoot);
  return { projectRoot, sessionId: 'session-1', captureSha256: hash };
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('ReplayHistoryStore', () => {
  it('commits duplicate and decreasing event IDs in observation order, deduplicates images, and restores read-only history', async () => {
    const scope = await setup();
    const store = new ReplayHistoryStore({ codec });
    await store.append(scope, fact, image);
    await store.append(scope, { ...fact, operationId: 'operation-2', modificationState: 'modified' }, image);
    await store.append(scope, { ...fact, eventId: 2, operationId: 'operation-3' });
    const reloaded = new ReplayHistoryStore({ codec });
    const page = await reloaded.list(scope, { limit: 2 });
    expect(page.entries.map((entry) => entry.eventId)).toEqual([8, 8]);
    expect(page.nextSequence).toBe(2);
    expect((await reloaded.list(scope, { afterSequence: 2 })).entries[0].eventId).toBe(2);
    expect(await reloaded.readImage(scope, page.entries[0].imageSha256!)).toEqual(image);
    const files = await fs.readdir(path.join(scope.projectRoot, '.rdx', 'replay', scope.sessionId, hash));
    expect(files.filter((file) => file.endsWith('.png'))).toHaveLength(1);
    await expect(fs.stat(path.join(scope.projectRoot, '.rdx', 'replay.lock'))).rejects.toHaveProperty('code', 'ENOENT');
  });

  it('serializes writes across store instances and isolates the same capture across sessions', async () => {
    const scope = await setup();
    const stores = [new ReplayHistoryStore({ codec }), new ReplayHistoryStore({ codec })];
    await Promise.all(Array.from({ length: 12 }, (_, index) => stores[index % 2].append(scope, { ...fact, operationId: String(index) })));
    expect((await stores[0].list(scope)).entries.map((entry) => entry.sequence)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect((await stores[0].list({ ...scope, sessionId: 'another' })).entries).toEqual([]);
  });

  it('fails quota atomically without evicting existing history or publishing a success node', async () => {
    const scope = await setup();
    const store = new ReplayHistoryStore({ codec });
    await store.append(scope, fact, image);
    const limited = new ReplayHistoryStore({ codec, sessionQuotaBytes: 1 });
    await expect(limited.append(scope, { ...fact, operationId: 'rejected' }, Buffer.concat([image, Buffer.from('different')]))).rejects.toThrow('REPLAY_QUOTA_EXCEEDED');
    expect((await store.list(scope)).entries).toHaveLength(1);
  });

  it('enforces project quota across sessions and does not create a capture directory on rejection', async () => {
    const scope = await setup();
    const store = new ReplayHistoryStore({ codec, projectQuotaBytes: 1 });
    await expect(store.append(scope, fact, image)).rejects.toThrow('REPLAY_QUOTA_EXCEEDED');
    await expect(fs.stat(path.join(scope.projectRoot, '.rdx', 'replay'))).rejects.toHaveProperty('code', 'ENOENT');
  });

  it('stores selection without opening anything and safely overwrites it', async () => {
    const scope = await setup();
    const store = new ReplayHistoryStore({ codec });
    await store.saveSelection(scope.projectRoot, scope.sessionId, { inputId: 'capture', captureSha256: hash, deviceId: 'android' });
    await store.saveSelection(scope.projectRoot, scope.sessionId, { inputId: 'capture', captureSha256: hash, deviceId: 'local' });
    expect(await store.readSelection(scope.projectRoot, scope.sessionId)).toEqual({ inputId: 'capture', captureSha256: hash, deviceId: 'local' });
    expect((await store.list(scope)).entries).toEqual([]);
  });

  it('rejects traversal and images outside the committed owning manifest', async () => {
    const scope = await setup();
    const store = new ReplayHistoryStore({ codec });
    await expect(store.list({ ...scope, sessionId: '../outside' })).rejects.toThrow('REPLAY_INVALID_SESSION');
    await expect(store.list({ ...scope, captureSha256: '../file' })).rejects.toThrow('REPLAY_INVALID_HASH');
    await expect(store.readImage(scope, 'b'.repeat(64))).rejects.toThrow('REPLAY_IMAGE_NOT_REFERENCED');
    await expect(store.list(scope, { limit: 501 })).rejects.toThrow('REPLAY_INVALID_PAGE');
  });

  it('refuses linked storage and linked deletion targets without touching external data', async () => {
    const scope = await setup();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'rdc-replay-protected-'));
    roots.push(outside);
    await fs.writeFile(path.join(outside, 'keep.txt'), 'protected');
    await fs.mkdir(path.join(scope.projectRoot, '.rdx'));
    await fs.symlink(outside, path.join(scope.projectRoot, '.rdx', 'replay'), process.platform === 'win32' ? 'junction' : 'dir');
    const store = new ReplayHistoryStore({ codec });
    await expect(store.append(scope, fact)).rejects.toThrow('REPLAY_UNSAFE_LINK');
    await expect(store.clearSession(scope.projectRoot, scope.sessionId)).rejects.toThrow('REPLAY_UNSAFE_LINK');
    expect(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('protected');
    await fs.unlink(path.join(scope.projectRoot, '.rdx', 'replay'));
  });

  it('recovers only uncommitted owned files, while preserving original files and corrupt evidence', async () => {
    const scope = await setup();
    const store = new ReplayHistoryStore({ codec });
    const saved = await store.append(scope, fact, image);
    const captureRoot = path.join(scope.projectRoot, '.rdx', 'replay', scope.sessionId, hash);
    await fs.writeFile(path.join(captureRoot, '.pending-123-abc'), 'partial');
    await fs.writeFile(path.join(captureRoot, `${'b'.repeat(64)}.png`), image);
    await fs.writeFile(path.join(captureRoot, 'unknown.txt'), 'keep');
    await store.recover(scope.projectRoot);
    expect(await fs.readdir(captureRoot)).toEqual(expect.arrayContaining(['manifest.json', `${saved.imageSha256}.png`, 'unknown.txt']));
    expect((await fs.readdir(captureRoot)).length).toBe(3);
    await fs.writeFile(path.join(captureRoot, 'manifest.json'), '{broken');
    await expect(store.recover(scope.projectRoot)).rejects.toThrow('REPLAY_MANIFEST_CORRUPT');
    expect(await fs.readFile(path.join(captureRoot, 'manifest.json'), 'utf8')).toBe('{broken');
  });

  it('detects corrupt committed images and does not replace them', async () => {
    const scope = await setup();
    const store = new ReplayHistoryStore({ codec });
    const saved = await store.append(scope, fact, image);
    await fs.writeFile(path.join(scope.projectRoot, '.rdx', 'replay', scope.sessionId, hash, `${saved.imageSha256}.png`), 'corrupted');
    await expect(store.readImage(scope, saved.imageSha256!)).rejects.toThrow('REPLAY_IMAGE_CORRUPT');
    await expect(store.append(scope, fact, image)).rejects.toThrow('REPLAY_IMAGE_CORRUPT');
  });

  it('keeps hashes still referenced by any input and clears only unreferenced replay data', async () => {
    const scope = await setup();
    const store = new ReplayHistoryStore({ codec });
    const other = { ...scope, captureSha256: 'b'.repeat(64) };
    await store.append(scope, fact, image);
    await store.append(other, fact, image);
    await fs.writeFile(path.join(scope.projectRoot, 'capture.rdc'), 'original');
    await store.reconcileCaptureReferences(scope.projectRoot, new Set([hash]));
    expect((await store.list(scope)).entries).toHaveLength(1);
    expect((await store.list(other)).entries).toHaveLength(0);
    await store.clearSession(scope.projectRoot, scope.sessionId);
    expect(await fs.readFile(path.join(scope.projectRoot, 'capture.rdc'), 'utf8')).toBe('original');
  });

  it('never steals a live process lock', async () => {
    const scope = await setup();
    await fs.mkdir(path.join(scope.projectRoot, '.rdx'));
    const lock = path.join(scope.projectRoot, '.rdx', 'replay.lock');
    await fs.writeFile(lock, JSON.stringify({ pid: process.pid, token: 'another-owner' }));
    await expect(new ReplayHistoryStore({ codec }).append(scope, fact)).rejects.toThrow('REPLAY_STORE_BUSY');
    expect(JSON.parse(await fs.readFile(lock, 'utf8')).token).toBe('another-owner');
  });
  it.each(['writeFile', 'sync'] as const)('cleans only its own lock when initial %s fails and permits retry', async (method) => {
    const scope = await setup();
    const originalOpen = fs.open.bind(fs);
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (String(args[0]).endsWith('replay.lock')) vi.spyOn(handle, method).mockRejectedValueOnce(new Error('INJECTED_DISK_FAILURE'));
      return handle;
    });
    const store = new ReplayHistoryStore({ codec });
    await expect(store.append(scope, fact)).rejects.toThrow('INJECTED_DISK_FAILURE');
    await expect(fs.stat(path.join(scope.projectRoot, '.rdx', 'replay.lock'))).rejects.toHaveProperty('code', 'ENOENT');
    spy.mockRestore();
    expect((await store.append(scope, fact)).saved).toBe(true);
  });
  it('does not delete another token that replaced a failed lock owner', async () => {
    const scope = await setup();
    const target = path.join(scope.projectRoot, '.rdx', 'replay.lock');
    const originalOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (String(args[0]) === target) vi.spyOn(handle, 'sync').mockImplementationOnce(async () => {
        await fs.writeFile(target, JSON.stringify({ pid: process.pid, token: 'other-owner' }));
        throw new Error('INJECTED_DISK_FAILURE');
      });
      return handle;
    });
    await expect(new ReplayHistoryStore({ codec }).append(scope, fact)).rejects.toThrow('INJECTED_DISK_FAILURE');
    expect(JSON.parse(await fs.readFile(target, 'utf8')).token).toBe('other-owner');
  });
  it('recovers interrupted selection writes without touching committed selection or history', async () => {
    const scope = await setup();
    const store = new ReplayHistoryStore({ codec });
    await store.saveSelection(scope.projectRoot, scope.sessionId, { inputId: 'capture', captureSha256: hash });
    await store.append(scope, fact, image);
    const sessionRoot = path.join(scope.projectRoot, '.rdx', 'replay', scope.sessionId);
    await fs.writeFile(path.join(sessionRoot, '.pending-123-abcd'), 'unfinished selection');
    await store.recover(scope.projectRoot);
    await expect(fs.stat(path.join(sessionRoot, '.pending-123-abcd'))).rejects.toHaveProperty('code', 'ENOENT');
    expect(await store.readSelection(scope.projectRoot, scope.sessionId)).toEqual({ inputId: 'capture', captureSha256: hash });
    expect((await store.list(scope)).entries).toHaveLength(1);
  });
  it('prunes selection-only directories after their capture reference disappears', async () => {
    const scope = await setup();
    const store = new ReplayHistoryStore({ codec });
    await store.saveSelection(scope.projectRoot, scope.sessionId, { inputId: 'capture', captureSha256: hash });
    await store.reconcileCaptureReferences(scope.projectRoot, new Set());
    await expect(fs.stat(path.join(scope.projectRoot, '.rdx', 'replay'))).rejects.toHaveProperty('code', 'ENOENT');
  });
  it('rebinds a closed session selection by content when its original input was moved or removed', async () => {
    const scope = await setup();
    const store = new ReplayHistoryStore({ codec });
    await store.saveSelection(scope.projectRoot, scope.sessionId, { inputId: 'removed', captureSha256: hash, deviceId: 'android' });
    await store.reconcileInputSelections(scope.projectRoot, [{ inputId: 'remaining', contentSha256: hash }]);
    expect(await store.readSelection(scope.projectRoot, scope.sessionId)).toEqual({ inputId: 'remaining', captureSha256: hash, deviceId: 'android' });
    await store.reconcileInputSelections(scope.projectRoot, [{ inputId: 'remaining', contentSha256: 'b'.repeat(64) }]);
    expect(await store.readSelection(scope.projectRoot, scope.sessionId)).toBeNull();
  });
});

describe('hashCaptureFile', () => {
  it('hashes original content asynchronously and distinguishes same-name replacements', async () => {
    const scope = await setup();
    const target = path.join(scope.projectRoot, 'capture.rdc');
    await fs.writeFile(target, 'capture bytes');
    const first = await hashCaptureFile(target);
    expect(first.sha256).toBe(createHash('sha256').update('capture bytes').digest('hex'));
    expect(first.size).toBe(13);
    await fs.writeFile(target, 'replacement');
    expect((await hashCaptureFile(target)).sha256).not.toBe(first.sha256);
    await expect(hashCaptureFile(scope.projectRoot)).rejects.toThrow('CAPTURE_UNSAFE_FILE');
  });
});
it('persists failed execution facts with unknown EID without inventing a successful frame', async () => {
  const scope = await setup(); const store = new ReplayHistoryStore({ codec });
  await store.append(scope, { ...fact, eventId: null, failure: 'Observation unavailable', toolCallId: 'failed-tool' });
  const restored = await new ReplayHistoryStore({ codec }).list(scope);
  expect(restored.entries[0]).toMatchObject({ eventId: null, failure: 'Observation unavailable', saved: true });
  expect(restored.entries[0].imageSha256).toBeUndefined();
  await expect(store.append(scope, { ...fact, eventId: null })).rejects.toThrow('INVALID_OBSERVATION');
  await expect(store.append(scope, { ...fact, eventId: null, failure: 'Unknown event' }, image)).rejects.toThrow('INVALID_OBSERVATION');
});
