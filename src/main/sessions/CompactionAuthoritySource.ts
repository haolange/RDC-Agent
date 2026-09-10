import { sessionArtifactResolver } from './SessionArtifactResolver';
import { TaskRegistry } from '../agent-runtime/tasks/TaskRegistry';
import { createSessionTaskStore } from '../agent-runtime/tasks/sessionTaskStore';
import { investigationArtifactService } from '../investigation/InvestigationArtifactService';
import { generateShortId } from '@shared/utils/id';
import type { Message } from '../agent-runtime/core/types';
/** App composition assembles domain records; the generic compactor does not invent investigation steps. */
export async function saveCompactionAuthoritySource(sessionId: string, journalMessages: Message[]): Promise<{ uri: string; hash: string; context: string }> {
  const tasks = new TaskRegistry(createSessionTaskStore(sessionId));
  const { tasks: taskRecords, executions } = await tasks.readConsistentSnapshot();
  const artifactRefs = sessionArtifactResolver.list(sessionId)
    .filter(uri => !uri.includes('/compaction-authority/'))
    .map(uri => { const read = sessionArtifactResolver.read(sessionId, uri, { limit: 1 }); return { uri, hash: read.hash }; });
  const investigation = investigationArtifactService.list(sessionId).map(item => {
    const read = investigationArtifactService.readRecord(sessionId, item.artifactId);
    return { manifest: read.manifest, record: read.record, uri: read.contentUri, hash: read.contentHash };
  });
  const authoritative = { tasks: taskRecords, executions, artifactRefs, investigation };
  const context = JSON.stringify(authoritative);
  if (context.length > 96_000) throw new Error('COMPACTION_AUTHORITY_TOO_LARGE: authoritative task/artifact state exceeds the bounded compaction input; retain current context.');
  const uri = `session://tool-outputs/compaction-authority/${generateShortId()}.json`;
  const original = JSON.stringify({ ...authoritative, journalMessages });
  const chunks = Array.from({ length: Math.ceil(original.length / 4000) }, (_, index) => original.slice(index * 4000, (index + 1) * 4000));
  const saved = sessionArtifactResolver.write(sessionId, uri, JSON.stringify({ encoding: 'json-chunks', reconstruction: 'Join chunks without separators, then parse JSON.', chunks }, null, 2), { mimeType: 'application/json' });
  sessionArtifactResolver.read(sessionId, uri, { expectedHash: saved.hash, limit: 1 });
  return { uri, hash: saved.hash, context };
}
export function verifyCompactionAuthoritySource(sessionId: string, ref: { uri: string; hash: string }): void {
  sessionArtifactResolver.read(sessionId, ref.uri, { expectedHash: ref.hash, limit: 1 });
}
