import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const roots: string[] = [];
vi.mock('electron', () => ({ app: {} }));
vi.mock('../../runtime/AppPathService', () => ({
  appPathService: {
    getLiveReplayPreviewPath: (sessionId: string) => path.join(roots[0], 'live', `${sessionId}.png`),
  },
}));
import { livePreviewToken, ReplayLivePreviewStore } from './ReplayLivePreviewStore';

describe('ReplayLivePreviewStore', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it('overwrites the session live PNG and deletes it on clear', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rdc-live-preview-'));
    roots.push(root);
    const store = new ReplayLivePreviewStore();
    const first = await store.write('session-1', 2, 9, { png: Buffer.from('one'), width: 10, height: 8 });
    expect(first.imagePath).toBe(livePreviewToken(2, 9));
    expect(await store.read('session-1')).toEqual(Buffer.from('one'));
    await store.write('session-1', 3, 11, { png: Buffer.from('two'), width: 12, height: 9 });
    expect(await store.read('session-1')).toEqual(Buffer.from('two'));
    await store.clear('session-1');
    await expect(store.read('session-1')).rejects.toThrow('REPLAY_LIVE_MISSING');
  });
});
