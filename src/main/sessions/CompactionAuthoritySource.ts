import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { sessionArtifactResolver } from './SessionArtifactResolver';
import { TaskRegistry } from '../agent-runtime/tasks/TaskRegistry';
import type { TaskExecutionRecord, TaskRecord } from '../agent-runtime/tasks/TaskContracts';
import { createSessionTaskStore } from '../agent-runtime/tasks/sessionTaskStore';
import { investigationArtifactService } from '../investigation/InvestigationArtifactService';
import { generateShortId } from '@shared/utils/id';
import type { AgentMessage, Message } from '../agent-runtime/core/types';
import { delegatedArtifactOwner, delegatedArtifactReferences, grantDelegatedOutput } from './DelegatedArtifactAccess';
import { getDelegatedTaskScope } from '../agent-runtime/tasks/DelegatedTaskScopes';
import { hashScopedResource } from '../runtime/ScopedResourceResolver';
import type { InvestigationArtifactManifest } from '@shared/types/renderdocInvestigation';

interface AuthorityState {
  tasks: TaskRecord[];
  executions: TaskExecutionRecord[];
  artifactRefs: Array<{ uri: string; hash: string }>;
  investigation: Array<{ manifest: InvestigationArtifactManifest; record: unknown; uri: string; hash: string }>;
}

const AUTHORITY_CONTEXT_CHAR_LIMIT = 96_000;

type ArchivedMedia = { messageIndex: number; blockIndex: number; uri: string; hash: string; mimeType: string };

/** The archived journal is a portable projection; image bytes live in verified sidecars. */
export function projectCompactionJournalMessages(messages: AgentMessage[], onMedia?: (entry: ArchivedMedia, bytes: Buffer) => void): AgentMessage[] {
  return messages.map((message, messageIndex) => {
    if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'toolResult') return message;
    const typed = message as Message;
    if (typeof typed.content === 'string') return typed;
    const content = typed.content.filter(block => block.type !== 'thinking').map((block, blockIndex) => {
      if (block.type === 'toolCall') { const { providerOutputRef: _ref, ...call } = block; return call; }
      if (block.type !== 'image') return block;
      const bytes = Buffer.from(block.data, 'base64');
      const hash = createHash('sha256').update(bytes).digest('hex');
      const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' } as Record<string, string>)[block.mimeType];
      if (!ext) throw new Error('COMPACTION_MEDIA_UNSUPPORTED: original image format cannot be archived safely.');
      const uri = `session://tool-outputs/compaction-authority/media-${hash}.${ext}`;
      onMedia?.({ messageIndex, blockIndex, uri, hash, mimeType: block.mimeType }, bytes);
      return { type: 'text' as const, text: `Original image: ${uri} sha256:${hash}. Not visually inspected by this text checkpoint; use artifact_read to inspect it.` };
    });
    if (typed.role === 'assistant') { const { providerState: _state, ...visible } = typed; return { ...visible, content } as AgentMessage; }
    return { ...typed, content } as AgentMessage;
  });
}

