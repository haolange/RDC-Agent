import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { appPathService } from '../../runtime/AppPathService';
import { assertHash, assertSession, atomicWrite, missing, projectLock, safePath, treeBytes } from './replayFileSafety';
import { replayPngCodec } from './replayPngCodec';
import type { ReplayHistoryEntry, ReplayHistoryOptions, ReplayHistoryScope, ReplayManifest, ReplayObservation, ReplaySelection } from './replayStorageTypes';

export type { ReplayHistoryEntry, ReplayHistoryScope, ReplayObservation, ReplaySelection } from './replayStorageTypes';

/** Main-owned history; callers supply an authorized project/session scope, never renderer paths. */
export class ReplayHistoryStore {
  constructor(private readonly options: ReplayHistoryOptions = {}) {}

  private root(projectRoot: string): string { return appPathService.getProjectRdxPaths(projectRoot).replayPath; }
  private session(projectRoot: string, sessionId: string): string {
    assertSession(sessionId);
    return path.join(this.root(projectRoot), sessionId);
  }
  private capture(scope: ReplayHistoryScope): string {
    assertHash(scope.captureSha256);
    return path.join(this.session(scope.projectRoot, scope.sessionId), scope.captureSha256);
  }

  private async manifest(scope: ReplayHistoryScope): Promise<ReplayManifest> {
    const target = path.join(this.capture(scope), 'manifest.json');
    await safePath(scope.projectRoot, target);
    let text: string;
    try { text = await fs.readFile(target, 'utf8'); } catch (error) {
      if (missing(error)) return { sessionId: scope.sessionId, captureSha256: scope.captureSha256, entries: [] };
      throw error;
    }
    let data: ReplayManifest;
    try { data = JSON.parse(text) as ReplayManifest; } catch { throw new Error('REPLAY_MANIFEST_CORRUPT'); }
    if (data.sessionId !== scope.sessionId || data.captureSha256 !== scope.captureSha256 || !Array.isArray(data.entries)) {
      throw new Error('REPLAY_MANIFEST_CORRUPT');
    }
    data.entries.forEach((entry, index) => {
      if (entry.sequence !== index + 1 || !(entry.eventId === null ? Boolean(entry.failure) : Number.isSafeInteger(entry.eventId) && entry.eventId >= 0)
        || !Number.isFinite(entry.timestamp) || typeof entry.summary !== 'string' || typeof entry.operationId !== 'string'
        || entry.saved !== true || (entry.eventId === null && entry.imageSha256)) throw new Error('REPLAY_MANIFEST_CORRUPT');
      if (entry.imageSha256) assertHash(entry.imageSha256);
    });
    return data;
  }

  async append(scope: ReplayHistoryScope, observation: ReplayObservation, pngBytes?: Buffer): Promise<ReplayHistoryEntry> {
    if (!(observation.eventId === null ? Boolean(observation.failure) : Number.isSafeInteger(observation.eventId) && observation.eventId >= 0) || !observation.operationId
      || typeof observation.summary !== 'string' || observation.summary.length > 8192
      || (observation.timestamp !== undefined && !Number.isFinite(observation.timestamp))
      || (observation.eventId === null && pngBytes)) throw new Error('REPLAY_INVALID_OBSERVATION');
    return projectLock(scope.projectRoot, async () => {
      const root = this.capture(scope);
      await safePath(scope.projectRoot, root);
      const manifest = await this.manifest(scope);
      await this.recoverCapture(scope, manifest);
      const encoded = pngBytes ? (this.options.codec ?? replayPngCodec).encode(pngBytes) : undefined;
      const imageSha256 = encoded ? createHash('sha256').update(encoded.png).digest('hex') : undefined;
      const entry: ReplayHistoryEntry = { ...observation, sequence: manifest.entries.length + 1,
        timestamp: observation.timestamp ?? Date.now(), saved: true,
        ...(encoded ? { imageSha256, width: encoded.width, height: encoded.height } : {}) };
      const next = Buffer.from(JSON.stringify({ ...manifest, entries: [...manifest.entries, entry] }));
      const previous = Buffer.byteLength(JSON.stringify(manifest));
      const imagePath = imageSha256 ? path.join(root, `${imageSha256}.png`) : undefined;
      let additionalImage = encoded?.png.length ?? 0;
      if (imagePath) {
        await safePath(scope.projectRoot, imagePath);
        try {
          const existing = await fs.readFile(imagePath);
          if (createHash('sha256').update(existing).digest('hex') !== imageSha256) throw new Error('REPLAY_IMAGE_CORRUPT');
          additionalImage = 0;
        } catch (error) { if (!missing(error)) throw error; }
      }
      const manifestExists = manifest.entries.length > 0;
      const delta = next.length - (manifestExists ? previous : 0) + additionalImage;
      await this.checkQuota(scope.projectRoot, scope.sessionId, delta);
      await fs.mkdir(root, { recursive: true });
      try {
        if (imagePath && encoded && additionalImage) await atomicWrite(scope.projectRoot, imagePath, encoded.png);
        await atomicWrite(scope.projectRoot, path.join(root, 'manifest.json'), next);
      } catch (error) {
        if (imagePath && additionalImage) await fs.rm(imagePath, { force: true });
        throw error;
      }
      return entry;
    });
  }

