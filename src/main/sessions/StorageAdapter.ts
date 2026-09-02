/**
 * StorageAdapter - Project / Session / Run 存储层
 * 统一管理 userData 下的项目、会话、运行记录与全局 knowledge。
 */

import type { ActionEvent } from '@shared/types/evidence';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type {
  CaptureDescriptor,
  ProjectInputRecord,
  ProjectRecord,
  RunContextUsageSummary,
  RunSummary,
  SessionAttachmentRecord,
  SessionRecord,
} from '@shared/types/session';
import type { ProfileHandoffState } from '@shared/types/profileHandoff';
import type { PersistedRunRecord } from './storageTypes';
import type { SessionContextTurnEntry } from '../conversation/SessionContextJournal';
import { StorageIo } from './StorageIo';
import { ProjectWorkspaceStore } from './ProjectWorkspaceStore';
import { SessionRecordStore } from './SessionRecordStore';
import { ConversationHistoryStore } from './ConversationHistoryStore';
import { SessionContextStore } from './SessionContextStore';
import { HandoffStateStore } from './HandoffStateStore';
import type {
  ConversationHistoryCacheEntry,
  ExistingConversationTurnCommit,
  ReservedStagedConversationSession,
  StagedConversationSessionCommit,
} from './storageCommitTypes';
import type { StorageHost } from './storageHost';

export type {
  ExistingConversationTurnCommit,
  ReservedStagedConversationSession,
  StagedConversationSessionCommit,
} from './storageCommitTypes';

export class StorageAdapter implements StorageHost {
  readonly io = new StorageIo();
  dataRootPath = '';
  projectsRootPath = '';
  globalKnowledgePath = '';
  registryPath = '';
  selectionPath = '';
  readonly turnCommitSessionIds = new Set<string>();
  readonly terminalCommitSessionIds = new Set<string>();
  readonly conversationHistoryCache = new Map<string, ConversationHistoryCacheEntry>();
  readonly conversationPendingDeltaCounts = new Map<string, number>();
  projects: ProjectWorkspaceStore;
  sessions: SessionRecordStore;
  history: ConversationHistoryStore;
  context: SessionContextStore;
  handoffs: HandoffStateStore;
  private handoffHydrateListener: ((sessionId: string, result: ProfileHandoffState | null) => void) | null = null;

  constructor() {
    this.projects = new ProjectWorkspaceStore(this);
    this.sessions = new SessionRecordStore(this);
    this.history = new ConversationHistoryStore(this);
    this.context = new SessionContextStore(this);
    this.handoffs = new HandoffStateStore(this);
    this.projects.syncRuntimePaths();
  }

  setHandoffHydrateListener(
    listener: ((sessionId: string, result: ProfileHandoffState | null) => void) | null,
  ): void {
    this.handoffHydrateListener = listener;
  }

  getWorkspacePath(): string {
    return this.projects.getWorkspacePath();
  }

  getGlobalKnowledgePath(): string {
    return this.projects.getGlobalKnowledgePath();
  }

  async initializeWorkspace(): Promise<void> {
    return this.projects.initializeWorkspace();
  }

  listProjects(): ProjectRecord[] {
    return this.projects.listProjects();
  }

  async createProject(rootPath: string): Promise<ProjectRecord> {
    return this.projects.createProject(rootPath);
  }

  renameProject(projectId: string, newName: string): ProjectRecord {
    return this.projects.renameProject(projectId, newName);
  }

  removeProject(projectId: string): void {
    return this.projects.removeProject(projectId);
  }

  removeSession(sessionId: string): void {
    return this.sessions.removeSession(sessionId);
  }

  getProjectById(projectId: string): ProjectRecord | null {
    return this.projects.getProjectById(projectId);
  }

  async listProjectInputs(projectId: string): Promise<ProjectInputRecord[]> {
    return this.projects.listProjectInputs(projectId);
  }

  async refreshProjectInputs(projectId: string): Promise<ProjectInputRecord[]> {
    return this.projects.refreshProjectInputs(projectId);
  }

  async importProjectInputs(projectId: string, filePaths: string[]): Promise<ProjectInputRecord[]> {
    return this.projects.importProjectInputs(projectId, filePaths);
  }

  listSessions(projectId: string): SessionRecord[] {
    return this.sessions.listSessions(projectId);
  }

  createSession(projectId: string, title?: string, goal: string = ''): SessionRecord {
    return this.sessions.createSession(projectId, title, goal);
  }

  allocateStagedConversationSession(
    projectId: string,
    title: string,
    requestId: string,
    turnId: string,
  ): ReservedStagedConversationSession {
    return this.sessions.allocateStagedConversationSession(projectId, title, requestId, turnId);
  }