/** Recover the original source only after every manifest, part and media hash is checked. */
export function readCompactionAuthorityJournal(sessionId: string, uri: string, expectedHash: string): AgentMessage[] {
  const owner = delegatedArtifactOwner(sessionId) ?? sessionId;
  const readJson = (target: string, hash: string): unknown => {
    sessionArtifactResolver.read(owner, target, { expectedHash: hash, limit: 1 });
    return JSON.parse(fs.readFileSync(sessionArtifactResolver.resolve(owner, target).absolutePath, 'utf8'));
  };
  const visited = new Set<string>();
  const readJournal = (sourceUri: string, sourceHash: string): AgentMessage[] => {
    if (visited.size >= 512 || visited.has(sourceUri)) throw new Error('CONTEXT_WINDOW_INVALID: source chain is cyclic or too deep.');
    visited.add(sourceUri);
    const envelope = readJson(sourceUri, sourceHash) as { encoding?: string; chunks?: string[]; parts?: Array<{ uri: string; hash: string }> };
    let chunks: string[];
    if (envelope.encoding === 'json-chunks' && Array.isArray(envelope.chunks)) chunks = envelope.chunks;
    else if (envelope.encoding === 'json-chunk-parts' && Array.isArray(envelope.parts) && envelope.parts.length) {
      chunks = envelope.parts.flatMap(part => {
        if (typeof part.uri !== 'string' || typeof part.hash !== 'string') throw new Error('CONTEXT_WINDOW_INVALID: malformed source part.');
        const body = readJson(part.uri, part.hash) as { chunks?: string[] };
        if (!Array.isArray(body.chunks) || !body.chunks.every(chunk => typeof chunk === 'string')) throw new Error('CONTEXT_WINDOW_INVALID: malformed source part.');
        return body.chunks;
      });
    } else throw new Error('CONTEXT_WINDOW_INVALID: malformed source envelope.');
    if (!chunks.every(chunk => typeof chunk === 'string')) throw new Error('CONTEXT_WINDOW_INVALID: malformed source chunks.');
    const source = JSON.parse(chunks.join('')) as {
      journalMessages?: AgentMessage[]; media?: ArchivedMedia[];
      journalPrefix?: { uri: string; hash: string; count: number };
    };
    if (!Array.isArray(source.journalMessages) || !Array.isArray(source.media)) throw new Error('CONTEXT_WINDOW_INVALID: archived journal missing.');
    for (const entry of source.media) sessionArtifactResolver.read(owner, entry.uri, { expectedHash: entry.hash, limit: 1 });
    if (!source.journalPrefix) return source.journalMessages;
    const prefix = source.journalPrefix;
    if (typeof prefix.uri !== 'string' || typeof prefix.hash !== 'string' || !Number.isSafeInteger(prefix.count) || prefix.count < 0) {
      throw new Error('CONTEXT_WINDOW_INVALID: malformed source prefix.');
    }
    const prior = readJournal(prefix.uri, prefix.hash);
    if (prior.length !== prefix.count) throw new Error('CONTEXT_WINDOW_INVALID: source prefix count changed.');
    return [...prior, ...source.journalMessages];
  };
  return readJournal(uri, expectedHash);
}

/** Keep the complete state in the source artifact while bounding what enters the model prompt. */
function compactAuthorityState(state: AuthorityState, archiveUri: string, stateHash: string): Record<string, unknown> {
  const active = (status: TaskRecord['status']): boolean => status === 'pending' || status === 'in_progress' || status === 'blocked';
  return {
    authorityArchive: archiveUri,
    authorityStateHash: stateHash,
    authorityStateOmittedFromPrompt: true,
    tasks: state.tasks.map(task => ({
      id: task.id, subject: task.subject, status: task.status, parentTaskId: task.parentTaskId,
      blockedBy: task.blockedBy, executionIds: task.executionIds,
      ...(task.statusReason ? { statusReason: task.statusReason.slice(0, 240), statusReasonTruncated: task.statusReason.length > 240 } : {}),
      ...(active(task.status) ? { description: task.description.slice(0, 500), completionRequirements: task.completionRequirements } : {}),
    })),
    executions: state.executions.map(execution => ({
      id: execution.id, taskId: execution.taskId, generation: execution.generation,
      mode: execution.mode, status: execution.status,
      ...(execution.result ? {
        result: {
          disposition: execution.result.disposition,
          summary: execution.result.summary.slice(0, 240),
          summaryTruncated: execution.result.summary.length > 240,
          resultRef: execution.result.resultRef, resultHash: execution.result.resultHash,
          error: execution.result.error?.slice(0, 240),
        },
      } : {}),
    })),
    artifactRefs: state.artifactRefs,
    investigation: state.investigation.map(item => ({
      uri: item.uri, hash: item.hash,
      manifest: {
        artifactId: item.manifest.artifactId, kind: item.manifest.kind, status: item.manifest.status,
        title: item.manifest.title, contentRef: item.manifest.contentRef,
        contentHash: item.manifest.contentHash, sourceRefs: item.manifest.sourceRefs,
        supersedes: item.manifest.supersedes,
      },
    })),
  };
}

