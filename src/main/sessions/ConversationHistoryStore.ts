import * as fs from 'fs';
import * as path from 'path';
import { appendJsonl, assertNoJsonlDiagnostics, readJsonl, writeJsonl } from '@shared/utils/jsonl';
import { generateShortId, nowMs } from '@shared/utils/id';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import { sanitizeStoredWorkTrace } from '../conversation/ConversationWorkTrace';
import type { SessionAttachmentRecord, SessionRecord } from '@shared/types/session';
import type { SessionContextTurnEntry } from '../conversation/SessionContextJournal';
import {
  CONVERSATION_COMPACTION_DELTA_THRESHOLD,
  type ConversationHistoryCacheEntry,
  type ConversationDeltaRecord,
  type ConversationTerminalCommitJournal,
  type ConversationTurnCommitJournal,
  type ExistingConversationTurnCommit,
} from './storageCommitTypes';
import {
  CONVERSATION_TERMINAL_COMMIT_MIGRATIONS,
  CONVERSATION_TURN_COMMIT_MIGRATIONS,
  SessionAttachmentManifestSchema,
  SessionRecordSchema,
  toSessionAttachmentManifest,
} from './storageSchema';

export type {
  ExistingConversationTurnCommit,
  StagedConversationSessionCommit,
} from './storageCommitTypes';


export class ConversationHistoryStore {
  constructor(private readonly host: import('./storageHost').StorageHost) {}

  beginExistingConversationTurnCommit(
    sessionId: string,
    sourceAttachmentPaths: string[],
    requestId: string,
    turnId: string,
  ): ExistingConversationTurnCommit {
    if (this.host.turnCommitSessionIds.has(sessionId)) {
      throw new Error(`Conversation turn commit is already active for session ${sessionId}.`);
    }
    this.recoverSessionTurnCommit(sessionId);
    const session = this.host.sessions.readSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const beforeHistory = this.readConversationHistory(sessionId);
    const beforeBranch = this.readConversationBranchState(sessionId);
    const beforeAttachments = this.readSessionAttachments(sessionId);
    const attachmentsDir = this.host.sessions.getSessionAttachmentsDir(sessionId);
    const attachments = this.planAttachmentsForTurn(session, sourceAttachmentPaths, attachmentsDir);
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
    this.host.turnCommitSessionIds.add(sessionId);
    try {
      for (let index = 0; index < sourceAttachmentPaths.length; index += 1) {
        const sourcePath = path.resolve(sourceAttachmentPaths[index]!);
        const targetPath = attachments[index]!.filePath;
        const temporaryPath = `${targetPath}.${process.pid}.${generateShortId()}.tmp`;
        fs.copyFileSync(sourcePath, temporaryPath);
        fs.renameSync(temporaryPath, targetPath);
      }
      this.host.io.writeJsonAtomic(this.host.sessions.getSessionAttachmentsManifestPath(sessionId), afterAttachments);
      return { session, requestId, turnId, attachments, beforeHistory, beforeBranch };
    } catch (error) {
      this.host.turnCommitSessionIds.delete(sessionId);
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
      this.host.turnCommitSessionIds.delete(commit.session.sessionId);
    }
  }

  rollbackExistingConversationTurn(commit: ExistingConversationTurnCommit): void {
    try {
      this.recoverSessionTurnCommit(commit.session.sessionId, true);
    } finally {
      this.host.turnCommitSessionIds.delete(commit.session.sessionId);
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
    const filePath = this.getConversationBranchStatePath(sessionId);
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    this.host.io.ensureDir(path.dirname(filePath));
    fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2), 'utf-8');
    try {
      fs.renameSync(temporaryPath, filePath);
    } catch (error) {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
      throw error;
    }
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
    if (this.host.terminalCommitSessionIds.has(sessionId)) {
      throw new Error(`Conversation terminal commit is already active for session ${sessionId}.`);
    }
    this.recoverSessionTurnCommit(sessionId);
    this.recoverSessionTerminalCommit(sessionId);
    const session = this.host.sessions.readSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (
      contextEntry.turnId !== turnId
      || contextEntry.assistantMessageId !== assistantMessage.id
      || assistantMessage.turnId !== turnId
    ) {
      throw new Error('Conversation terminal commit ownership mismatch.');
    }