  beginStagedConversationSession(
    projectId: string,
    title: string,
    sourceAttachmentPaths: string[],
    requestId: string,
    turnId: string,
    options?: {
      reserved?: ReservedStagedConversationSession;
      plannedAttachments?: SessionAttachmentRecord[];
    },
  ): StagedConversationSessionCommit {
    return this.sessions.beginStagedConversationSession(
      projectId,
      title,
      sourceAttachmentPaths,
      requestId,
      turnId,
      options,
    );
  }

  commitStagedConversationSession(
    commit: StagedConversationSessionCommit,
    history: ConversationMessage[],
    branchState: ConversationBranchState | null,
  ): SessionRecord {
    return this.sessions.commitStagedConversationSession(commit, history, branchState);
  }

  rollbackStagedConversationSession(commit: StagedConversationSessionCommit): void {
    return this.sessions.rollbackStagedConversationSession(commit);
  }

  beginExistingConversationTurnCommit(
    sessionId: string,
    sourceAttachmentPaths: string[],
    requestId: string,
    turnId: string,
    plannedAttachments?: SessionAttachmentRecord[],
  ): ExistingConversationTurnCommit {
    return this.history.beginExistingConversationTurnCommit(
      sessionId,
      sourceAttachmentPaths,
      requestId,
      turnId,
      plannedAttachments,
    );
  }

  commitExistingConversationTurn(
    commit: ExistingConversationTurnCommit,
    history: ConversationMessage[],
    branchState: ConversationBranchState | null,
  ): void {
    return this.history.commitExistingConversationTurn(commit, history, branchState);
  }

  rollbackExistingConversationTurn(commit: ExistingConversationTurnCommit): void {
    return this.history.rollbackExistingConversationTurn(commit);
  }

  readSession(sessionId: string): SessionRecord | null {
    const session = this.sessions.readSession(sessionId);
    if (session) {
      const hydrated = this.handoffs.hydrate(sessionId);
      this.handoffHydrateListener?.(sessionId, hydrated);
    }
    return session;
  }

  updateSession(sessionId: string, patch: Partial<SessionRecord>): SessionRecord | null {
    return this.sessions.updateSession(sessionId, patch);
  }

  listRuns(sessionId: string): RunSummary[] {
    return this.sessions.listRuns(sessionId);
  }

  getLatestRun(sessionId: string): RunSummary | null {
    return this.sessions.getLatestRun(sessionId);
  }

  getCasePath(caseId: string): string {
    return this.sessions.getCasePath(caseId);
  }

  getRunPath(caseId: string, runId: string): string {
    return this.sessions.getRunPath(caseId, runId);
  }

  readPersistedRun(sessionId: string, runId: string) {
    return this.sessions.readPersistedRun(sessionId, runId);
  }

  async createCase(input: {
    caseId?: string;
    projectId?: string;
    userGoal: string;
    symptomSummary: string;
  }): Promise<string> {
    return this.sessions.createCase(input);
  }

  async readCase(caseId: string): Promise<Record<string, unknown> | null> {
    return this.sessions.readCase(caseId);
  }

  async updateCase(caseId: string, data: Record<string, unknown>): Promise<void> {
    return this.sessions.updateCase(caseId, data);
  }

  async createRun(input: {
    caseId: string;
    runId?: string;
    sessionId?: string;
    turnId?: string;
    capturePaths: string[];
    profileId: string;
    goal?: string;
    captures?: CaptureDescriptor[];
    backend?: 'local' | 'remote';
    status?: PersistedRunRecord['status'];
  }): Promise<{ runId: string; sessionId: string }> {
    return this.sessions.createRun(input);
  }

  async readRun(caseId: string, runId: string): Promise<Record<string, unknown> | null> {
    return this.sessions.readRun(caseId, runId);
  }

  async updateRun(caseId: string, runId: string, data: Record<string, unknown>): Promise<void> {
    return this.sessions.updateRun(caseId, runId, data);
  }

  getActionChainPath(sessionId: string): string {
    return this.sessions.getActionChainPath(sessionId);
  }

  getConversationPath(sessionId: string): string {
    return this.history.getConversationPath(sessionId);
  }

  getConversationBranchStatePath(sessionId: string): string {
    return this.history.getConversationBranchStatePath(sessionId);
  }

  readConversationBranchState(sessionId: string): import('@shared/types/conversationBranch').ConversationBranchState | null {
    return this.history.readConversationBranchState(sessionId);
  }

  writeConversationBranchState(
    sessionId: string,
    state: import('@shared/types/conversationBranch').ConversationBranchState,
  ): void {
    return this.history.writeConversationBranchState(sessionId, state);
  }

  clearConversationBranchState(sessionId: string): void {
    return this.history.clearConversationBranchState(sessionId);
  }

  getSessionAttachmentsDir(sessionId: string): string {
    return this.sessions.getSessionAttachmentsDir(sessionId);
  }

  getSessionAttachmentsManifestPath(sessionId: string): string {
    return this.sessions.getSessionAttachmentsManifestPath(sessionId);
  }

  writeSessionPlanArtifact(sessionId: string, content: string): string {
    return this.sessions.writeSessionPlanArtifact(sessionId, content);
  }

