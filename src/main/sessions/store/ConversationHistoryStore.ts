import * as fs from 'fs';
import * as path from 'path';
import { generateShortId, nowMs } from '@shared/utils/id';
import { appendJsonl, assertNoJsonlDiagnostics, readJsonl, writeJsonl } from '../../runtime/jsonl';
import { readStoredWorkTrace, sanitizeStoredWorkTrace } from '../../conversation/StoredWorkTrace';
import { classifyAttachmentBytes } from '../../conversation/attachmentClassify';
import { copyFileAtomicSync } from '../../runtime/atomicFile';
import {
  CONVERSATION_COMPACTION_DELTA_THRESHOLD,
  type ConversationHistoryCacheEntry,
  type ConversationDeltaRecord,
  type ConversationTraceBlocksPatch,
  type ConversationTerminalCommitJournal,
  type ConversationTerminalAppendJournal,
  type ConversationTurnCommitJournal,
  type ExistingConversationTurnCommit,
} from './storageCommitTypes';
import {
  CONVERSATION_TERMINAL_COMMIT_MIGRATIONS,
  CONVERSATION_TURN_COMMIT_MIGRATIONS,
  ConversationHistoryRecordSchema,
  SessionAttachmentManifestSchema,
  readCurrentStoredJson,
  CURRENT_STORE_SCHEMA_VERSION,
  SessionRecordSchema,
  toSessionAttachmentManifest,
} from './storageSchema';
import { applyTerminalAppend, prepareTerminalAppend } from './ConversationTerminalAppend';
import { readProjectSessions } from './sessionRecordReconcile';
import type { SessionContextTurnEntry } from '../../conversation/SessionContextJournal';
import type { SessionAttachmentKind, SessionAttachmentLayer, SessionAttachmentRecord, SessionRecord } from '@shared/types/session';
import type { ConversationMessage, ConversationWorkTrace } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type { ProjectWorkspaceStore } from './ProjectWorkspaceStore';
import type { SessionRecordStore } from './SessionRecordStore';
import type { SessionContextStore } from './SessionContextStore';
import type { StorageIo } from './StorageIo';

/** What conversation history needs from storage: file I/O, session records, the project registry and the turn journal. */
export interface ConversationHistoryHost {
  io: StorageIo;
  sessions: Pick<
    SessionRecordStore,
    'findSessionLocation' | 'readSessionRecord' | 'updateSession' | 'getSessionAttachmentsDir' | 'getSessionAttachmentsManifestPath'
  >;
  projects: Pick<ProjectWorkspaceStore, 'touchProject' | 'readRegistry' | 'ensureProjectSessionsRoot'>;
  context: Pick<SessionContextStore, 'readSessionContextJournal'>;
}

export type {
  ExistingConversationTurnCommit,
  StagedConversationSessionCommit,
} from './storageCommitTypes';


/** The blocks of `next` that are not the very same object in `previous`; untouched blocks are shared. */
function traceBlocksPatch(previous: ConversationWorkTrace, next: ConversationWorkTrace): ConversationTraceBlocksPatch {
  const previousById = new Map(previous.blocks.map((block) => [block.id, block] as const));
  return {
    status: next.status,
    ...(next.summary !== undefined ? { summary: next.summary } : {}),
    ...(next.toolEvidence ? { toolEvidence: next.toolEvidence } : {}),
    updatedAt: next.updatedAt,
    blockIds: next.blocks.map((block) => block.id),
    changedBlocks: next.blocks.filter((block) => previousById.get(block.id) !== block),
  };
}

/** A delta record; a trace change against a stored trace is written as its changed blocks only. */
function deltaRecord(
  existing: ConversationMessage,
  id: string,
  patch: Partial<ConversationMessage>,
  updatedAt: number,
): ConversationDeltaRecord {
  const { workTrace: nextTrace, ...rest } = patch;
  const traceBlocks = nextTrace && existing.workTrace ? traceBlocksPatch(existing.workTrace, nextTrace) : undefined;
  return {
    op: 'delta',
    id,
    patch: traceBlocks ? rest : patch,
    ...(traceBlocks ? { traceBlocks } : {}),
    updatedAt,
  };
}