    const beforeHistory = this.readConversationHistory(sessionId);
    const beforeBranch = this.readConversationBranchState(sessionId);
    const beforeContext = this.host.context.readSessionContextJournal(sessionId);
    const duplicate = beforeContext.find((entry) => entry.turnId === turnId);
    if (duplicate && JSON.stringify(duplicate) !== JSON.stringify(contextEntry)) {
      throw new Error(`Conflicting session context entry for turn ${turnId}.`);
    }
    const afterHistory = beforeHistory.slice();
    const assistantIndex = afterHistory.findIndex((message) => message.id === assistantMessage.id);
    if (assistantIndex >= 0) afterHistory[assistantIndex] = assistantMessage;
    else afterHistory.push(assistantMessage);
    afterHistory.sort((left, right) => left.createdAt - right.createdAt);
    const afterContext = duplicate ? beforeContext : beforeContext.concat(contextEntry);
    const journal: ConversationTerminalCommitJournal = {
      schemaVersion: '1',
      requestId,
      turnId,
      phase: 'prepared',
      beforeHistory,
      beforeBranch,
      beforeContext,
      afterHistory,
      afterBranch: beforeBranch,
      afterContext,
    };
    const journalPath = this.getConversationTerminalCommitJournalPath(session.sessionPath);
    this.host.io.writeJsonAtomic(journalPath, journal);
    this.host.terminalCommitSessionIds.add(sessionId);
    const committing: ConversationTerminalCommitJournal = { ...journal, phase: 'committing' };
    try {
      this.host.io.writeJsonAtomic(journalPath, committing);
      this.applyConversationTerminalJournal(session, committing, true);
      this.host.io.writeJsonAtomic(journalPath, { ...committing, phase: 'committed' });
      fs.rmSync(journalPath, { force: true });
      this.host.sessions.updateSession(sessionId, {});
    } finally {
      this.host.terminalCommitSessionIds.delete(sessionId);
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
      this.host.conversationPendingDeltaCounts.set(sessionId, 0);
      return;
    }

    const patch = this.diffConversationMessage(existing, message);
    if (Object.keys(patch).length === 0) {
      return;
    }

