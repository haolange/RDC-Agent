import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRecord } from '@shared/types/session';
import { ProjectInputLifecycle, type ProjectInputLifecycleHost } from './ProjectInputLifecycle';
import { hashCaptureFile } from './replay/captureContentHash';
import type { ReplayHistoryStore } from './replay/ReplayHistoryStore';

vi.mock('electron', () => ({ app: {} }));
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function setup() {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'rdc-input-lifecycle-')); roots.push(rootPath);
  const inputsPath = path.join(rootPath, '.rdx', 'inputs'); await fs.mkdir(inputsPath, { recursive: true });
  const filePath = path.join(inputsPath, 'capture.rdc'); await fs.writeFile(filePath, 'original capture');
  const contentSha256 = (await hashCaptureFile(filePath)).sha256;
  const project: ProjectRecord = { projectId: 'project', name: 'project', rootPath, inputsPath, resourcePath: path.dirname(inputsPath),
    knowledgePath: '', slug: 'project', inputsUpdatedAt: 1, createdAt: 1, updatedAt: 1,
    inputs: [{ inputId: 'capture', fileName: 'capture.rdc', filePath, contentSha256, size: 16,
      discoveredAt: 1, lastModifiedAt: 1, source: 'project_resource' }] };
  const bindings = [{ scope: { projectId: 'project', sessionId: 'session' }, inputId: 'capture', captureHash: contentSha256, interactionLock: null as string | null }];
  const host: ProjectInputLifecycleHost = { getProject: () => project,
    rebind: vi.fn(async () => undefined),
    refresh: vi.fn(async () => []), bindings: () => bindings,
    close: vi.fn(async () => { bindings.splice(0); }), block: async (_p, _i, operation) => operation(), stop: vi.fn(async () => { bindings[0].interactionLock = null; }) };
  const history = { reconcileCaptureReferences: vi.fn(async () => undefined), reconcileInputSelections: vi.fn(async () => undefined) };
  return { project, filePath, host, history, bindings, service: new ProjectInputLifecycle(host, history as unknown as ReplayHistoryStore) };
}

describe('ProjectInputLifecycle', () => {
  it('closes confirmed bindings before deleting only the selected file', async () => {
    const fixture = await setup();
    const protectedFile = path.join(fixture.project.rootPath, 'report.md'); await fs.writeFile(protectedFile, 'keep');
    const prepared = await fixture.service.prepare('project', 'capture');
    expect(prepared.affectedSessionIds).toEqual(['session']);
    const result = await fixture.service.remove('project', 'capture', prepared.approvalIdentity);
    expect(result).toEqual({ success: true, inputs: [], fileDeleted: true, cleanupPending: false });
    expect(fixture.host.close).toHaveBeenCalledBefore(vi.mocked(fixture.host.refresh));
    await expect(fs.stat(fixture.filePath)).rejects.toHaveProperty('code', 'ENOENT');
    expect(await fs.readFile(protectedFile, 'utf8')).toBe('keep');
  });
  it('refuses active work without stopping it', async () => {
    const fixture = await setup(); fixture.bindings[0].interactionLock = 'agent_running';
    await expect(fixture.service.prepare('project', 'capture')).rejects.toThrow('PROJECT_INPUT_BUSY: session');
    expect(fixture.host.stop).not.toHaveBeenCalled();
    expect(await fs.readFile(fixture.filePath, 'utf8')).toBe('original capture');
  });
  it('does not delete a replacement after approval or on close failure', async () => {
    const fixture = await setup();
    const prepared = await fixture.service.prepare('project', 'capture');
    await fs.writeFile(fixture.filePath, 'replacement');
    expect((await fixture.service.remove('project', 'capture', prepared.approvalIdentity)).error).toBe('PROJECT_INPUT_CHANGED_AFTER_APPROVAL');
    expect(fixture.host.close).not.toHaveBeenCalled();
    const next = await fixture.service.prepare('project', 'capture');
    vi.mocked(fixture.host.close).mockRejectedValue(new Error('CLOSE_UNCONFIRMED'));
    const failure = await fixture.service.remove('project', 'capture', next.approvalIdentity);
    expect(failure.fileDeleted).toBe(false);
    expect(await fs.readFile(fixture.filePath, 'utf8')).toBe('replacement');
  });
  it('reports file-deleted and cleanup-pending separately while the confirmed active input index stays empty', async () => {
    const fixture = await setup();
    vi.mocked(fixture.host.refresh).mockImplementation(async () => {
      fixture.project.inputs = [];
      fixture.project.replayCleanupPending = { requestedAt: Date.now(), captureHashes: [], error: 'DISK_UNAVAILABLE' };
      throw new Error('DISK_UNAVAILABLE');
    });
    const prepared = await fixture.service.prepare('project', 'capture');
    const result = await fixture.service.remove('project', 'capture', prepared.approvalIdentity);
    expect(result).toMatchObject({ success: false, fileDeleted: true, cleanupPending: true, inputs: [], error: 'DISK_UNAVAILABLE' });
    expect(fixture.project.inputs).toEqual([]);
    expect(fixture.project.replayCleanupPending?.error).toBe('DISK_UNAVAILABLE');
  });
  it('stops dependent work for external disappearance, then releases bindings and reconciles complete hash references', async () => {
    const fixture = await setup(); fixture.bindings[0].interactionLock = 'agent_running';
    await fixture.service.reconcile(fixture.project, []);
    expect(fixture.host.stop).toHaveBeenCalledWith('session');
    expect(fixture.host.stop).toHaveBeenCalledBefore(vi.mocked(fixture.host.close));
    expect(fixture.history.reconcileCaptureReferences).toHaveBeenCalledWith(fixture.project.rootPath, new Set());
  });
  it('keeps history for duplicate content and refuses partial unverified input scans', async () => {
    const fixture = await setup();
    const duplicate = { ...fixture.project.inputs[0], inputId: 'copy', fileName: 'copy.rdc' };
    await fixture.service.reconcile(fixture.project, [duplicate]);
    expect(fixture.host.rebind).toHaveBeenCalledWith('project', 'capture', duplicate);
    expect(fixture.host.close).not.toHaveBeenCalled();
    expect(fixture.history.reconcileCaptureReferences).toHaveBeenCalledWith(fixture.project.rootPath, new Set([duplicate.contentSha256]));
    fixture.history.reconcileCaptureReferences.mockClear();
    await expect(fixture.service.reconcile(fixture.project, [{ ...duplicate, contentSha256: undefined }])).rejects.toThrow('PROJECT_INPUT_HASH_UNVERIFIED');
    expect(fixture.history.reconcileCaptureReferences).not.toHaveBeenCalled();
  });
});
