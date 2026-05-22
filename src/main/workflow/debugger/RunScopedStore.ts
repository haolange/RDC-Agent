import * as fs from 'fs';
import * as path from 'path';
import { readJsonl, writeJsonl } from '@shared/utils/jsonl';
import { storageAdapter } from '../../sessions/StorageAdapter';

export class RunScopedStore {
  getRunRoot(sessionId: string, runId: string): string {
    return storageAdapter.getRunPath(sessionId, runId);
  }

  readJson<T>(sessionId: string, runId: string, relativePath: string, fallback: T): T {
    const filePath = this.resolveRunPath(sessionId, runId, relativePath);
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
    } catch (error) {
      console.error(`[RunScopedStore] Failed to read ${filePath}`, error);
      return fallback;
    }
  }

  writeJson(sessionId: string, runId: string, relativePath: string, data: unknown): string {
    const filePath = this.resolveRunPath(sessionId, runId, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return filePath;
  }

  readJsonl<T>(sessionId: string, runId: string, relativePath: string): T[] {
    return readJsonl<T>(this.resolveRunPath(sessionId, runId, relativePath));
  }

  writeJsonl<T>(sessionId: string, runId: string, relativePath: string, items: T[]): string {
    const filePath = this.resolveRunPath(sessionId, runId, relativePath);
    writeJsonl(filePath, items);
    return filePath;
  }

  appendJsonl<T>(sessionId: string, runId: string, relativePath: string, item: T): string {
    const items = this.readJsonl<T>(sessionId, runId, relativePath);
    items.push(item);
    return this.writeJsonl(sessionId, runId, relativePath, items);
  }

  resolveRunPath(sessionId: string, runId: string, relativePath: string): string {
    const runRoot = this.getRunRoot(sessionId, runId);
    const targetPath = path.resolve(runRoot, relativePath);
    if (!this.isPathInside(runRoot, targetPath)) {
      throw new Error(`Run-scoped write escaped run directory: ${relativePath}`);
    }
    return targetPath;
  }

  isPathInside(rootPath: string, targetPath: string): boolean {
    const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }
}

export const runScopedStore = new RunScopedStore();