  private async checkQuota(projectRoot: string, sessionId: string, delta: number): Promise<void> {
    const sessionBytes = await treeBytes(projectRoot, this.session(projectRoot, sessionId));
    const projectBytes = await treeBytes(projectRoot, this.root(projectRoot));
    if (sessionBytes + delta > (this.options.sessionQuotaBytes ?? 256 * 1024 * 1024)
      || projectBytes + delta > (this.options.projectQuotaBytes ?? 2 * 1024 * 1024 * 1024)) throw new Error('REPLAY_QUOTA_EXCEEDED');
  }

  async list(scope: ReplayHistoryScope, options: { afterSequence?: number; limit?: number } = {}): Promise<{ entries: ReplayHistoryEntry[]; nextSequence?: number }> {
    const { afterSequence = 0, limit = 100 } = options;
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('REPLAY_INVALID_PAGE');
    }
    const manifest = await this.manifest(scope);
    const entries = manifest.entries.filter((entry) => entry.sequence > afterSequence).slice(0, limit);
    const last = entries.at(-1)?.sequence;
    return { entries, ...(last && last < manifest.entries.length ? { nextSequence: last } : {}) };
  }

  async readImage(scope: ReplayHistoryScope, imageSha256: string): Promise<Buffer> {
    assertHash(imageSha256);
    const manifest = await this.manifest(scope);
    if (!manifest.entries.some((entry) => entry.imageSha256 === imageSha256)) throw new Error('REPLAY_IMAGE_NOT_REFERENCED');
    const target = path.join(this.capture(scope), `${imageSha256}.png`);
    await safePath(scope.projectRoot, target);
    const bytes = await fs.readFile(target);
    if (createHash('sha256').update(bytes).digest('hex') !== imageSha256) throw new Error('REPLAY_IMAGE_CORRUPT');
    return bytes;
  }

  async readSelection(projectRoot: string, sessionId: string): Promise<ReplaySelection | null> {
    const target = path.join(this.session(projectRoot, sessionId), 'selection.json');
    await safePath(projectRoot, target);
    try {
      const value = JSON.parse(await fs.readFile(target, 'utf8')) as ReplaySelection;
      if (typeof value.inputId !== 'string' || !value.inputId || (value.deviceId !== undefined && typeof value.deviceId !== 'string')) {
        throw new Error('REPLAY_SELECTION_CORRUPT');
      }
      if (value.captureSha256) assertHash(value.captureSha256);
      return value;
    } catch (error) { if (missing(error)) return null; throw error; }
  }

  async saveSelection(projectRoot: string, sessionId: string, selection: ReplaySelection): Promise<void> {
    if (!selection.inputId || typeof selection.inputId !== 'string') throw new Error('REPLAY_INVALID_SELECTION');
    if (selection.captureSha256) assertHash(selection.captureSha256);
    await projectLock(projectRoot, async () => {
      const root = this.session(projectRoot, sessionId);
      await safePath(projectRoot, root);
      const bytes = Buffer.from(JSON.stringify(selection));
      const target = path.join(root, 'selection.json');
      await safePath(projectRoot, target);
      let previousBytes = 0;
      try { previousBytes = (await fs.stat(target)).size; } catch (error) { if (!missing(error)) throw error; }
      await this.checkQuota(projectRoot, sessionId, bytes.length - previousBytes);
      await fs.mkdir(root, { recursive: true });
      await atomicWrite(projectRoot, path.join(root, 'selection.json'), bytes);
    });
  }

  private async removeTree(projectRoot: string, target: string): Promise<void> {
    await treeBytes(projectRoot, target); // Complete recursive boundary audit before deletion.
    await safePath(projectRoot, target);
    await fs.rm(target, { recursive: true, force: true });
    await this.pruneEmpty(projectRoot, path.dirname(target));
  }
  private async pruneEmpty(projectRoot: string, directory: string): Promise<void> {
    const root = this.root(projectRoot);
    let parent = directory;
    while (parent === root || parent.startsWith(root + path.sep)) {
      await safePath(projectRoot, parent);
      try { await fs.rmdir(parent); } catch (error) {
        if (missing(error)) { parent = path.dirname(parent); continue; }
        if (['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) break;
        throw error;
      }
      parent = path.dirname(parent);
    }
  }
  private async recoverPending(projectRoot: string, directory: string): Promise<void> {
    await safePath(projectRoot, directory);
    for (const file of await fs.readdir(directory)) {
      if (!/^\.pending-\d+-[a-f0-9-]+$/u.test(file)) continue;
      const target = path.join(directory, file);
      await safePath(projectRoot, target);
      if (!(await fs.lstat(target)).isFile()) throw new Error('REPLAY_UNSAFE_ENTRY');
      await fs.unlink(target);
    }
  }
  private async recoverCapture(scope: ReplayHistoryScope, manifest: ReplayManifest): Promise<void> {
    const root = this.capture(scope);
    const referenced = new Set(manifest.entries.flatMap((entry) => entry.imageSha256 ? [`${entry.imageSha256}.png`] : []));
    let files: string[];
    try { files = await fs.readdir(root); } catch (error) { if (missing(error)) return; throw error; }
    for (const file of files) {
      if (/^\.pending-\d+-[a-f0-9-]+$/u.test(file) || (/^[a-f0-9]{64}\.png$/u.test(file) && !referenced.has(file))) {
        const target = path.join(root, file);
        await safePath(scope.projectRoot, target);
        if (!(await fs.lstat(target)).isFile()) throw new Error('REPLAY_UNSAFE_ENTRY');
        await fs.unlink(target);
      }
    }
  }
  /** Recover only uncommitted owned files; a corrupt manifest is never replaced or guessed. */
  async recover(projectRoot: string): Promise<void> {
    await projectLock(projectRoot, async () => {
      const root = this.root(projectRoot);
      await safePath(projectRoot, root);
      let sessions: string[];
      try { sessions = await fs.readdir(root); } catch (error) { if (missing(error)) return; throw error; }
      for (const sessionId of sessions) {
        const sessionRoot = this.session(projectRoot, sessionId);
        await safePath(projectRoot, sessionRoot);
        await this.recoverPending(projectRoot, sessionRoot);
        for (const hash of await fs.readdir(sessionRoot)) {
          if (!/^[a-f0-9]{64}$/u.test(hash)) continue;
          const scope = { projectRoot, sessionId, captureSha256: hash };
          await this.recoverCapture(scope, await this.manifest(scope));
        }
        await this.pruneEmpty(projectRoot, sessionRoot);
      }
    });
  }
  async clearCapture(scope: ReplayHistoryScope): Promise<void> {
    await projectLock(scope.projectRoot, () => this.removeTree(scope.projectRoot, this.capture(scope)));
  }
  async clearSession(projectRoot: string, sessionId: string): Promise<void> {
    await projectLock(projectRoot, () => this.removeTree(projectRoot, this.session(projectRoot, sessionId)));
  }
  async reconcileInputSelections(projectRoot: string, inputs: ReadonlyArray<{ inputId: string; contentSha256?: string }>): Promise<void> {
    await projectLock(projectRoot, async () => {
      const root = this.root(projectRoot);
      await safePath(projectRoot, root);
      let sessions: string[];
      try { sessions = await fs.readdir(root); } catch (error) { if (missing(error)) return; throw error; }
      for (const sessionId of sessions) {
        const selected = await this.readSelection(projectRoot, sessionId);
        if (!selected) continue;
        const current = inputs.find(input => input.inputId === selected.inputId && input.contentSha256 === selected.captureSha256);
        if (current) continue;
        const replacement = selected.captureSha256 ? inputs.filter(input => input.contentSha256 === selected.captureSha256)
          .sort((a, b) => a.inputId.localeCompare(b.inputId))[0] : undefined;
        const target = path.join(this.session(projectRoot, sessionId), 'selection.json');
        await safePath(projectRoot, target);
        if (!replacement) { await fs.unlink(target); await this.pruneEmpty(projectRoot, path.dirname(target)); continue; }
        const bytes = Buffer.from(JSON.stringify({ ...selected, inputId: replacement.inputId }));
        await this.checkQuota(projectRoot, sessionId, bytes.length - (await fs.stat(target)).size);
        await atomicWrite(projectRoot, target, bytes);
      }
    });
  }
  /** Caller must pass all hashes from a complete, successful project input reconciliation. */
  async reconcileCaptureReferences(projectRoot: string, activeHashes: ReadonlySet<string>): Promise<void> {
    activeHashes.forEach(assertHash);
    await projectLock(projectRoot, async () => {
      const root = this.root(projectRoot);
      await safePath(projectRoot, root);
      let sessions: string[];
      try { sessions = await fs.readdir(root); } catch (error) { if (missing(error)) return; throw error; }
      for (const sessionId of sessions) {
        const sessionRoot = this.session(projectRoot, sessionId);
        await safePath(projectRoot, sessionRoot);
        const hashes = await fs.readdir(sessionRoot);
        const selection = await this.readSelection(projectRoot, sessionId);
        if (selection?.captureSha256 && !activeHashes.has(selection.captureSha256)) {
          await fs.unlink(path.join(sessionRoot, 'selection.json'));
        }
        for (const hash of hashes) {
          if (/^[a-f0-9]{64}$/u.test(hash) && !activeHashes.has(hash)) await this.removeTree(projectRoot, path.join(sessionRoot, hash));
        }
        await this.pruneEmpty(projectRoot, sessionRoot);
      }
    });
  }
}

export const replayHistoryStore = new ReplayHistoryStore();