function applyTraceBlocksPatch(previous: ConversationWorkTrace, patch: ConversationTraceBlocksPatch): ConversationWorkTrace {
  const byId = new Map(previous.blocks.map((block) => [block.id, block] as const));
  for (const block of patch.changedBlocks) byId.set(block.id, block);
  return {
    status: patch.status,
    ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
    ...(patch.toolEvidence ? { toolEvidence: patch.toolEvidence } : {}),
    updatedAt: patch.updatedAt,
    blocks: patch.blockIds.flatMap((id) => {
      const block = byId.get(id);
      return block ? [block] : [];
    }),
  };
}

export class ConversationHistoryStore {
  private readonly compactionsPending = new Set<string>();
  readonly turnCommitSessionIds = new Set<string>();
  readonly terminalCommitSessionIds = new Set<string>();
  readonly conversationHistoryCache = new Map<string, ConversationHistoryCacheEntry>();
  readonly conversationPendingDeltaCounts = new Map<string, number>();

  constructor(private readonly host: ConversationHistoryHost) {}

  beginExistingConversationTurnCommit(
    sessionId: string,
    sourceAttachmentPaths: string[],
    requestId: string,
    turnId: string,
    plannedAttachments?: SessionAttachmentRecord[],
  ): ExistingConversationTurnCommit {
    if (this.turnCommitSessionIds.has(sessionId)) {
      throw new Error(`Conversation turn commit is already active for session ${sessionId}.`);
    }
    this.recoverSessionTurnCommit(sessionId);
    const session = this.host.sessions.readSessionRecord(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const beforeHistory = this.readConversationHistory(sessionId);
    const beforeBranch = this.readConversationBranchState(sessionId);
    const beforeAttachments = this.readSessionAttachments(sessionId);
    const attachmentsDir = this.host.sessions.getSessionAttachmentsDir(sessionId);
    const attachments = plannedAttachments ?? this.planAttachmentsForTurn(session, sourceAttachmentPaths, attachmentsDir);
    const afterAttachments = beforeAttachments.concat(attachments);
    const journal: ConversationTurnCommitJournal = {
      schemaVersion: '1',
      requestId,
      turnId,
      phase: 'prepared',
      beforeHistory,
      beforeBranch,
      beforeAttachments,
      afterAttachments,
      importedPaths: attachments.map((entry) => entry.filePath),
    };
    this.host.io.writeJsonAtomic(this.getConversationTurnCommitJournalPath(session.sessionPath), journal);
    this.turnCommitSessionIds.add(sessionId);
    try {
      for (let index = 0; index < sourceAttachmentPaths.length; index += 1) {
        const sourcePath = path.resolve(sourceAttachmentPaths[index]!);
        const targetPath = attachments[index]!.filePath;
        copyFileAtomicSync(sourcePath, targetPath);
      }
      this.host.io.writeJsonAtomic(
        this.host.sessions.getSessionAttachmentsManifestPath(sessionId),
        toSessionAttachmentManifest(afterAttachments),
      );
      return { session, requestId, turnId, attachments, beforeHistory, beforeBranch };
    } catch (error) {
      this.turnCommitSessionIds.delete(sessionId);
      this.recoverSessionTurnCommit(sessionId);
      throw error;
    }
  }

  commitExistingConversationTurn(
    commit: ExistingConversationTurnCommit,
    history: ConversationMessage[],
    branchState: ConversationBranchState | null,
  ): void {
    const journalPath = this.getConversationTurnCommitJournalPath(commit.session.sessionPath);
    const journal = this.host.io.readJson(journalPath, CONVERSATION_TURN_COMMIT_MIGRATIONS);
    if (!journal || journal.requestId !== commit.requestId || journal.turnId !== commit.turnId) {
      throw new Error('Conversation turn commit journal is missing or belongs to another turn.');
    }
    const committing: ConversationTurnCommitJournal = {
      ...journal,
      phase: 'committing',
      afterHistory: history,
      afterBranch: branchState,
    };
    this.host.io.writeJsonAtomic(journalPath, committing);
    try {
      this.applyConversationTurnJournal(commit.session, committing, true);
      this.host.io.writeJsonAtomic(journalPath, { ...committing, phase: 'committed' });
      fs.rmSync(journalPath, { force: true });
      this.host.sessions.updateSession(commit.session.sessionId, {});
    } finally {
      this.turnCommitSessionIds.delete(commit.session.sessionId);
    }
  }

  rollbackExistingConversationTurn(commit: ExistingConversationTurnCommit): void {
    try {
      this.recoverSessionTurnCommit(commit.session.sessionId, true);
    } finally {
      this.turnCommitSessionIds.delete(commit.session.sessionId);
    }
  }

  getConversationPath(sessionId: string): string {
    const location = this.host.sessions.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for conversation history: ${sessionId}`);
    }
    return path.join(location.sessionPath, 'conversation.jsonl');
  }

  getConversationBranchStatePath(sessionId: string): string {
    const location = this.host.sessions.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for conversation branches: ${sessionId}`);
    }
    return path.join(location.sessionPath, 'conversation-branches.json');
  }

  readConversationBranchState(sessionId: string): import('@shared/types/conversationBranch').ConversationBranchState | null {
    const filePath = this.getConversationBranchStatePath(sessionId);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return this.host.io.readJson<import('@shared/types/conversationBranch').ConversationBranchState>(filePath);
  }

  writeConversationBranchState(
    sessionId: string,
    state: import('@shared/types/conversationBranch').ConversationBranchState,
  ): void {
    this.host.io.writeUtf8Atomic(this.getConversationBranchStatePath(sessionId), JSON.stringify(state, null, 2));
  }

  clearConversationBranchState(sessionId: string): void {
    const filePath = this.getConversationBranchStatePath(sessionId);
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  }

  commitConversationTerminal(
    sessionId: string,
    requestId: string,
    turnId: string,
    assistantMessage: ConversationMessage,
    contextEntry: SessionContextTurnEntry,
  ): void {
    if (this.terminalCommitSessionIds.has(sessionId)) {
      throw new Error(`Conversation terminal commit is already active for session ${sessionId}.`);
    }
    this.recoverSessionTurnCommit(sessionId);
    this.recoverSessionTerminalCommit(sessionId);
    const session = this.host.sessions.readSessionRecord(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (
      contextEntry.turnId !== turnId
      || contextEntry.assistantMessageId !== assistantMessage.id
      || assistantMessage.turnId !== turnId
    ) {
      throw new Error('Conversation terminal commit ownership mismatch.');
    }

    const duplicate = this.host.context.readSessionContextJournal(sessionId, (entry) => entry.turnId === turnId)[0];
    if (duplicate && JSON.stringify(duplicate) !== JSON.stringify(contextEntry)) {
      throw new Error(`Conflicting session context entry for turn ${turnId}.`);
    }
    const replaceAssistant = this.readConversationHistory(sessionId).some((message) => message.id === assistantMessage.id);
    const journal = prepareTerminalAppend(session.sessionPath, requestId, turnId, assistantMessage, contextEntry, !duplicate, replaceAssistant);
    const journalPath = this.getConversationTerminalCommitJournalPath(session.sessionPath);
    this.host.io.writeUtf8Atomic(journalPath, JSON.stringify(journal));
    this.terminalCommitSessionIds.add(sessionId);
    const committing: ConversationTerminalAppendJournal = { ...journal, phase: 'committing' };
    try {
      this.host.io.writeUtf8Atomic(journalPath, JSON.stringify(committing));
      this.applyConversationTerminalJournal(session, committing, true);
      this.host.io.writeUtf8Atomic(journalPath, JSON.stringify({ ...committing, phase: 'committed' }));
      fs.rmSync(journalPath, { force: true });
      this.host.sessions.updateSession(sessionId, {});
      // Maintenance may rewrite history only after the append WAL is gone.
      this.scheduleCompaction(sessionId, this.conversationPendingDeltaCounts.get(sessionId) ?? 0);
    } finally {
      this.terminalCommitSessionIds.delete(sessionId);
    }
  }

  readConversationHistory(sessionId: string): ConversationMessage[] {
    const filePath = this.getConversationPath(sessionId);
    const cached = this.readConversationHistoryCache(sessionId, filePath);
    if (cached) {
      return cached.messages.map((message) => ({ ...message }));
    }

    const rebuilt = this.rebuildConversationHistory(filePath);
    this.writeConversationHistoryCache(sessionId, filePath, rebuilt.messages, rebuilt.rawRecordCount);
    return rebuilt.messages.map((message) => ({ ...message }));
  }

  appendConversationMessage(sessionId: string, message: ConversationMessage): void {
    const filePath = this.getConversationPath(sessionId);
    const existing = this.findCachedConversationMessage(sessionId, filePath, message.id);
    if (!existing) {
      appendJsonl(filePath, message);
      this.applyConversationMessageToCache(sessionId, filePath, message);
      this.scheduleCompaction(sessionId, this.conversationPendingDeltaCounts.get(sessionId) ?? 0);
      return;
    }

    const patch = this.diffConversationMessage(existing, message);
    if (Object.keys(patch).length === 0) {
      return;
    }

    appendJsonl(filePath, deltaRecord(existing, message.id, patch, message.updatedAt ?? message.createdAt));
    this.applyConversationMessageToCache(sessionId, filePath, message);
    const nextDeltaCount = this.conversationPendingDeltaCounts.get(sessionId) ?? 0;
    this.scheduleCompaction(sessionId, nextDeltaCount);
  }

  appendConversationDelta(
    sessionId: string,
    messageId: string,
    patch: Partial<ConversationMessage>,
  ): void {
    const filePath = this.getConversationPath(sessionId);
    const normalizedPatch = { ...patch };
    delete (normalizedPatch as { id?: string }).id;
    if (Object.keys(normalizedPatch).length === 0) {
      return;
    }
    const existing = this.findCachedConversationMessage(sessionId, filePath, messageId);
    if (!existing) {
      throw new Error(`Cannot append conversation delta for unknown message: ${messageId}`);
    }
    const nextMessage: ConversationMessage = {
      ...existing,
      ...normalizedPatch,
      id: messageId,
      updatedAt: typeof normalizedPatch.updatedAt === 'number'
        ? normalizedPatch.updatedAt
        : nowMs(),
    };
    appendJsonl(filePath, deltaRecord(existing, messageId, normalizedPatch, nextMessage.updatedAt ?? nowMs()));
    this.applyConversationMessageToCache(sessionId, filePath, nextMessage);
    const nextDeltaCount = this.conversationPendingDeltaCounts.get(sessionId) ?? 0;
    this.scheduleCompaction(sessionId, nextDeltaCount);
  }

  /**
   * Compaction rewrites the whole history, so it runs after the current event instead of inside the turn's
   * update. It reads and replaces the file in one synchronous step, so no append can fall between the two.
   */
  private scheduleCompaction(sessionId: string, pendingDeltaCount: number): void {
    if (pendingDeltaCount < CONVERSATION_COMPACTION_DELTA_THRESHOLD || pendingDeltaCount % CONVERSATION_COMPACTION_DELTA_THRESHOLD !== 0) return;
    if (this.compactionsPending.has(sessionId)) return;
    this.compactionsPending.add(sessionId);
    setImmediate(() => {
      this.compactionsPending.delete(sessionId);
      try {
        this.compactConversationHistory(sessionId);
      } catch (error) {
        // Every delta is already durable. A busy journal on Windows, or a session deleted meanwhile, only
        // postpones maintenance to the next threshold.
        console.warn(`[ConversationHistoryStore] Deferred conversation compaction for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  writeConversationHistory(sessionId: string, messages: ConversationMessage[]): void {
    writeJsonl(this.getConversationPath(sessionId), messages);
    this.invalidateConversationHistoryCache(sessionId);
    this.conversationPendingDeltaCounts.set(sessionId, 0);
    this.host.sessions.updateSession(sessionId, {});
  }

  compactConversationHistory(sessionId: string): ConversationMessage[] {
    const messages = this.readConversationHistory(sessionId);
    this.host.io.writeJsonlAtomic(this.getConversationPath(sessionId), messages);
    this.invalidateConversationHistoryCache(sessionId);
    this.conversationPendingDeltaCounts.set(sessionId, 0);
    return messages;
  }

  listSessionAttachments(sessionId: string): SessionAttachmentRecord[] {
    return this.readSessionAttachments(sessionId)
      .slice()
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  importSessionAttachments(sessionId: string, filePaths: string[]): SessionAttachmentRecord[] {
    const session = this.host.sessions.readSessionRecord(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const attachmentsDir = this.host.sessions.getSessionAttachmentsDir(sessionId);
    const existing = this.readSessionAttachments(sessionId);
    const imported: SessionAttachmentRecord[] = [];

    for (const filePath of filePaths) {
      const sourcePath = path.resolve(filePath);
      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
        continue;
      }

      const targetPath = this.resolveImportedFilePath(attachmentsDir, path.basename(sourcePath));
      fs.copyFileSync(sourcePath, targetPath);
      const stats = fs.statSync(targetPath);
      const header = fs.readFileSync(targetPath).subarray(0, Math.min(stats.size, 64 * 1024));
      const classified = this.classifySource(path.basename(targetPath), header);
      imported.push({
        attachmentId: `att_${generateShortId()}`,
        sessionId,
        projectId: session.projectId,
        kind: classified.kind,
        layer: classified.layer,
        fileName: path.basename(targetPath),
        filePath: targetPath,
        mimeType: classified.mimeType,
        size: stats.size,
        createdAt: stats.birthtimeMs || stats.ctimeMs || nowMs(),
      });
    }

    if (imported.length > 0) {
      this.writeSessionAttachments(sessionId, existing.concat(imported));
      this.host.projects.touchProject(session.projectId, session.sessionId);
    }

    return imported;
  }

  rollbackImportedSessionAttachments(
    sessionId: string,
    attachments: SessionAttachmentRecord[],
  ): void {
    if (attachments.length === 0) return;
    const attachmentsDir = path.resolve(this.host.sessions.getSessionAttachmentsDir(sessionId));
    const ids = new Set(attachments.map((entry) => entry.attachmentId));
    for (const attachment of attachments) {
      const resolvedPath = path.resolve(attachment.filePath);
      if (resolvedPath.startsWith(`${attachmentsDir}${path.sep}`) && fs.existsSync(resolvedPath)) {
        fs.unlinkSync(resolvedPath);
      }
    }
    const remaining = this.readSessionAttachments(sessionId)
      .filter((entry) => !ids.has(entry.attachmentId));
    this.writeSessionAttachments(sessionId, remaining);
  }

  private rebuildConversationHistory(filePath: string): {
    messages: ConversationMessage[];
    rawRecordCount: number;
  } {
    if (!fs.existsSync(filePath)) {
      return { messages: [], rawRecordCount: 0 };
    }
    const result = readJsonl(filePath, ConversationHistoryRecordSchema.parse);
    assertNoJsonlDiagnostics(filePath, result.diagnostics);
    const latestById = new Map<string, ConversationMessage>();

    for (const record of result.records) {
      if ('op' in record) {
        const existing = latestById.get(record.id);
        if (!existing) continue;
        latestById.set(record.id, {
          ...existing,
          ...record.patch,
          ...(record.traceBlocks && existing.workTrace
            ? { workTrace: applyTraceBlocksPatch(existing.workTrace, record.traceBlocks) }
            : {}),
          id: existing.id,
          updatedAt: record.updatedAt,
        });
        continue;
      }

      const existing = latestById.get(record.id);
      const existingUpdatedAt = existing?.updatedAt ?? existing?.createdAt ?? 0;
      const nextUpdatedAt = record.updatedAt ?? record.createdAt;
      if (!existing || nextUpdatedAt >= existingUpdatedAt) {
        latestById.set(record.id, record);
      }
    }

    const messages = Array.from(latestById.values())
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((message) => ({
        ...message,
        ...readStoredWorkTrace(message.workTrace ?? null),
      }));

    return { messages, rawRecordCount: result.records.length };
  }

  private readConversationHistoryCache(
    sessionId: string,
    filePath: string,
  ): ConversationHistoryCacheEntry | null {
    const cached = this.conversationHistoryCache.get(sessionId);
    if (!cached) return null;
    if (!fs.existsSync(filePath)) {
      if (cached.size === 0 && cached.mtimeMs === 0) return cached;
      return null;
    }
    const stats = fs.statSync(filePath);
    if (stats.mtimeMs !== cached.mtimeMs || stats.size !== cached.size) {
      return null;
    }
    return cached;
  }

  private writeConversationHistoryCache(
    sessionId: string,
    filePath: string,
    messages: ConversationMessage[],
    rawRecordCount: number,
  ): void {
    // Redundancy belongs to the session journal, not one message or turn.
    this.conversationPendingDeltaCounts.set(sessionId, Math.max(0, rawRecordCount - messages.length));
    if (!fs.existsSync(filePath)) {
      this.conversationHistoryCache.set(sessionId, {
        mtimeMs: 0,
        size: 0,
        messages,
        rawRecordCount,
      });
      return;
    }
    const stats = fs.statSync(filePath);
    this.conversationHistoryCache.set(sessionId, {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      messages,
      rawRecordCount,
    });
  }

  invalidateConversationHistoryCache(sessionId: string): void {
    this.conversationHistoryCache.delete(sessionId);
  }

  private applyConversationMessageToCache(
    sessionId: string,
    filePath: string,
    message: ConversationMessage,
  ): void {
    const cached = this.conversationHistoryCache.get(sessionId);
    let messages: ConversationMessage[];
    let previousRawCount: number;
    if (cached) {
      messages = cached.messages.slice();
      previousRawCount = cached.rawRecordCount;
    } else {
      const rebuilt = this.rebuildConversationHistory(filePath);
      messages = rebuilt.messages.filter((entry) => entry.id !== message.id);
      previousRawCount = Math.max(0, rebuilt.rawRecordCount - 1);
    }
    const index = messages.findIndex((entry) => entry.id === message.id);
    const sanitized: ConversationMessage = {
      ...message,
      workTrace: sanitizeStoredWorkTrace(message.workTrace ?? null),
    };
    if (index >= 0) messages[index] = sanitized;
    else messages.push(sanitized);
    messages.sort((left, right) => left.createdAt - right.createdAt);
    this.writeConversationHistoryCache(
      sessionId,
      filePath,
      messages,
      previousRawCount + 1,
    );
  }

  private findCachedConversationMessage(
    sessionId: string,
    filePath: string,
    messageId: string,
  ): ConversationMessage | null {
    const cached = this.readConversationHistoryCache(sessionId, filePath);
    if (cached) {
      return cached.messages.find((message) => message.id === messageId) ?? null;
    }
    const rebuilt = this.rebuildConversationHistory(filePath);
    this.writeConversationHistoryCache(sessionId, filePath, rebuilt.messages, rebuilt.rawRecordCount);
    return rebuilt.messages.find((message) => message.id === messageId) ?? null;
  }

  private diffConversationMessage(
    previous: ConversationMessage,
    next: ConversationMessage,
  ): Partial<ConversationMessage> {
    const patch: Partial<ConversationMessage> = {};
    const keys = new Set([
      ...Object.keys(previous),
      ...Object.keys(next),
    ]) as Set<keyof ConversationMessage>;
    for (const key of keys) {
      if (key === 'id' || previous[key] === next[key]) continue;
      // Traces are updated copy-on-write: a new object is a change, and the delta stores only changed blocks.
      if (key === 'workTrace') {
        patch.workTrace = next.workTrace;
        continue;
      }
      if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
        (patch as Record<string, unknown>)[key] = next[key];
      }
    }
    return patch;
  }

  getConversationTurnCommitJournalPath(sessionPath: string): string {
    return path.join(sessionPath, 'turn-commit.json');
  }

  getConversationTerminalCommitJournalPath(sessionPath: string): string {
    return path.join(sessionPath, 'terminal-commit.json');
  }

  recoverConversationTurnCommits(): void {
    for (const project of this.host.projects.readRegistry().projects) {
      const sessionsRoot = this.host.projects.ensureProjectSessionsRoot(project);
      for (const entry of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
        const entryPath = path.join(sessionsRoot, entry.name);
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.turn-staging-')) {
          fs.rmSync(entryPath, { recursive: true, force: true });
          continue;
        }
      }
      for (const { session } of readProjectSessions(this.host, project)) {
        if (session.storageDiagnostic) continue;
        this.recoverSessionTurnCommit(session.sessionId);
        this.recoverSessionTerminalCommit(session.sessionId);
      }
    }
  }

  recoverSessionTurnCommit(sessionId: string, forceRollback = false): void {
    const location = this.host.sessions.findSessionLocation(sessionId);
    if (!location) return;
    const journalPath = this.getConversationTurnCommitJournalPath(location.sessionPath);
    const journal = this.host.io.readJson(journalPath, CONVERSATION_TURN_COMMIT_MIGRATIONS);
    if (!journal) return;
    const session = this.host.io.readJson(path.join(location.sessionPath, 'session.json'), SessionRecordSchema);
    if (!session) return;
    const shouldRollForward = !forceRollback
      && (journal.phase === 'committing' || journal.phase === 'committed')
      && Array.isArray(journal.afterHistory);
    this.applyConversationTurnJournal(session, journal, shouldRollForward);
    fs.rmSync(journalPath, { force: true });
  }

  recoverSessionTerminalCommit(sessionId: string): void {
    const location = this.host.sessions.findSessionLocation(sessionId);
    if (!location) return;
    const journalPath = this.getConversationTerminalCommitJournalPath(location.sessionPath);
    const journal = this.host.io.readJson(journalPath, CONVERSATION_TERMINAL_COMMIT_MIGRATIONS);
    if (!journal) return;
    const session = this.host.io.readJson(path.join(location.sessionPath, 'session.json'), SessionRecordSchema);
    if (!session) return;
    const shouldRollForward = journal.phase === 'committing' || journal.phase === 'committed';
    this.applyConversationTerminalJournal(session, journal, shouldRollForward);
    fs.rmSync(journalPath, { force: true });
  }

  applyConversationTerminalJournal(
    session: SessionRecord,
    journal: ConversationTerminalCommitJournal | ConversationTerminalAppendJournal,
    useAfter: boolean,
  ): void {
    if (journal.schemaVersion === '2') {
      const assistant = applyTerminalAppend(session.sessionPath, journal, useAfter);
      if (useAfter) this.applyConversationMessageToCache(session.sessionId, this.getConversationPath(session.sessionId), assistant);
      else {
        this.invalidateConversationHistoryCache(session.sessionId);
        this.conversationPendingDeltaCounts.delete(session.sessionId);
      }
      return;
    }
    const history = useAfter ? journal.afterHistory : journal.beforeHistory;
    const branch = useAfter ? journal.afterBranch : journal.beforeBranch;
    const context = useAfter ? journal.afterContext : journal.beforeContext;
    this.host.io.writeJsonlAtomic(path.join(session.sessionPath, 'conversation.jsonl'), history);
    this.invalidateConversationHistoryCache(session.sessionId);
    this.conversationPendingDeltaCounts.set(session.sessionId, 0);
    const branchPath = path.join(session.sessionPath, 'conversation-branches.json');
    if (branch) this.host.io.writeJsonAtomic(branchPath, branch);
    else if (fs.existsSync(branchPath)) fs.rmSync(branchPath, { force: true });
    this.host.io.writeJsonlAtomic(path.join(session.sessionPath, 'session-context.jsonl'), context);
  }

  applyConversationTurnJournal(
    session: SessionRecord,
    journal: ConversationTurnCommitJournal,
    useAfter: boolean,
  ): void {
    const history = useAfter ? journal.afterHistory : journal.beforeHistory;
    const branch = useAfter ? journal.afterBranch : journal.beforeBranch;
    const attachments = useAfter ? journal.afterAttachments : journal.beforeAttachments;
    if (!history) throw new Error('Conversation turn journal does not contain a committed history snapshot.');
    this.host.io.writeJsonlAtomic(path.join(session.sessionPath, 'conversation.jsonl'), history);
    this.invalidateConversationHistoryCache(session.sessionId);
    this.conversationPendingDeltaCounts.set(session.sessionId, 0);
    const branchPath = path.join(session.sessionPath, 'conversation-branches.json');
    if (branch) this.host.io.writeJsonAtomic(branchPath, branch);
    else if (fs.existsSync(branchPath)) fs.rmSync(branchPath, { force: true });
    this.host.io.writeJsonAtomic(
      path.join(session.sessionPath, 'attachments.json'),
      toSessionAttachmentManifest(attachments),
    );
    if (!useAfter) {
      const attachmentsRoot = path.resolve(path.join(session.sessionPath, 'attachments'));
      for (const importedPath of journal.importedPaths) {
        const resolvedPath = path.resolve(importedPath);
        if (resolvedPath.startsWith(`${attachmentsRoot}${path.sep}`) && fs.existsSync(resolvedPath)) {
          fs.rmSync(resolvedPath, { force: true });
        }
      }
    }
  }

  readSessionAttachments(sessionId: string): SessionAttachmentRecord[] {
    return readCurrentStoredJson(
      this.host.io,
      this.host.sessions.getSessionAttachmentsManifestPath(sessionId),
      CURRENT_STORE_SCHEMA_VERSION,
      SessionAttachmentManifestSchema,
    ) ?? [];
  }

  writeSessionAttachments(sessionId: string, attachments: SessionAttachmentRecord[]): void {
    this.host.io.writeJsonAtomic(
      this.host.sessions.getSessionAttachmentsManifestPath(sessionId),
      toSessionAttachmentManifest(attachments),
    );
  }

  planAttachmentsForTurn(
    session: SessionRecord,
    sourcePaths: string[],
    logicalAttachmentsDir: string,
    classifications?: Array<{
      material?: SessionAttachmentRecord['material'];
      sourceHash?: string;
      layer: SessionAttachmentLayer;
      mimeType: string;
      kind: SessionAttachmentKind;
      fileName?: string;
      size?: number;
    }>,
  ): SessionAttachmentRecord[] {
    const reserved = new Set<string>();
    return sourcePaths.map((filePath, index) => {
      const sourcePath = path.resolve(filePath);
      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
        throw new Error(`Attachment is not a readable file: ${sourcePath}`);
      }
      const classification = classifications?.[index];
      const stats = fs.statSync(sourcePath);
      const fileName = path.basename(classification?.fileName || sourcePath);
      const extension = path.extname(fileName);
      const baseName = path.basename(fileName, extension);
      let targetPath = path.join(logicalAttachmentsDir, fileName);
      let counter = 2;
      while (fs.existsSync(targetPath) || reserved.has(targetPath.toLowerCase())) {
        targetPath = path.join(logicalAttachmentsDir, `${baseName}-${counter}${extension}`);
        counter += 1;
      }
      reserved.add(targetPath.toLowerCase());
      const classified = classification ?? this.classifySource(
        fileName,
        fs.readFileSync(sourcePath).subarray(0, Math.min(stats.size, 64 * 1024)),
      );
      return {
        material: classification?.material, sourceHash: classification?.sourceHash,
        attachmentId: `att_${generateShortId()}`,
        sessionId: session.sessionId,
        projectId: session.projectId,
        kind: classified.kind,
        layer: classified.layer,
        fileName,
        filePath: targetPath,
        mimeType: classified.mimeType,
        size: classification?.size ?? stats.size,
        createdAt: nowMs(),
      };
    });
  }

  copyAttachmentsForTurn(
    session: SessionRecord,
    sourcePaths: string[],
    physicalAttachmentsDir: string,
    logicalAttachmentsDir: string,
  ): SessionAttachmentRecord[] {
    const planned = this.planAttachmentsForTurn(session, sourcePaths, logicalAttachmentsDir);
    for (let index = 0; index < planned.length; index += 1) {
      const targetPath = path.join(physicalAttachmentsDir, path.basename(planned[index]!.filePath));
      fs.copyFileSync(path.resolve(sourcePaths[index]!), targetPath);
    }
    return planned;
  }

  /**
   * Copy attachment sources into a turn staging directory and return staged absolute paths
   * in the same order as the input. Commit/materialize must use these staged bytes, not the original sources.
   */
  stageAttachmentInputs(sourcePaths: string[], stagingDir: string): string[] {
    this.host.io.ensureDir(stagingDir);
    const stagedPaths: string[] = [];
    for (let index = 0; index < sourcePaths.length; index += 1) {
      const sourcePath = path.resolve(sourcePaths[index]!);
      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
        throw new Error(`Attachment is not a readable file: ${sourcePath}`);
      }
      const extension = path.extname(sourcePath);
      const baseName = path.basename(sourcePath, extension) || `attachment-${index}`;
      let fileName = `${String(index).padStart(3, '0')}-${baseName}${extension}`;
      let targetPath = path.join(stagingDir, fileName);
      let counter = 2;
      while (fs.existsSync(targetPath)) {
        fileName = `${String(index).padStart(3, '0')}-${baseName}-${counter}${extension}`;
        targetPath = path.join(stagingDir, fileName);
        counter += 1;
      }
      copyFileAtomicSync(sourcePath, targetPath);
      stagedPaths.push(targetPath);
    }
    return stagedPaths;
  }

  private resolveImportedFilePath(dirPath: string, fileName: string): string {
    const extension = path.extname(fileName);
    const baseName = path.basename(fileName, extension);
    let candidate = path.join(dirPath, fileName);
    let counter = 2;
    while (fs.existsSync(candidate)) {
      candidate = path.join(dirPath, `${baseName}-${counter}${extension}`);
      counter += 1;
    }
    return candidate;
  }

  private classifySource(fileName: string, header: Buffer): {
    kind: SessionAttachmentKind;
    layer: SessionAttachmentLayer;
    mimeType: string;
  } {
    const classification = classifyAttachmentBytes(fileName, header);
    if (classification.rejectCode) {
      throw new Error(`${classification.rejectCode}: ${classification.rejectMessage ?? fileName}`);
    }
    return {
      kind: classification.kind,
      layer: classification.layer,
      mimeType: classification.mimeType,
    };
  }
}
