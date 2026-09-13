import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ProjectInputRecord, ProjectInputRemoveResult, ProjectRecord } from '@shared/types/session';
import { hashCaptureFile } from './replay/captureContentHash';
import { safePath } from './replay/replayFileSafety';
import type { ReplayHistoryStore } from './replay/ReplayHistoryStore';

export interface ProjectInputLifecycleHost {
  getProject(projectId: string): ProjectRecord | null;
  refresh(projectId: string): Promise<ProjectInputRecord[]>;
  bindings(projectId: string): Array<{ scope: { projectId: string; sessionId: string }; inputId: string | null; captureHash: string | null; interactionLock: string | null }>;
  close(projectId: string, inputId: string): Promise<void>;
  rebind(projectId: string, inputId: string, input: ProjectInputRecord): Promise<void>;
  block<T>(projectId: string, inputId: string, operation: () => Promise<T>): Promise<T>;
  stop(sessionId: string): Promise<void>;
}

export class ProjectInputLifecycle {
  constructor(private readonly host: ProjectInputLifecycleHost, private readonly history: ReplayHistoryStore) {}

  async prepare(projectId: string, inputId: string): Promise<{ project: ProjectRecord; input: ProjectInputRecord; affectedSessionIds: string[]; approvalIdentity: string }> {
    const project = this.host.getProject(projectId);
    if (!project) throw new Error('PROJECT_NOT_FOUND');
    const input = project.inputs.find((item) => item.inputId === inputId);
    if (!input) throw new Error('PROJECT_INPUT_NOT_FOUND');
    const relative = path.relative(project.inputsPath, input.filePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(input.filePath).toLowerCase() !== '.rdc') {
      throw new Error('PROJECT_INPUT_PATH_ESCAPE');
    }
    await safePath(project.rootPath, input.filePath);
    const hashed = await hashCaptureFile(input.filePath);
    const verified = { ...input, contentSha256: hashed.sha256, size: hashed.size, lastModifiedAt: hashed.mtimeMs };
    const bindings = this.host.bindings(projectId).filter((binding) => binding.inputId === inputId);
    const busy = bindings.filter((binding) => binding.interactionLock);
    if (busy.length) throw new Error(`PROJECT_INPUT_BUSY: ${busy.map((item) => item.scope.sessionId).join(', ')}`);
    return { project, input: verified, affectedSessionIds: bindings.map((item) => item.scope.sessionId),
      approvalIdentity: JSON.stringify([projectId, inputId, input.filePath, hashed.sha256]) };
  }

  async remove(projectId: string, inputId: string, approvedIdentity: string): Promise<ProjectInputRemoveResult> {
    let fileDeleted = false;
    try {
      return await this.host.block(projectId, inputId, async () => {
        const prepared = await this.prepare(projectId, inputId);
        if (prepared.approvalIdentity !== approvedIdentity) throw new Error('PROJECT_INPUT_CHANGED_AFTER_APPROVAL');
        await this.host.close(projectId, inputId);
        // Revalidate both path ownership and original content after native handles are confirmed closed.
        const final = await this.prepare(projectId, inputId);
        if (final.approvalIdentity !== approvedIdentity) throw new Error('PROJECT_INPUT_CHANGED_AFTER_APPROVAL');
        await fs.unlink(final.input.filePath);
        fileDeleted = true;
        const inputs = await this.host.refresh(projectId);
        return { success: true, inputs, fileDeleted: true, cleanupPending: false };
      });
    } catch (error) {
      const inputs = this.host.getProject(projectId)?.inputs ?? [];
      return { success: false, inputs: fileDeleted ? inputs.filter((input) => input.inputId !== inputId) : inputs,
        fileDeleted, cleanupPending: fileDeleted, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Called only after a complete scan commits its active index; cleanup has a separate durable pending record. */
  async reconcile(project: ProjectRecord, inputs: ProjectInputRecord[]): Promise<void> {
    if (inputs.some((input) => !input.contentSha256)) throw new Error('PROJECT_INPUT_HASH_UNVERIFIED');
    const byId = new Map(inputs.map((input) => [input.inputId, input]));
    for (const binding of this.host.bindings(project.projectId)) {
      if (!binding.inputId) continue;
      const current = byId.get(binding.inputId);
      if (current && current.contentSha256 === binding.captureHash) continue;
      const moved = !current ? inputs.filter(input => input.contentSha256 === binding.captureHash)
        .sort((a, b) => a.filePath.localeCompare(b.filePath))[0] : undefined;
      if (moved) {
        await this.host.rebind(project.projectId, binding.inputId, moved);
        continue;
      }
      if (binding.interactionLock) await this.host.stop(binding.scope.sessionId);
      await this.host.close(project.projectId, binding.inputId);
    }
    // A same-content input anywhere in the project protects all session history for that hash.
    await this.history.reconcileCaptureReferences(project.rootPath, new Set(inputs.map((input) => input.contentSha256!)));
    await this.history.reconcileInputSelections(project.rootPath, inputs);
  }
}
