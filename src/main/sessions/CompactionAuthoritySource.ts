import { createHash } from 'node:crypto';
import { sessionArtifactResolver } from './SessionArtifactResolver';
import { TaskRegistry } from '../agent-runtime/tasks/TaskRegistry';
import { createSessionTaskStore } from '../agent-runtime/tasks/sessionTaskStore';
import { investigationArtifactService } from '../investigation/InvestigationArtifactService';
import { generateShortId } from '@shared/utils/id';
import type { Message } from '../agent-runtime/core/types';
import { delegatedArtifactOwner, delegatedArtifactReferences, grantDelegatedOutput } from './DelegatedArtifactAccess';
import { getDelegatedTaskScope } from '../agent-runtime/tasks/DelegatedTaskScopes';
import { hashScopedResource } from '../runtime/ScopedResourceResolver';
/** App composition assembles domain records; the generic compactor does not invent investigation steps. */
export async function readCompactionAuthorityState(sessionId: string): Promise<string> {
  const owner = delegatedArtifactOwner(sessionId) ?? sessionId;
  const scope = getDelegatedTaskScope(sessionId);
  if (owner !== sessionId && !scope) throw new Error('COMPACTION_SCOPE_UNAVAILABLE: delegated task scope is required.');
  const tasks = new TaskRegistry(createSessionTaskStore(scope?.ownerSessionId ?? owner));
  const snapshot = await tasks.readConsistentSnapshot();
  const included = new Set(scope ? [scope.rootTaskId] : snapshot.tasks.map(task => task.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const task of snapshot.tasks) if (task.parentTaskId && included.has(task.parentTaskId) && !included.has(task.id)) { included.add(task.id); changed = true; }
  }
  const taskRecords = snapshot.tasks.filter(task => included.has(task.id));
  const executions = snapshot.executions.filter(execution => included.has(execution.taskId));
  const artifactRefs = (delegatedArtifactReferences(sessionId) ?? sessionArtifactResolver.list(owner)
    .filter(uri => !uri.includes('/compaction-authority/'))
    .map(uri => { const read = sessionArtifactResolver.read(owner, uri, { limit: 1 }); return { uri, hash: read.hash }; }))
    .filter(ref => !ref.uri.includes('/compaction-authority/'));
  const investigation = scope ? [] : investigationArtifactService.list(owner).map(item => {
    const read = investigationArtifactService.readRecord(owner, item.artifactId);
    return { manifest: read.manifest, record: read.record, uri: read.contentUri, hash: read.contentHash };
  });
  return JSON.stringify({ tasks: taskRecords, executions, artifactRefs, investigation });
}
export async function saveCompactionAuthoritySource(sessionId: string, journalMessages: Message[]): Promise<{ uri: string; hash: string; context: string; stateHash: string; parts: Array<{ uri: string; hash: string }> }> {
  const owner = delegatedArtifactOwner(sessionId) ?? sessionId;
  const authorityContext = await readCompactionAuthorityState(sessionId);
  const media: Array<{ messageIndex: number; blockIndex: number; uri: string; hash: string; mimeType: string }> = [];
  const recoverableMessages = journalMessages.map((message, messageIndex) => {
    if (typeof message.content === "string") return message;
    const content = message.content.filter(block => block.type !== "thinking").map((block, blockIndex) => {
      if (block.type === "toolCall") { const { providerOutputRef: _ref, ...call } = block; return call; }
      if (block.type !== "image") return block;
      const bytes = Buffer.from(block.data, "base64");
      const hash = createHash("sha256").update(bytes).digest("hex");
      const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" } as Record<string, string>)[block.mimeType];
      if (!ext) throw new Error("COMPACTION_MEDIA_UNSUPPORTED: original image format cannot be archived safely.");
      const uri = `session://tool-outputs/compaction-authority/media-${hash}.${ext}`;
      const saved = sessionArtifactResolver.write(owner, uri, bytes, { mimeType: block.mimeType });
      sessionArtifactResolver.read(owner, uri, { expectedHash: saved.hash, limit: 1 });
      grantDelegatedOutput(sessionId, uri, saved.hash);
      media.push({ messageIndex, blockIndex, uri, hash: saved.hash, mimeType: block.mimeType });
      return { type: "text" as const, text: `Original image: ${uri} sha256:${saved.hash}. Not visually inspected by this text checkpoint; use artifact_read to inspect it.` };
    });
    if (message.role === "assistant") { const { providerState: _state, ...visible } = message; return { ...visible, content }; }
    return { ...message, content };
  });
  const context = JSON.stringify({ ...JSON.parse(authorityContext), media });
  if (context.length > 96_000) throw new Error('COMPACTION_AUTHORITY_TOO_LARGE: authoritative task/artifact state exceeds the bounded compaction input; retain current context.');
  const uri = `session://tool-outputs/compaction-authority/${generateShortId()}.json`;
  const original = JSON.stringify({ ...JSON.parse(context), journalMessages: recoverableMessages });
  const chunks = Array.from({ length: Math.ceil(original.length / 4000) }, (_, index) => original.slice(index * 4000, (index + 1) * 4000));
  const parts: Array<{ uri: string; hash: string }> = [];
  // Bound each artifact by UTF-8 bytes, including media encoded in the original journal.
  let group: string[] = [];
  let size = 0;
  const write = (target: string, content: string) => {
    const saved = sessionArtifactResolver.write(owner, target, content, { mimeType: 'application/json' });
    sessionArtifactResolver.read(owner, target, { expectedHash: saved.hash, limit: 1 });
    grantDelegatedOutput(sessionId, target, saved.hash);
    return { uri: target, hash: saved.hash };
  };
  for (const chunk of chunks) {
    if (size + Buffer.byteLength(JSON.stringify(chunk)) > 1_000_000 && group.length) {
      parts.push(write(uri.replace('.json', `-part-${parts.length}.json`), JSON.stringify({ chunks: group }, null, 2)));
      group = []; size = 0;
    }
    group.push(chunk); size += Buffer.byteLength(JSON.stringify(chunk));
  }
  const body = parts.length
    ? (parts.push(write(uri.replace('.json', `-part-${parts.length}.json`), JSON.stringify({ chunks: group }, null, 2))), { encoding: 'json-chunk-parts', reconstruction: 'Read each part by URI/hash in order, join all chunks without separators, then parse JSON.', parts })
    : { encoding: 'json-chunks', reconstruction: 'Join chunks without separators, then parse JSON.', chunks };
  const saved = write(uri, JSON.stringify(body, null, 2));
  return { ...saved, context, stateHash: hashScopedResource(authorityContext), parts: [...parts, ...media.map(({ uri, hash }) => ({ uri, hash }))] };
}
export function verifyCompactionAuthoritySource(sessionId: string, ref: { uri: string; hash: string; parts?: Array<{ uri: string; hash: string }> }): void {
  const owner = delegatedArtifactOwner(sessionId) ?? sessionId;
  for (const entry of [ref, ...ref.parts ?? []]) sessionArtifactResolver.read(owner, entry.uri, { expectedHash: entry.hash, limit: 1 });
}
