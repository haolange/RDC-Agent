/**
 * StorageAdapter - Project / Session / Run 存储层
 * 统一管理 userData 下的项目、会话、运行记录与全局 knowledge。
 */

import type { ActionEvent } from '@shared/types/evidence';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type {
  Blocker,
  WorkflowStage,
  WorkflowState,
} from '@shared/types/workflow';
import type {
  CaptureDescriptor,
  ExecutableAppMode,
  ProjectInputRecord,
  ProjectRecord,
  RunContextUsageSummary,
  RunSummary,
  SessionAttachmentRecord,
  SessionRecord,
} from '@shared/types/session';
import type { PersistedRunRecord, SessionEvidenceRecord } from './storageTypes';
import type { SessionContextTurnEntry } from '../conversation/SessionContextJournal';
import { StorageIo } from './StorageIo';
import { ProjectWorkspaceStore } from './ProjectWorkspaceStore';
import { SessionRecordStore } from './SessionRecordStore';
import { ConversationHistoryStore } from './ConversationHistoryStore';
import { SessionContextStore } from './SessionContextStore';
import type {
  ConversationHistoryCacheEntry,
  ExistingConversationTurnCommit,
  StagedConversationSessionCommit,
} from './storageCommitTypes';
import type { StorageHost } from './storageHost';

export type {
  ExistingConversationTurnCommit,
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

  constructor() {
    this.projects = new ProjectWorkspaceStore(this);
    this.sessions = new SessionRecordStore(this);
    this.history = new ConversationHistoryStore(this);
    this.context = new SessionContextStore(this);
    this.projects.syncRuntimePaths();
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

  createProject(rootPath: string): ProjectRecord {
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

  listProjectInputs(projectId: string): ProjectInputRecord[] {
    return this.projects.listProjectInputs(projectId);
  }

  refreshProjectInputs(projectId: string): ProjectInputRecord[] {
    return this.projects.refreshProjectInputs(projectId);
  }

  importProjectInputs(projectId: string, filePaths: string[]): ProjectInputRecord[] {
    return this.projects.importProjectInputs(projectId, filePaths);
  }

  listSessions(projectId: string): SessionRecord[] {
    return this.sessions.listSessions(projectId);
  }

  createSession(projectId: string, title?: string, goal: string = ''): SessionRecord {
    return this.sessions.createSession(projectId, title, goal);
  }

  beginStagedConversationSession(
    projectId: string,
    title: string,
    sourceAttachmentPaths: string[],
    requestId: string,
    turnId: string,
  ): StagedConversationSessionCommit {
    return this.sessions.beginStagedConversationSession(projectId, title, sourceAttachmentPaths, requestId, turnId);
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
  ): ExistingConversationTurnCommit {
    return this.history.beginExistingConversationTurnCommit(sessionId, sourceAttachmentPaths, requestId, turnId);
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
    return this.sessions.readSession(sessionId);
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
    mode?: ExecutableAppMode;
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

  async writeArtifact(caseId: string, runId: string, artifactName: string, data: unknown): Promise<string> {
    return this.sessions.writeArtifact(caseId, runId, artifactName, data);
  }

  async readArtifact(caseId: string, runId: string, artifactName: string): Promise<Record<string, unknown> | null> {
    return this.sessions.readArtifact(caseId, runId, artifactName);
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

  getSessionEvidencePath(sessionId: string): string {
    return this.sessions.getSessionEvidencePath(sessionId);
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

  readSessionEvidence(sessionId: string): SessionEvidenceRecord | null {
    return this.sessions.readSessionEvidence(sessionId);
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

  async getWorkflowState(caseId: string, runId: string): Promise<WorkflowState | null> {
    return this.sessions.getWorkflowState(caseId, runId);
  }

  async updateWorkflowStage(caseId: string, runId: string, stage: WorkflowStage, blockers: Blocker[] = []): Promise<void> {
    return this.sessions.updateWorkflowStage(caseId, runId, stage, blockers);
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