/** A long session may outgrow even its record index. Keep a declared partial
 * index in the model window; the complete state remains in authorityArchive. */
function boundAuthorityContext(state: AuthorityState, archiveUri: string, stateHash: string, media: ArchivedMedia[]): string {
  const projected = compactAuthorityState(state, archiveUri, stateHash);
  const complete = JSON.stringify({ ...projected, media });
  if (complete.length <= AUTHORITY_CONTEXT_CHAR_LIMIT) return complete;

  const active = (status: unknown): boolean => status === 'pending' || status === 'in_progress' || status === 'blocked';
  const taskIndex = (projected.tasks as Array<Record<string, unknown>>).map((_, index) => index)
    .sort((left, right) => Number(active((projected.tasks as Array<Record<string, unknown>>)[right]?.status))
      - Number(active((projected.tasks as Array<Record<string, unknown>>)[left]?.status)) || right - left);
  const entries = {
    tasks: (projected.tasks as Array<Record<string, unknown>>).map(task => ({
      ...task,
      subject: typeof task.subject === 'string' ? task.subject.slice(0, 180) : task.subject,
      description: typeof task.description === 'string' ? task.description.slice(0, 300) : task.description,
      completionRequirements: Array.isArray(task.completionRequirements)
        ? task.completionRequirements.slice(0, 6).map(value => typeof value === 'string' ? value.slice(0, 160) : value) : task.completionRequirements,
      executionIds: Array.isArray(task.executionIds) ? task.executionIds.slice(-8) : task.executionIds,
      blockedBy: Array.isArray(task.blockedBy) ? task.blockedBy.slice(-8) : task.blockedBy,
    })),
    executions: projected.executions as unknown[],
    artifactRefs: projected.artifactRefs as unknown[],
    investigation: (projected.investigation as Array<Record<string, unknown>>).map(item => {
      const manifest = item.manifest as Record<string, unknown>;
      return { ...item, manifest: {
        ...manifest,
        title: typeof manifest.title === 'string' ? manifest.title.slice(0, 180) : manifest.title,
        sourceRefCount: Array.isArray(manifest.sourceRefs) ? manifest.sourceRefs.length : 0,
        sourceRefs: undefined,
      } };
    }),
    media,
  };
  type IndexKind = keyof typeof entries;
  const kinds: IndexKind[] = ['tasks', 'executions', 'artifactRefs', 'investigation', 'media'];
  const limits = Object.fromEntries(kinds.map(kind => [kind, entries[kind].length])) as Record<IndexKind, number>;
  const select = (kind: IndexKind): unknown[] => {
    if (kind !== 'tasks') return entries[kind].slice(-limits[kind]);
    const selected = new Set(taskIndex.slice(0, limits.tasks));
    return entries.tasks.filter((_, index) => selected.has(index));
  };
  for (;;) {
    const selected = Object.fromEntries(kinds.map(kind => [kind, select(kind)])) as Record<IndexKind, unknown[]>;
    const indexCoverage = Object.fromEntries(kinds.map(kind => [kind, {
      total: entries[kind].length, included: selected[kind].length,
      omitted: entries[kind].length - selected[kind].length,
    }]));
    const context = JSON.stringify({ ...projected, ...selected, indexCoverage: {
      complete: false,
      instruction: 'This is a partial index. Read authorityArchive by URI and hash before relying on omitted tasks, executions, artifacts, investigation records or media.',
      ...indexCoverage,
    } });
    if (context.length <= AUTHORITY_CONTEXT_CHAR_LIMIT) return context;
    const largest = kinds.filter(kind => limits[kind] > 0)
      .sort((left, right) => JSON.stringify(selected[right]).length - JSON.stringify(selected[left]).length)[0];
    if (!largest) throw new Error('COMPACTION_AUTHORITY_TOO_LARGE: even the partial authority index exceeds the bounded input.');
    limits[largest] = Math.floor(limits[largest] / 2);
  }
}
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
  const investigation = scope ? [] : investigationArtifactService.readAllRecords(owner).map(read => {
    return { manifest: read.manifest, record: read.record, uri: read.contentUri, hash: read.contentHash };
  });
  return JSON.stringify({ tasks: taskRecords, executions, artifactRefs, investigation });
}
export async function saveCompactionAuthoritySource(sessionId: string, journalMessages: Message[]): Promise<{ uri: string; hash: string; context: string; stateHash: string; parts: Array<{ uri: string; hash: string }>; journalPrefix?: { uri: string; hash: string; count: number } }> {
  const owner = delegatedArtifactOwner(sessionId) ?? sessionId;
  const authorityContext = await readCompactionAuthorityState(sessionId);
  const uri = `session://tool-outputs/compaction-authority/${generateShortId()}.json`;
  // A checkpoint is an append-only journal segment when an earlier verified
  // source covers the same canonical prefix. Keep the prior URI/hash as a
  // readable link instead of copying the entire session into every checkpoint.
  const priorCandidates = sessionArtifactResolver.list(owner, 'tool-outputs')
    .filter(candidate => /^session:\/\/tool-outputs\/compaction-authority\/[a-z0-9]+\.json$/u.test(candidate))
    .map(candidate => ({ uri: candidate, modified: fs.statSync(sessionArtifactResolver.resolve(owner, candidate).absolutePath).mtimeMs }))
    .sort((left, right) => right.modified - left.modified);
  let journalPrefix: { uri: string; hash: string; count: number } | undefined;
  for (const candidate of priorCandidates) {
    const checked = sessionArtifactResolver.read(owner, candidate.uri, { limit: 1 });
    const prior = readCompactionAuthorityJournal(sessionId, candidate.uri, checked.hash);
    if (prior.length > journalMessages.length) continue;
    const currentPrefix = projectCompactionJournalMessages(journalMessages.slice(0, prior.length));
    if (hashScopedResource(currentPrefix) !== hashScopedResource(prior)) continue;
    journalPrefix = { uri: candidate.uri, hash: checked.hash, count: prior.length };
    break;
  }
  const media: ArchivedMedia[] = [];
  const recoverableMessages = projectCompactionJournalMessages(journalMessages.slice(journalPrefix?.count ?? 0), (entry, bytes) => {
      const { uri } = entry;
      const saved = sessionArtifactResolver.write(owner, uri, bytes, { mimeType: entry.mimeType });
      sessionArtifactResolver.read(owner, uri, { expectedHash: saved.hash, limit: 1 });
      grantDelegatedOutput(sessionId, uri, saved.hash);
      media.push({ ...entry, hash: saved.hash });
  });
  const fullState = JSON.parse(authorityContext) as AuthorityState;
  const stateHash = hashScopedResource(authorityContext);
  const fullContext = JSON.stringify({ ...fullState, media });
  const compacted = fullContext.length > AUTHORITY_CONTEXT_CHAR_LIMIT;
  const context = compacted ? boundAuthorityContext(fullState, uri, stateHash, media) : fullContext;
  if (context.length > AUTHORITY_CONTEXT_CHAR_LIMIT) throw new Error('COMPACTION_AUTHORITY_TOO_LARGE: authoritative task/artifact index exceeds the bounded compaction input; retain current context.');
  const original = JSON.stringify({ ...JSON.parse(context), ...(compacted ? { fullAuthorityState: fullState } : {}), ...(journalPrefix ? { journalPrefix } : {}), journalMessages: recoverableMessages });
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
  return { ...saved, context, stateHash, parts: [...parts, ...media.map(({ uri, hash }) => ({ uri, hash }))], journalPrefix };
}
export function verifyCompactionAuthoritySource(sessionId: string, ref: { uri: string; hash: string; parts?: Array<{ uri: string; hash: string }>; journalPrefix?: { uri: string; hash: string; count: number } }): void {
  const owner = delegatedArtifactOwner(sessionId) ?? sessionId;
  for (const entry of [ref, ...ref.parts ?? []]) sessionArtifactResolver.read(owner, entry.uri, { expectedHash: entry.hash, limit: 1 });
  if (ref.journalPrefix) readCompactionAuthorityJournal(sessionId, ref.uri, ref.hash);
}
