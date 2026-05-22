import fs from 'fs';
import path from 'path';
import type { SessionOutputRecord } from '@shared/types/session';
import { artifactStore } from '../reports/ArtifactStore';
import { storageAdapter } from '../sessions/StorageAdapter';

const ACTION_ARTIFACT_KEYS = [
  'artifactPath',
  'artifact_path',
  'filePath',
  'file_path',
  'imagePath',
  'image_path',
  'outputPath',
  'output_path',
  'reportPath',
  'report_path',
  'savedPath',
  'saved_path',
  'path',
];

function inferMimeType(filePath: string): string | undefined {
  const extension = path.extname(filePath).toLowerCase();
  const table: Record<string, string> = {
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.log': 'text/plain',
    '.json': 'application/json',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.csv': 'text/csv',
  };
  return table[extension];
}

function readFileTimestamps(filePath: string): Pick<SessionOutputRecord, 'sizeBytes' | 'createdAt' | 'updatedAt'> {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return {};
    }
    return {
      sizeBytes: stat.size,
      createdAt: stat.birthtimeMs,
      updatedAt: stat.mtimeMs,
    };
  } catch {
    return {};
  }
}

function parseTimestamp(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') {
    return value;
  }
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function outputKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function addSessionOutput(
  outputs: SessionOutputRecord[],
  seen: Set<string>,
  output: SessionOutputRecord,
): void {
  const key = outputKey(output.filePath);
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  outputs.push(output);
}

function isLikelyFilePath(value: string): boolean {
  return /[\\/]/.test(value) || /\.(md|txt|log|json|html?|png|jpe?g|webp|gif|csv)$/i.test(value);
}

function collectActionArtifactPaths(value: unknown, results = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectActionArtifactPaths(entry, results));
    return results;
  }

  if (!value || typeof value !== 'object') {
    return results;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string' && ACTION_ARTIFACT_KEYS.includes(key) && isLikelyFilePath(entry)) {
      results.add(entry);
      continue;
    }
    if (entry && typeof entry === 'object') {
      collectActionArtifactPaths(entry, results);
    }
  }
  return results;
}

function resolveActionArtifactPath(sessionId: string, runId: string, filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return path.resolve(filePath);
  }
  try {
    return path.resolve(storageAdapter.getRunPath(sessionId, runId), filePath);
  } catch {
    return path.resolve(filePath);
  }
}

export async function buildSessionOutputs(sessionId: string, runId?: string): Promise<SessionOutputRecord[]> {
  const outputs: SessionOutputRecord[] = [];
  const seen = new Set<string>();
  const targetRuns = runId
    ? storageAdapter.listRuns(sessionId).filter((run) => run.runId === runId)
    : storageAdapter.listRuns(sessionId);

  for (const attachment of storageAdapter.listSessionAttachments(sessionId)) {
    addSessionOutput(outputs, seen, {
      id: attachment.attachmentId,
      kind: 'attachment',
      title: attachment.fileName,
      fileName: attachment.fileName,
      filePath: attachment.filePath,
      source: 'session attachment',
      mimeType: attachment.mimeType,
      sizeBytes: attachment.size,
      createdAt: attachment.createdAt,
      updatedAt: attachment.createdAt,
    });
  }

  for (const run of targetRuns) {
    const reportEntries = [
      { id: 'markdown', title: 'report.md', filePath: run.reportPaths?.markdownPath },
      { id: 'json', title: 'report.json', filePath: run.reportPaths?.jsonPath },
      { id: 'html', title: 'visual_report.html', filePath: run.reportPaths?.htmlPath },
    ].filter((entry): entry is { id: string; title: string; filePath: string } => Boolean(entry.filePath));

    for (const report of reportEntries) {
      addSessionOutput(outputs, seen, {
        id: `${run.runId}:report:${report.id}`,
        kind: 'report',
        title: report.title,
        fileName: path.basename(report.filePath),
        filePath: report.filePath,
        source: 'run report',
        runId: run.runId,
        mimeType: inferMimeType(report.filePath),
        ...readFileTimestamps(report.filePath),
      });
    }

    for (const artifact of artifactStore.list(sessionId, run.runId)) {
      addSessionOutput(outputs, seen, {
        id: artifact.artifactId,
        kind: 'artifact',
        title: artifact.title || path.basename(artifact.filePath),
        fileName: path.basename(artifact.filePath),
        filePath: artifact.filePath,
        source: 'artifact store',
        runId: artifact.runId,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
        createdAt: parseTimestamp(artifact.createdAt),
        updatedAt: parseTimestamp(artifact.updatedAt),
      });
    }
  }

  const targetRunIds = new Set(targetRuns.map((run) => run.runId));
  try {
    const actionEvents = await storageAdapter.readActionChain(sessionId);
    for (const event of actionEvents) {
      if (runId && !targetRunIds.has(event.run_id)) {
        continue;
      }
      const artifactPaths = collectActionArtifactPaths(event.payload);
      for (const artifactPath of artifactPaths) {
        const resolvedPath = resolveActionArtifactPath(sessionId, event.run_id, artifactPath);
        addSessionOutput(outputs, seen, {
          id: `${event.event_id}:${outputKey(resolvedPath)}`,
          kind: 'action_artifact',
          title: path.basename(resolvedPath),
          fileName: path.basename(resolvedPath),
          filePath: resolvedPath,
          source: event.event_type,
          runId: event.run_id,
          mimeType: inferMimeType(resolvedPath),
          createdAt: event.ts_ms,
          updatedAt: event.ts_ms,
          ...readFileTimestamps(resolvedPath),
        });
      }
    }
  } catch {
    // Missing action chain is valid for a new session; the right panel simply shows other sources.
  }

  return outputs.sort((left, right) => (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0));
}
