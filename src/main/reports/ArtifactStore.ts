import * as fs from 'fs';
import * as path from 'path';
import { z, type ZodType } from 'zod';
import { nowIso } from '@shared/utils/id';
import { runScopedStore } from '../sessions/store/RunScopedStore';
import type { ArtifactRecord } from '@shared/types/harness';

export interface ArtifactStoreSnapshot {
  schemaVersion: '1';
  runId: string;
  sessionId: string;
  artifacts: ArtifactRecord[];
  updatedAt: string;
}

const ArtifactRecordSchema: ZodType<ArtifactRecord> = z.object({
  artifactId: z.string(),
  runId: z.string(),
  sessionId: z.string(),
  kind: z.enum(['capture', 'screenshot', 'shader', 'trace', 'report', 'log', 'data', 'note']),
  title: z.string(),
  filePath: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  sha256: z.string().optional(),
  taskId: z.string().optional(),
  evidenceIds: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

const ArtifactStoreSnapshotSchema: ZodType<ArtifactStoreSnapshot> = z.object({
  schemaVersion: z.literal('1'),
  runId: z.string(),
  sessionId: z.string(),
  artifacts: z.array(ArtifactRecordSchema),
  updatedAt: z.string(),
}).strict();

const STORE_PATH = 'artifact_store.json';

export class ArtifactStore {
  read(sessionId: string, runId: string): ArtifactStoreSnapshot {
    return runScopedStore.readJson(sessionId, runId, STORE_PATH, ArtifactStoreSnapshotSchema) ?? {
      schemaVersion: '1',
      runId,
      sessionId,
      artifacts: [],
      updatedAt: nowIso(),
    };
  }

  list(sessionId: string, runId: string): ArtifactRecord[] {
    return this.read(sessionId, runId).artifacts;
  }

  get(sessionId: string, runId: string, artifactId: string): ArtifactRecord | null {
    return this.list(sessionId, runId).find((artifact) => artifact.artifactId === artifactId) ?? null;
  }

  register(sessionId: string, runId: string, record: ArtifactRecord): ArtifactRecord {
    this.assertRunBinding(sessionId, runId, record);
    const scopedPath = this.resolveArtifactPath(sessionId, runId, record.filePath);
    const stat = fs.existsSync(scopedPath) ? fs.statSync(scopedPath) : null;
    const now = nowIso();
    const nextRecord: ArtifactRecord = {
      ...record,
      filePath: scopedPath,
      sizeBytes: stat?.size ?? record.sizeBytes,
      createdAt: record.createdAt || now,
      updatedAt: now,
    };

    const snapshot = this.read(sessionId, runId);
    const existingIndex = snapshot.artifacts.findIndex((artifact) => artifact.artifactId === record.artifactId);
    const artifacts = [...snapshot.artifacts];
    if (existingIndex >= 0) {
      artifacts[existingIndex] = {
        ...artifacts[existingIndex],
        ...nextRecord,
        createdAt: artifacts[existingIndex].createdAt,
      };
    } else {
      artifacts.push(nextRecord);
    }

    this.write({
      ...snapshot,
      artifacts,
      updatedAt: now,
    });

    return existingIndex >= 0 ? artifacts[existingIndex] : nextRecord;
  }

  write(snapshot: ArtifactStoreSnapshot): void {
    runScopedStore.writeJson(snapshot.sessionId, snapshot.runId, STORE_PATH, snapshot);
  }

  resolveArtifactPath(sessionId: string, runId: string, filePath: string): string {
    const runRoot = runScopedStore.getRunRoot(sessionId, runId);
    const resolvedPath = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(runRoot, 'artifacts', filePath);

    if (!runScopedStore.isPathInside(runRoot, resolvedPath)) {
      throw new Error(`Artifact path escaped run directory: ${filePath}`);
    }

    return resolvedPath;
  }

  private assertRunBinding(
    sessionId: string,
    runId: string,
    value: { sessionId: string; runId: string },
  ): void {
    if (value.sessionId !== sessionId || value.runId !== runId) {
      throw new Error(`Run binding mismatch for ${value.sessionId}/${value.runId}`);
    }
  }
}

export const artifactStore = new ArtifactStore();
