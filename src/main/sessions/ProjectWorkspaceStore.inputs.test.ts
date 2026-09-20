import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRecord } from '@shared/types/session';
import { ProjectWorkspaceStore } from './ProjectWorkspaceStore';
import type { StorageHost } from './storageHost';

vi.mock('electron', () => ({ app: {} }));
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function setup() {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'rdc-input-scan-')); roots.push(rootPath);
  const inputsPath = path.join(rootPath, '.rdc-agent', 'inputs'); await fs.mkdir(inputsPath, { recursive: true });
  const project: ProjectRecord = { projectId: 'project', name: 'project', rootPath, inputsPath, resourcePath: path.dirname(inputsPath),
    knowledgePath: '', slug: 'project', inputsUpdatedAt: 1, createdAt: 1, updatedAt: 1, inputs: [] };
  const store = new ProjectWorkspaceStore({} as StorageHost);
  vi.spyOn(store, 'getProjectById').mockReturnValue(project);
  const persist = vi.spyOn(store, 'persistProject').mockImplementation(() => undefined);
  const reconcile = vi.fn(async () => undefined);
  store.setInputReconciler(reconcile);
  return { store, project, persist, reconcile };
}

describe('Project input complete scans', () => {
  it('verifies original content before publishing a complete input index', async () => {
    const { store, project, persist, reconcile } = await setup();
    const file = path.join(project.inputsPath, 'capture.rdc'); await fs.writeFile(file, 'capture');
    const inputs = await store.refreshProjectInputs('project');
    expect(inputs[0].contentSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(persist).toHaveBeenCalledBefore(reconcile);
    await fs.writeFile(file, 'replacement');
    expect((await store.refreshProjectInputs('project'))[0].contentSha256).not.toBe(inputs[0].contentSha256);
  });
  it('does not recreate an unavailable project or reconcile its previous captures as missing', async () => {
    const { store, project, persist, reconcile } = await setup();
    await fs.rm(project.rootPath, { recursive: true });
    store.normalizeProjectRecord(project);
    await expect(fs.stat(project.rootPath)).rejects.toHaveProperty('code', 'ENOENT');
    await expect(store.refreshProjectInputs('project')).rejects.toHaveProperty('code', 'ENOENT');
    expect(reconcile).not.toHaveBeenCalled(); expect(persist).not.toHaveBeenCalled();
  });
  it('recognizes a removed inputs directory only when its project root remains accessible', async () => {
    const { store, project, reconcile } = await setup();
    await fs.rm(project.inputsPath, { recursive: true });
    expect(await store.refreshProjectInputs('project')).toEqual([]);
    expect(reconcile).toHaveBeenCalledWith(project, []);
  });
  it('does not turn an incomplete traversal into an empty index', async () => {
    const { store, project, reconcile, persist } = await setup();
    await fs.mkdir(path.join(project.inputsPath, ...Array.from({ length: 10 }, () => 'deep')), { recursive: true });
    await expect(store.refreshProjectInputs('project')).rejects.toThrow('PROJECT_INPUTS_BUDGET_EXCEEDED');
    expect(reconcile).not.toHaveBeenCalled(); expect(persist).not.toHaveBeenCalled();
  });
  it.each(['REPLAY_STORE_BUSY', 'REPLAY_MANIFEST_CORRUPT'])('persists and broadcasts confirmed final deletion despite %s, then retries after restart', async (failure) => {
    const { store, project, persist, reconcile } = await setup();
    project.inputs = [{ inputId: 'removed', fileName: 'removed.rdc', filePath: path.join(project.inputsPath, 'removed.rdc'),
      source: 'project_resource', size: 1, discoveredAt: 1, lastModifiedAt: 1, contentSha256: 'a'.repeat(64) }];
    let durable = structuredClone(project);
    persist.mockImplementation(value => { durable = structuredClone(value); });
    const publish = vi.fn(); store.setInputCommitListener(publish);
    reconcile.mockRejectedValueOnce(new Error(failure));
    await expect(store.refreshProjectInputs('project')).rejects.toThrow(failure);
    expect(publish).toHaveBeenCalledWith('project', []);
    expect(durable.inputs).toEqual([]);
    expect(durable.replayCleanupPending).toMatchObject({ captureHashes: ['a'.repeat(64)], error: failure });
    const restarted = new ProjectWorkspaceStore({} as StorageHost);
    vi.spyOn(restarted, 'getProjectById').mockImplementation(() => structuredClone(durable));
    vi.spyOn(restarted, 'persistProject').mockImplementation(value => { durable = structuredClone(value); });
    const retry = vi.fn(async () => undefined); restarted.setInputReconciler(retry);
    expect(await restarted.refreshProjectInputs('project')).toEqual([]);
    expect(retry).toHaveBeenCalledWith(expect.objectContaining({ inputs: [], replayCleanupPending: expect.any(Object) }), []);
    expect(durable.replayCleanupPending).toBeUndefined();
  });
});
