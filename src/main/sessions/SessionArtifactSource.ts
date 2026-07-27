import fs from 'fs';
import path from 'path';
import type { TraceArtifactRecord } from '@shared/types/trace';
import { artifactStore } from '../reports/ArtifactStore';
import { storageAdapter } from './StorageAdapter';

export type SessionArtifactSourceKind = 'attachment' | 'output';

export interface SessionArtifactSource {
  id: string;
  kind: SessionArtifactSourceKind;
  title: string;
  fileName: string;
  filePath: string;
  source: TraceArtifactRecord['source'];
  runId?: string;
  mimeType?: string;
  sizeBytes?: number;
  createdAt?: number;
  updatedAt?: number;
  exists: boolean;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.md': 'text/markdown', '.txt': 'text/plain', '.log': 'text/plain',
  '.json': 'application/json', '.html': 'text/html', '.htm': 'text/html',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.csv': 'text/csv',
};

const inferMimeType = (filePath: string): string | undefined => MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()];

const toTimestamp = (value: string | number | undefined): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

const fileMetadata = (filePath: string): Pick<SessionArtifactSource, 'exists' | 'sizeBytes' | 'createdAt' | 'updatedAt'> => {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { exists: false };
    return { exists: true, sizeBytes: stat.size, createdAt: stat.birthtimeMs, updatedAt: stat.mtimeMs };
  } catch {
    return { exists: false };
  }
};

export const normalizeArtifactPath = (filePath: string): string => {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const categorizeOutput = (input: { kind?: string; mimeType?: string; filePath: string }): TraceArtifactRecord['source'] => {
  const extension = path.extname(input.filePath).toLowerCase();
  if (input.mimeType?.startsWith('image/') || input.kind === 'screenshot') return 'image';
  if (input.kind === 'report') return 'report';
  if (input.kind === 'trace' || input.kind === 'shader' || input.kind === 'capture') return 'evidence';
  if (input.kind === 'data' || input.mimeType === 'application/json' || input.mimeType === 'text/csv' || extension === '.json' || extension === '.csv') return 'data';
  if (input.kind === 'log' || extension === '.log') return 'evidence';
  if (input.kind === 'note' || input.mimeType?.startsWith('text/') || ['.md', '.txt'].includes(extension)) return 'document';
  return 'other';
};

/** Deduplicates output paths while retaining every session input for Task Context. */
export const dedupeSessionArtifactSources = (sources: SessionArtifactSource[]): SessionArtifactSource[] => {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (source.kind === 'attachment') return true;
    const key = normalizeArtifactPath(source.filePath);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const add = (items: SessionArtifactSource[], seen: Set<string>, item: SessionArtifactSource): void => {
  if (item.kind === 'attachment') {
    items.push(item);
    return;
  }
  const key = normalizeArtifactPath(item.filePath);
  if (seen.has(key)) return;
  seen.add(key);
  items.push(item);
};

export async function listSessionArtifactSources(sessionId: string): Promise<SessionArtifactSource[]> {
  const items: SessionArtifactSource[] = [];
  const seen = new Set<string>();
  const session = storageAdapter.readSession(sessionId);
  if (!session) return items;

  for (const attachment of storageAdapter.listSessionAttachments(sessionId)) {
    const metadata = fileMetadata(attachment.filePath);
    items.push({
      id: attachment.attachmentId,
      kind: 'attachment',
      title: attachment.fileName,
      fileName: attachment.fileName,
      filePath: attachment.filePath,
      source: 'document',
      mimeType: attachment.mimeType,
      sizeBytes: metadata.sizeBytes ?? attachment.size,
      createdAt: attachment.createdAt,
      updatedAt: metadata.updatedAt ?? attachment.createdAt,
      exists: metadata.exists,
    });
  }

  for (const run of storageAdapter.listRuns(sessionId)) {
    for (const artifact of artifactStore.list(sessionId, run.runId)) {
      const metadata = fileMetadata(artifact.filePath);
      add(items, seen, {
        id: artifact.artifactId,
        kind: 'output',
        title: artifact.title || path.basename(artifact.filePath),
        fileName: path.basename(artifact.filePath),
        filePath: artifact.filePath,
        source: categorizeOutput({ kind: artifact.kind, mimeType: artifact.mimeType, filePath: artifact.filePath }),
        runId: artifact.runId,
        mimeType: artifact.mimeType || inferMimeType(artifact.filePath),
        sizeBytes: metadata.sizeBytes ?? artifact.sizeBytes,
        createdAt: toTimestamp(artifact.createdAt) ?? metadata.createdAt,
        updatedAt: metadata.updatedAt ?? toTimestamp(artifact.updatedAt) ?? toTimestamp(artifact.createdAt),
        exists: metadata.exists,
      });
    }
  }

  return dedupeSessionArtifactSources(items).sort((left, right) => (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0));
}