    const delta: ConversationDeltaRecord = {
      op: 'delta',
      id: message.id,
      patch,
      updatedAt: message.updatedAt ?? message.createdAt,
    };
    appendJsonl(filePath, delta);
    this.applyConversationMessageToCache(sessionId, filePath, message);
    const nextDeltaCount = (this.host.conversationPendingDeltaCounts.get(sessionId) ?? 0) + 1;
    this.host.conversationPendingDeltaCounts.set(sessionId, nextDeltaCount);
    if (nextDeltaCount >= CONVERSATION_COMPACTION_DELTA_THRESHOLD) {
      this.compactConversationHistory(sessionId);
    }
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
    const delta: ConversationDeltaRecord = {
      op: 'delta',
      id: messageId,
      patch: normalizedPatch,
      updatedAt: nextMessage.updatedAt ?? nowMs(),
    };
    appendJsonl(filePath, delta);
    this.applyConversationMessageToCache(sessionId, filePath, nextMessage);
    const nextDeltaCount = (this.host.conversationPendingDeltaCounts.get(sessionId) ?? 0) + 1;
    this.host.conversationPendingDeltaCounts.set(sessionId, nextDeltaCount);
    if (nextDeltaCount >= CONVERSATION_COMPACTION_DELTA_THRESHOLD) {
      this.compactConversationHistory(sessionId);
    }
  }

  writeConversationHistory(sessionId: string, messages: ConversationMessage[]): void {
    writeJsonl(this.getConversationPath(sessionId), messages);
    this.invalidateConversationHistoryCache(sessionId);
    this.host.conversationPendingDeltaCounts.set(sessionId, 0);
    this.host.sessions.updateSession(sessionId, {});
  }

  compactConversationHistory(sessionId: string): ConversationMessage[] {
    const messages = this.readConversationHistory(sessionId);
    this.host.io.writeJsonlAtomic(this.getConversationPath(sessionId), messages);
    this.invalidateConversationHistoryCache(sessionId);
    this.host.conversationPendingDeltaCounts.set(sessionId, 0);
    return messages;
  }

  listSessionAttachments(sessionId: string): SessionAttachmentRecord[] {
    return this.readSessionAttachments(sessionId)
      .slice()
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  importSessionAttachments(sessionId: string, filePaths: string[]): SessionAttachmentRecord[] {
    const session = this.host.sessions.readSession(sessionId);
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
      imported.push({
        attachmentId: `att_${generateShortId()}`,
        sessionId,
        projectId: session.projectId,
        kind: this.inferAttachmentKind(targetPath),
        fileName: path.basename(targetPath),
        filePath: targetPath,
        mimeType: this.inferMimeType(targetPath),
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

  private isConversationDeltaRecord(value: unknown): value is ConversationDeltaRecord {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return record.op === 'delta'
      && typeof record.id === 'string'
      && !!record.patch
      && typeof record.patch === 'object'
      && typeof record.updatedAt === 'number';
  }

  private rebuildConversationHistory(filePath: string): {
    messages: ConversationMessage[];
    rawRecordCount: number;
  } {
    if (!fs.existsSync(filePath)) {
      return { messages: [], rawRecordCount: 0 };
    }
    const result = readJsonl<ConversationMessage | ConversationDeltaRecord>(filePath);
    assertNoJsonlDiagnostics(filePath, result.diagnostics);
    const latestById = new Map<string, ConversationMessage>();

    for (const record of result.records) {
      if (this.isConversationDeltaRecord(record)) {
        const existing = latestById.get(record.id);
        if (!existing) continue;
        latestById.set(record.id, {
          ...existing,
          ...record.patch,
          id: existing.id,
          updatedAt: record.updatedAt,
        });
        continue;
      }

      if (!record || typeof record !== 'object' || typeof (record as ConversationMessage).id !== 'string') {
        continue;
      }
      const snapshot = record as ConversationMessage;
      const existing = latestById.get(snapshot.id);
      const existingUpdatedAt = existing?.updatedAt ?? existing?.createdAt ?? 0;
      const nextUpdatedAt = snapshot.updatedAt ?? snapshot.createdAt;
      if (!existing || nextUpdatedAt >= existingUpdatedAt) {
        latestById.set(snapshot.id, snapshot);
      }
    }

    const messages = Array.from(latestById.values())
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((message) => ({
        ...message,
        workTrace: sanitizeStoredWorkTrace(message.workTrace ?? null),
      }));

    return { messages, rawRecordCount: result.records.length };
  }

  private readConversationHistoryCache(
    sessionId: string,
    filePath: string,
  ): ConversationHistoryCacheEntry | null {
    const cached = this.host.conversationHistoryCache.get(sessionId);
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
    if (!fs.existsSync(filePath)) {
      this.host.conversationHistoryCache.set(sessionId, {
        mtimeMs: 0,
        size: 0,
        messages,
        rawRecordCount,
      });
      return;
    }
    const stats = fs.statSync(filePath);
    this.host.conversationHistoryCache.set(sessionId, {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      messages,
      rawRecordCount,
    });
  }

  invalidateConversationHistoryCache(sessionId: string): void {
    this.host.conversationHistoryCache.delete(sessionId);
  }

  private applyConversationMessageToCache(
    sessionId: string,
    filePath: string,
    message: ConversationMessage,
  ): void {
    const cached = this.host.conversationHistoryCache.get(sessionId);
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
      if (key === 'id') continue;
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
        const session = this.host.io.readJson(path.join(entryPath, 'session.json'), SessionRecordSchema);
        if (session) {
          this.recoverSessionTurnCommit(session.sessionId);
          this.recoverSessionTerminalCommit(session.sessionId);
        }
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
    journal: ConversationTerminalCommitJournal,
    useAfter: boolean,
  ): void {
    const history = useAfter ? journal.afterHistory : journal.beforeHistory;
    const branch = useAfter ? journal.afterBranch : journal.beforeBranch;
    const context = useAfter ? journal.afterContext : journal.beforeContext;
    this.host.io.writeJsonlAtomic(path.join(session.sessionPath, 'conversation.jsonl'), history);
    this.invalidateConversationHistoryCache(session.sessionId);
    this.host.conversationPendingDeltaCounts.set(session.sessionId, 0);
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
    this.host.conversationPendingDeltaCounts.set(session.sessionId, 0);
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
    return this.host.io.readJson(this.host.sessions.getSessionAttachmentsManifestPath(sessionId), SessionAttachmentManifestSchema) ?? [];
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
  ): SessionAttachmentRecord[] {
    const reserved = new Set<string>();
    return sourcePaths.map((filePath) => {
      const sourcePath = path.resolve(filePath);
      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
        throw new Error(`Attachment is not a readable file: ${sourcePath}`);
      }
      const extension = path.extname(sourcePath);
      const baseName = path.basename(sourcePath, extension);
      let fileName = path.basename(sourcePath);
      let targetPath = path.join(logicalAttachmentsDir, fileName);
      let counter = 2;
      while (fs.existsSync(targetPath) || reserved.has(targetPath.toLowerCase())) {
        fileName = `${baseName}-${counter}${extension}`;
        targetPath = path.join(logicalAttachmentsDir, fileName);
        counter += 1;
      }
      reserved.add(targetPath.toLowerCase());
      const stats = fs.statSync(sourcePath);
      return {
        attachmentId: `att_${generateShortId()}`,
        sessionId: session.sessionId,
        projectId: session.projectId,
        kind: this.inferAttachmentKind(sourcePath),
        fileName,
        filePath: targetPath,
        mimeType: this.inferMimeType(sourcePath),
        size: stats.size,
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
      const targetPath = path.join(physicalAttachmentsDir, planned[index]!.fileName);
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
      const temporaryPath = `${targetPath}.${process.pid}.${generateShortId()}.tmp`;
      fs.copyFileSync(sourcePath, temporaryPath);
      fs.renameSync(temporaryPath, targetPath);
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

  private inferAttachmentKind(filePath: string): SessionAttachmentRecord['kind'] {
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(filePath) ? 'image' : 'file';
  }

  private inferMimeType(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    const mimeByExtension: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.json': 'application/json',
      '.zip': 'application/zip',
      '.7z': 'application/x-7z-compressed',
      '.log': 'text/plain',
    };
    return mimeByExtension[extension] || 'application/octet-stream';
  }
}