  getSessionUsagePath(sessionId: string): string | null {
    return this.context.getSessionUsagePath(sessionId);
  }

  readSessionUsage(sessionId: string): RunContextUsageSummary | null {
    return this.context.readSessionUsage(sessionId);
  }

  writeSessionUsage(sessionId: string, usage: RunContextUsageSummary): void {
    return this.context.writeSessionUsage(sessionId, usage);
  }

  getSessionShellStatePath(sessionId: string): string | null {
    return this.context.getSessionShellStatePath(sessionId);
  }

  readSessionShellCwd(sessionId: string): string | null {
    return this.context.readSessionShellCwd(sessionId);
  }

  writeSessionShellCwd(sessionId: string, cwd: string): void {
    return this.context.writeSessionShellCwd(sessionId, cwd);
  }

  writeSessionContextJournal(sessionId: string, entries: SessionContextTurnEntry[]): void {
    return this.context.writeSessionContextJournal(sessionId, entries);
  }

  clearSessionContextState(sessionId: string): void {
    return this.context.clearSessionContextState(sessionId);
  }

  getSessionDerivedContextViewPath(sessionId: string): string {
    return this.context.getSessionDerivedContextViewPath(sessionId);
  }

  readSessionDerivedContextView(sessionId: string): import('@shared/types/semanticContext').DerivedContextView | null {
    return this.context.readSessionDerivedContextView(sessionId);
  }

  writeSessionDerivedContextView(
    sessionId: string,
    view: import('@shared/types/semanticContext').DerivedContextView,
  ): void {
    return this.context.writeSessionDerivedContextView(sessionId, view);
  }

  clearSessionDerivedContextView(sessionId: string): void {
    return this.context.clearSessionDerivedContextView(sessionId);
  }

  getSessionContextJournalPath(sessionId: string): string {
    return this.context.getSessionContextJournalPath(sessionId);
  }

  readSessionContextJournal(sessionId: string): SessionContextTurnEntry[] {
    return this.context.readSessionContextJournal(sessionId);
  }

  appendSessionContextTurn(sessionId: string, entry: SessionContextTurnEntry): void {
    return this.context.appendSessionContextTurn(sessionId, entry);
  }

  commitConversationTerminal(
    sessionId: string,
    requestId: string,
    turnId: string,
    assistantMessage: ConversationMessage,
    contextEntry: SessionContextTurnEntry,
  ): void {
    return this.history.commitConversationTerminal(sessionId, requestId, turnId, assistantMessage, contextEntry);
  }

  readConversationHistory(sessionId: string): ConversationMessage[] {
    return this.history.readConversationHistory(sessionId);
  }

  appendConversationMessage(sessionId: string, message: ConversationMessage): void {
    return this.history.appendConversationMessage(sessionId, message);
  }

  appendConversationDelta(
    sessionId: string,
    messageId: string,
    patch: Partial<ConversationMessage>,
  ): void {
    return this.history.appendConversationDelta(sessionId, messageId, patch);
  }

  writeConversationHistory(sessionId: string, messages: ConversationMessage[]): void {
    return this.history.writeConversationHistory(sessionId, messages);
  }

  compactConversationHistory(sessionId: string): ConversationMessage[] {
    return this.history.compactConversationHistory(sessionId);
  }

  listSessionAttachments(sessionId: string): SessionAttachmentRecord[] {
    return this.history.listSessionAttachments(sessionId);
  }

  importSessionAttachments(sessionId: string, filePaths: string[]): SessionAttachmentRecord[] {
    return this.history.importSessionAttachments(sessionId, filePaths);
  }

  rollbackImportedSessionAttachments(
    sessionId: string,
    attachments: SessionAttachmentRecord[],
  ): void {
    return this.history.rollbackImportedSessionAttachments(sessionId, attachments);
  }

  async appendActionEvent(sessionId: string, event: ActionEvent): Promise<void> {
    return this.sessions.appendActionEvent(sessionId, event);
  }

  async readActionChain(sessionId: string): Promise<ActionEvent[]> {
    return this.sessions.readActionChain(sessionId);
  }

  createActionEvent(input: {
    runId: string;
    sessionId: string;
    agentId: string;
    eventType: ActionEvent['event_type'];
    status: ActionEvent['status'];
    payload: Record<string, unknown>;
    turnId?: string;
    refs?: string[];
  }): ActionEvent {
    return this.sessions.createActionEvent(input);
  }

  getCurrentProjectId(): string | null {
    return this.projects.getCurrentProjectId();
  }

  setCurrentProjectId(projectId: string | null): void {
    return this.projects.setCurrentProjectId(projectId);
  }

  async getCurrentSessionId(): Promise<string | null> {
    return this.projects.getCurrentSessionId();
  }

  async setCurrentSessionId(sessionId: string | null): Promise<void> {
    return this.projects.setCurrentSessionId(sessionId);
  }
}

export const storageAdapter = new StorageAdapter();
