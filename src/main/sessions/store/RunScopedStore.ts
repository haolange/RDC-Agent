import * as path from 'path';
import { parseJsonWith, readValidatedSync } from '../../runtime/atomicFile';
import { sessionRecordStore, storageIo } from './sessionStores';
import type { ZodType } from 'zod';

export class RunScopedStore {
  getRunRoot(sessionId: string, runId: string): string {
    return sessionRecordStore.getRunPath(sessionId, runId);
  }

  /** The run-scoped document, or null when it was never written; a damaged document throws `STORAGE_CORRUPT`. */
  readJson<T>(sessionId: string, runId: string, relativePath: string, schema: ZodType<T>): T | null {
    return readValidatedSync(this.resolveRunPath(sessionId, runId, relativePath), parseJsonWith(schema.parse));
  }

  writeJson(sessionId: string, runId: string, relativePath: string, data: unknown): string {
    const filePath = this.resolveRunPath(sessionId, runId, relativePath);
    storageIo.writeJsonAtomic(filePath, data);
    return filePath;
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
