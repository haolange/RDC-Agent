/**
 * StorageAdapter - Project / Session / Run 存储层
 * 统一管理 userData 下的项目、会话、运行记录与全局 knowledge。
 */

import * as fs from 'fs';
import * as path from 'path';
import { appendJsonl, readJsonl, writeJsonl } from '@shared/utils/jsonl';
import { readYaml, writeYaml } from '@shared/utils/yaml';
import {
  generateEventId,
  generateRunId,
  generateShortId,
  nowIso,
  nowMs,
  sanitizeToken,
} from '@shared/utils/id';
import type { ActionEvent } from '@shared/types/evidence';
import type { ConversationMessage } from '@shared/types/conversation';
import { sanitizeStoredWorkTrace } from '../conversation/ConversationWorkTrace';
import type {
  Blocker,
  ReasoningSummary,
  WorkflowStage,
  WorkflowState,
} from '@shared/types/workflow';
import { normalizeWorkflowStage } from '@shared/constants/stages';
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
import { appPathService } from '../runtime/AppPathService';
import type {
  PersistedRunRecord,
  ProjectRegistry,
  SelectionState,
  SessionEvidenceRecord,
} from './storageTypes';
import type { SessionContextTurnEntry } from '../conversation/SessionContextJournal';

export class StorageAdapter {
  private dataRootPath = '';
  private projectsRootPath = '';
  private globalKnowledgePath = '';
  private registryPath = '';
  private selectionPath = '';

  constructor() {
    this.syncRuntimePaths();
  }

  getWorkspacePath(): string {
    this.syncRuntimePaths();
    return this.dataRootPath;
  }

  getGlobalKnowledgePath(): string {
    this.syncRuntimePaths();
    return this.globalKnowledgePath;
  }

  async initializeWorkspace(): Promise<void> {
    this.syncRuntimePaths();
    this.ensureDir(this.dataRootPath);
    this.ensureDir(this.projectsRootPath);
    this.ensureRegistry();
    this.ensureSelection();
    this.ensureDir(this.globalKnowledgePath);
  }

  listProjects(): ProjectRecord[] {
    return this.readRegistry().projects
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  createProject(rootPath: string): ProjectRecord {
    const normalizedRootPath = path.resolve(rootPath);
    if (!fs.existsSync(normalizedRootPath) || !fs.statSync(normalizedRootPath).isDirectory()) {
      throw new Error(`Project root is not a directory: ${normalizedRootPath}`);
    }

    const registry = this.readRegistry();
    const existing = registry.projects.find((project) => project.rootPath === normalizedRootPath);
    if (existing) {
      this.setCurrentProjectId(existing.projectId);
      return existing;
    }

    const projectName = path.basename(normalizedRootPath) || normalizedRootPath;
    const slug = this.createUniqueProjectSlug(projectName, registry.projects);
    const { resourcePath, knowledgePath, inputsPath } = this.ensureProjectResourceLayout(normalizedRootPath);
    const inputs = this.collectProjectInputs(inputsPath);

    const timestamp = nowMs();
    const project: ProjectRecord = {
      projectId: `proj_${generateShortId()}`,
      name: projectName,
      rootPath: normalizedRootPath,
      slug,
      resourcePath,
      knowledgePath,
      inputsPath,
      inputs,
      inputsUpdatedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    registry.projects.push(project);
    this.writeRegistry(registry);
    this.ensureDir(this.getProjectDataPath(project));
    this.ensureDir(this.getProjectSessionsRoot(project));
    this.writeProjectMetadata(project);
    this.setCurrentProjectId(project.projectId);

    return project;
  }

  renameProject(projectId: string, newName: string): ProjectRecord {
    const registry = this.readRegistry();
    const target = registry.projects.find((project) => project.projectId === projectId);
    if (!target) {
      throw new Error(`Project not found: ${projectId}`);
    }

    target.name = newName;
    target.updatedAt = nowMs();
    
    this.writeRegistry(registry);
    this.writeProjectMetadata(target);
    
    return target;
  }

  removeProject(projectId: string): void {
    const registry = this.readRegistry();
    const target = registry.projects.find((project) => project.projectId === projectId);
    if (!target) return;

    registry.projects = registry.projects.filter((project) => project.projectId !== projectId);
    this.writeRegistry(registry);

    const projectPath = this.getProjectDataPath(target);
    if (fs.existsSync(projectPath)) {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }

    const selection = this.readSelection();
    if (selection.projectId === projectId) {
      selection.projectId = null;
      selection.sessionId = null;
      this.writeSelection(selection);
    }
  }

  removeSession(sessionId: string): void {
    const location = this.findSessionLocation(sessionId);
    if (!location) return;

    const runIds = this.listRuns(sessionId).map((run) => run.runId);
    this.removeSessionSideChannels(sessionId, runIds);

    if (fs.existsSync(location.sessionPath)) {
      fs.rmSync(location.sessionPath, { recursive: true, force: true });
    }

    const selection = this.readSelection();
    if (selection.sessionId === sessionId) {
      selection.sessionId = null;
      this.writeSelection(selection);
    }

    // 删除会话后，若 lastSessionId 仍指向被删会话，收敛到剩余会话之首或置空，
    // 避免 registry.lastSessionId 与实际会话列表脱节导致 sidebar 显示 stale。
    const projectId = location.project.projectId;
    const wasLastSession = location.project.lastSessionId === sessionId;
    if (wasLastSession) {
      const remaining = this.listSessions(projectId);
      this.touchProject(projectId, remaining[0]?.sessionId ?? null);
    } else {
      this.touchProject(projectId);
    }
  }

  /**
   * Clear app-state side channels that are keyed by session/run but live outside the session directory.
   * Does not touch ~/.rdx or project .rdx.
   */
  private removeSessionSideChannels(sessionId: string, runIds: string[]): void {
    const paths = appPathService.getAppStatePaths();
    const safeSessionId = sessionId.replace(/[^\w.-]/g, '_');
    const sideDirs = [
      path.join(paths.tasksPath, safeSessionId),
      path.join(paths.llmCallsPath, safeSessionId),
    ];
    for (const dir of sideDirs) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    const tracesRunsDir = path.join(paths.tracesPath, 'runs');
    const tracesEventsDir = path.join(paths.tracesPath, 'events');
    for (const runId of runIds) {
      const safeRunId = runId.replace(/[^\w.-]/g, '_');
      for (const filePath of [
        path.join(tracesRunsDir, `${safeRunId}.json`),
        path.join(tracesRunsDir, `${runId}.json`),
        path.join(tracesEventsDir, `${safeRunId}.jsonl`),
        path.join(tracesEventsDir, `${runId}.jsonl`),
      ]) {
        if (fs.existsSync(filePath)) {
          fs.rmSync(filePath, { force: true });
        }
      }
    }
  }

  getProjectById(projectId: string): ProjectRecord | null {
    return this.readRegistry().projects.find((project) => project.projectId === projectId) || null;
  }

  listProjectInputs(projectId: string): ProjectInputRecord[] {
    const project = this.getProjectById(projectId);
    if (!project) return [];
    return this.refreshProjectInputs(projectId);
  }

  refreshProjectInputs(projectId: string): ProjectInputRecord[] {
    const project = this.getProjectById(projectId);
    if (!project) return [];

    const normalizedProject = this.normalizeProjectRecord(project);
    const inputs = this.collectProjectInputs(normalizedProject.inputsPath);
    const nextProject: ProjectRecord = {
      ...normalizedProject,
      inputs,
      inputsUpdatedAt: nowMs(),
    };
    this.persistProject(nextProject);
    return nextProject.inputs;
  }

  importProjectInputs(projectId: string, filePaths: string[]): ProjectInputRecord[] {
    const project = this.getProjectById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const normalizedProject = this.normalizeProjectRecord(project);
    this.ensureDir(normalizedProject.inputsPath);

    for (const filePath of filePaths) {
      const sourcePath = path.resolve(filePath);
      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
        continue;
      }
      if (path.extname(sourcePath).toLowerCase() !== '.rdc') {
        continue;
      }

      const targetPath = this.resolveImportedInputPath(normalizedProject.inputsPath, path.basename(sourcePath));
      fs.copyFileSync(sourcePath, targetPath);
    }

    return this.refreshProjectInputs(projectId);
  }

  listSessions(projectId: string): SessionRecord[] {
    const project = this.getProjectById(projectId);
    if (!project) return [];
    return this.reconcileProjectSessionTitles(project)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  createSession(projectId: string, title?: string, goal: string = ''): SessionRecord {
    const project = this.getProjectById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const timestamp = nowMs();
    const session: SessionRecord = {
      sessionId: `sess_${generateShortId()}`,
      projectId,
      title: this.normalizeSessionTitle(projectId, title),
      goal,
      sessionPath: '',
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const sessionPath = path.join(this.ensureProjectSessionsRoot(project), session.sessionId);
    session.sessionPath = sessionPath;
    this.ensureDir(sessionPath);
    this.ensureDir(path.join(sessionPath, 'attachments'));
    this.ensureDir(path.join(sessionPath, 'timeline'));
    this.ensureDir(path.join(sessionPath, 'runs'));
    this.writeJson(path.join(sessionPath, 'session.json'), session);
    if (!fs.existsSync(path.join(sessionPath, 'action_chain.jsonl'))) {
      fs.writeFileSync(path.join(sessionPath, 'action_chain.jsonl'), '', 'utf-8');
    }
    if (!fs.existsSync(path.join(sessionPath, 'conversation.jsonl'))) {
      fs.writeFileSync(path.join(sessionPath, 'conversation.jsonl'), '', 'utf-8');
    }
    if (!fs.existsSync(path.join(sessionPath, 'attachments.json'))) {
      this.writeJson(path.join(sessionPath, 'attachments.json'), [] satisfies SessionAttachmentRecord[]);
    }
    this.syncSessionEvidence(session.sessionId, session.projectId);

    this.touchProject(project.projectId, session.sessionId, timestamp);
    this.setCurrentProjectId(projectId);
    this.setCurrentSessionId(session.sessionId);

    return session;
  }

  readSession(sessionId: string): SessionRecord | null {
    const location = this.findSessionLocation(sessionId);
    if (!location) return null;
    const sessions = this.reconcileProjectSessionTitles(location.project);
    return sessions.find((session) => session.sessionId === sessionId) ?? null;
  }

  updateSession(sessionId: string, patch: Partial<SessionRecord>): SessionRecord | null {
    const location = this.findSessionLocation(sessionId);
    if (!location) return null;

    const existing = this.readJson<SessionRecord>(path.join(location.sessionPath, 'session.json'));
    if (!existing) return null;

    const nextSession: SessionRecord = {
      ...this.normalizeSessionRecord(existing, location.sessionPath),
      ...patch,
      sessionId: existing.sessionId,
      projectId: existing.projectId,
      sessionPath: location.sessionPath,
      updatedAt: nowMs(),
    };

    this.writeJson(path.join(location.sessionPath, 'session.json'), nextSession);
    this.touchProject(existing.projectId, nextSession.sessionId, nextSession.updatedAt);
    return nextSession;
  }

  listRuns(sessionId: string): RunSummary[] {
    const location = this.findSessionLocation(sessionId);
    if (!location) return [];

    const runsRoot = path.join(location.sessionPath, 'runs');
    if (!fs.existsSync(runsRoot)) {
      return [];
    }

    return fs.readdirSync(runsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.readPersistedRun(sessionId, entry.name))
      .filter((run): run is PersistedRunRecord => run !== null)
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((run) => this.toRunSummary(run));
  }

  getLatestRun(sessionId: string): RunSummary | null {
    return this.listRuns(sessionId)[0] ?? null;
  }

  getCasePath(caseId: string): string {
    const location = this.findSessionLocation(caseId);
    if (!location) {
      throw new Error(`Session not found for case lookup: ${caseId}`);
    }
    return location.sessionPath;
  }

  getRunPath(caseId: string, runId: string): string {
    const location = this.findSessionLocation(caseId);
    if (!location) {
      throw new Error(`Session not found for run lookup: ${caseId}`);
    }
    return path.join(location.sessionPath, 'runs', runId);
  }

  async createCase(input: {
    caseId?: string;
    projectId?: string;
    userGoal: string;
    symptomSummary: string;
  }): Promise<string> {
    const projectId = input.projectId || this.getCurrentProjectId();
    if (!projectId) {
      throw new Error('Project is required before creating a session.');
    }

    if (input.caseId) {
      const existingSession = this.readSession(input.caseId);
      if (existingSession) {
        return existingSession.sessionId;
      }
    }

    const session = this.createSession(
      projectId,
      input.userGoal || input.symptomSummary,
      input.userGoal || input.symptomSummary,
    );
    return session.sessionId;
  }

  async readCase(caseId: string): Promise<Record<string, unknown> | null> {
    const session = this.readSession(caseId);
    if (!session) return null;

    return {
      case_id: session.sessionId,
      project_id: session.projectId,
      title: session.title,
      user_goal: session.goal,
      current_run: session.lastRunId ?? null,
      created_at: new Date(session.createdAt).toISOString(),
      updated_at: new Date(session.updatedAt).toISOString(),
    };
  }

  async updateCase(caseId: string, data: Record<string, unknown>): Promise<void> {
    const title = typeof data.title === 'string'
      ? data.title
      : typeof data.symptom_summary === 'string'
        ? data.symptom_summary
        : undefined;
    const goal = typeof data.user_goal === 'string' ? data.user_goal : undefined;
    const lastRunId = typeof data.current_run === 'string' ? data.current_run : undefined;

    this.updateSession(caseId, {
      title,
      goal,
      lastRunId,
    });
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
    const sessionId = input.sessionId || input.caseId;
    const session = this.readSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const runId = input.runId || generateRunId();
    const runPath = this.getRunPath(sessionId, runId);
    this.ensureDir(runPath);
    this.ensureDir(path.join(runPath, 'artifacts'));
    this.ensureDir(path.join(runPath, 'notes'));
    this.ensureDir(path.join(runPath, 'reports'));
    this.ensureDir(path.join(runPath, 'logs'));
    this.ensureDir(path.join(runPath, 'screenshots'));
    this.ensureDir(path.join(runPath, 'checkpoints'));

    const captures = input.captures
      ? input.captures
      : input.capturePaths.map((filePath, index) => ({
          id: `cap-${index}`,
          filePath,
          role: index === 0 ? ('primary' as const) : ('reference' as const),
          backendHint: 'local' as const,
          status: 'pending' as const,
        }));

    const backend = input.backend
      || (captures.some((capture) => capture.backendHint === 'remote') ? 'remote' : 'local');
    const startedAt = nowMs();
    const persistedRun: PersistedRunRecord = {
      runId,
      turnId: input.turnId,
      projectId: session.projectId,
      sessionId,
      caseId: sessionId,
      mode: input.mode || 'debugger',
      goal: input.goal || session.goal,
      captures,
      startedAt,
      status: input.status || 'queued',
      lastStage: 'preflight',
      backend,
      createdAt: startedAt,
      updatedAt: startedAt,
      runtime: {
        backend,
        entry_mode: 'cli',
        context_id: null,
        runtime_owner: null,
        session_id: sessionId,
        workflow_stage: 'preflight',
      },
    };

    this.writeRunFiles(persistedRun);
    writeYaml(path.join(runPath, 'capture_refs.yaml'), {
      captures: captures.map((capture, index) => ({
        capture_id: capture.id || `cap-${index}`,
        capture_role: capture.role,
        source_path: capture.filePath,
      })),
    });
    writeYaml(path.join(runPath, 'notes', 'hypothesis_board.yaml'), {
      hypothesis_board: {
        session_id: sessionId,
        entry_skill: 'debugger',
        user_goal: persistedRun.goal,
        intake_state: 'handoff_ready',
        current_phase: 'intake',
        current_task: '',
        active_owner: 'debugger',
        pending_requirements: [],
        blocking_issues: [],
        progress_summary: ['accepted intake complete'],
        next_actions: ['run dispatch_readiness before specialist dispatch'],
        last_updated: nowIso(),
        hypotheses: [],
      },
    });

    this.updateSession(sessionId, {
      goal: persistedRun.goal,
      lastRunId: runId,
    });
    this.syncSessionEvidence(sessionId, session.projectId);
    this.touchProject(session.projectId, sessionId);
    this.setCurrentProjectId(session.projectId);
    this.setCurrentSessionId(sessionId);

    return { runId, sessionId };
  }

  async readRun(caseId: string, runId: string): Promise<Record<string, unknown> | null> {
    const run = this.readPersistedRun(caseId, runId);
    return run ? run as unknown as Record<string, unknown> : null;
  }

  async updateRun(caseId: string, runId: string, data: Record<string, unknown>): Promise<void> {
    const existing = this.readPersistedRun(caseId, runId);
    if (!existing) {
      return;
    }

    const merged = this.deepMerge(
      existing as unknown as Record<string, unknown>,
      data,
    ) as unknown as PersistedRunRecord;
    const workflowStage = merged.runtime?.workflow_stage || existing.runtime.workflow_stage;
    merged.runtime = {
      ...existing.runtime,
      ...(merged.runtime || {}),
      workflow_stage: workflowStage,
    };
    merged.lastStage = workflowStage;
    merged.updatedAt = nowMs();

    if (workflowStage === 'finalize' && merged.status === 'running') {
      merged.status = 'completed';
      merged.finishedAt = merged.finishedAt || merged.updatedAt;
    }

    this.writeRunFiles(merged);
    this.updateSession(caseId, {
      lastRunId: runId,
    });
    this.syncSessionEvidence(caseId, existing.projectId);
  }

  async writeArtifact(caseId: string, runId: string, artifactName: string, data: unknown): Promise<string> {
    const artifactPath = path.join(this.getRunPath(caseId, runId), 'artifacts', artifactName);
    writeYaml(artifactPath, data);
    return artifactPath;
  }

  async readArtifact(caseId: string, runId: string, artifactName: string): Promise<Record<string, unknown> | null> {
    const artifactPath = path.join(this.getRunPath(caseId, runId), 'artifacts', artifactName);
    return readYaml<Record<string, unknown>>(artifactPath);
  }

  getActionChainPath(sessionId: string): string {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for action chain: ${sessionId}`);
    }
    return path.join(location.sessionPath, 'action_chain.jsonl');
  }

  getConversationPath(sessionId: string): string {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for conversation history: ${sessionId}`);
    }
    return path.join(location.sessionPath, 'conversation.jsonl');
  }

  getConversationBranchStatePath(sessionId: string): string {
    const location = this.findSessionLocation(sessionId);
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
    return this.readJson<import('@shared/types/conversationBranch').ConversationBranchState>(filePath);
  }

  writeConversationBranchState(
    sessionId: string,
    state: import('@shared/types/conversationBranch').ConversationBranchState,
  ): void {
    const filePath = this.getConversationBranchStatePath(sessionId);
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    this.ensureDir(path.dirname(filePath));
    fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2), 'utf-8');
    try {
      fs.renameSync(temporaryPath, filePath);
    } catch (error) {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
      throw error;
    }
  }

  getSessionAttachmentsDir(sessionId: string): string {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for attachments: ${sessionId}`);
    }
    const attachmentsDir = path.join(location.sessionPath, 'attachments');
    this.ensureDir(attachmentsDir);
    return attachmentsDir;
  }

  getSessionAttachmentsManifestPath(sessionId: string): string {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for attachment manifest: ${sessionId}`);
    }
    return path.join(location.sessionPath, 'attachments.json');
  }

  getSessionEvidencePath(sessionId: string): string {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for session evidence: ${sessionId}`);
    }
    return path.join(location.sessionPath, 'session_evidence.yaml');
  }

  writeSessionPlanArtifact(sessionId: string, content: string): string {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for plan artifact: ${sessionId}`);
    }
    const artifactsDir = path.join(location.sessionPath, 'artifacts');
    this.ensureDir(artifactsDir);
    const artifactPath = path.join(artifactsDir, 'plan.md');
    fs.writeFileSync(artifactPath, content, 'utf8');
    return artifactPath;
  }

  /** Session 目录下的上下文用量快照路径。 */
  getSessionUsagePath(sessionId: string): string | null {
    const location = this.findSessionLocation(sessionId);
    if (!location) return null;
    return path.join(location.sessionPath, 'usage.json');
  }

  /** 读取落盘的 RunContextUsageSummary；文件缺失或损坏时返回 null。 */
  readSessionUsage(sessionId: string): RunContextUsageSummary | null {
    if (sessionId.includes('::subagent::')) {
      return null;
    }
    const usagePath = this.getSessionUsagePath(sessionId);
    if (!usagePath) return null;
    return this.readJson<RunContextUsageSummary>(usagePath);
  }

  /** 覆盖写入最新用量快照（小文件，不做迁移）。 */
  writeSessionUsage(sessionId: string, usage: RunContextUsageSummary): void {
    if (sessionId.includes('::subagent::')) {
      return;
    }
    const usagePath = this.getSessionUsagePath(sessionId);
    if (!usagePath) {
      throw new Error(`Session not found for usage snapshot: ${sessionId}`);
    }
    this.writeJson(usagePath, usage);
  }

  getSessionContextJournalPath(sessionId: string): string {
    const location = this.findSessionLocation(sessionId);
    if (!location) throw new Error(`Session not found for context journal: ${sessionId}`);
    return path.join(location.sessionPath, 'session-context.jsonl');
  }

  readSessionContextJournal(sessionId: string): SessionContextTurnEntry[] {
    const journalPath = this.getSessionContextJournalPath(sessionId);
    return fs.existsSync(journalPath) ? readJsonl<SessionContextTurnEntry>(journalPath) : [];
  }

  appendSessionContextTurn(sessionId: string, entry: SessionContextTurnEntry): void {
    appendJsonl(this.getSessionContextJournalPath(sessionId), entry);
  }

  readSessionContextMigrationVersion(sessionId: string): number {
    const location = this.findSessionLocation(sessionId);
    if (!location) throw new Error(`Session not found for context migration: ${sessionId}`);
    const markerPath = path.join(location.sessionPath, 'session-context-version.json');
    if (!fs.existsSync(markerPath)) return 0;
    const marker = this.readJson<{ version?: number }>(markerPath);
    return marker?.version === 1 ? 1 : 0;
  }

  writeSessionContextMigrationVersion(sessionId: string): void {
    const location = this.findSessionLocation(sessionId);
    if (!location) throw new Error(`Session not found for context migration: ${sessionId}`);
    const markerPath = path.join(location.sessionPath, 'session-context-version.json');
    const temporaryPath = `${markerPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify({ version: 1 }, null, 2), 'utf8');
    try {
      fs.renameSync(temporaryPath, markerPath);
    } catch (error) {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
      throw error;
    }
  }

  readConversationHistory(sessionId: string): ConversationMessage[] {
    const snapshots = readJsonl<ConversationMessage>(this.getConversationPath(sessionId));
    const latestById = new Map<string, ConversationMessage>();

    for (const snapshot of snapshots) {
      const existing = latestById.get(snapshot.id);
      const existingUpdatedAt = existing?.updatedAt ?? existing?.createdAt ?? 0;
      const nextUpdatedAt = snapshot.updatedAt ?? snapshot.createdAt;
      if (!existing || nextUpdatedAt >= existingUpdatedAt) {
        latestById.set(snapshot.id, snapshot);
      }
    }

    return Array.from(latestById.values())
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((message) => ({
        ...message,
        workTrace: sanitizeStoredWorkTrace(message.workTrace ?? null),
      }));
  }

  appendConversationMessage(sessionId: string, message: ConversationMessage): void {
    appendJsonl(this.getConversationPath(sessionId), message);
  }

  writeConversationHistory(sessionId: string, messages: ConversationMessage[]): void {
    writeJsonl(this.getConversationPath(sessionId), messages);
    this.updateSession(sessionId, {});
  }

  listSessionAttachments(sessionId: string): SessionAttachmentRecord[] {
    return this.readSessionAttachments(sessionId)
      .slice()
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  importSessionAttachments(sessionId: string, filePaths: string[]): SessionAttachmentRecord[] {
    const session = this.readSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const attachmentsDir = this.getSessionAttachmentsDir(sessionId);
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
      this.touchProject(session.projectId, session.sessionId);
    }

    return imported;
  }

  readSessionEvidence(sessionId: string): SessionEvidenceRecord | null {
    return readYaml<SessionEvidenceRecord>(this.getSessionEvidencePath(sessionId));
  }

  async appendActionEvent(sessionId: string, event: ActionEvent): Promise<void> {
    appendJsonl(this.getActionChainPath(sessionId), event);
    this.updateSession(sessionId, {});
    const session = this.readSession(sessionId);
    if (session) {
      this.syncSessionEvidence(sessionId, session.projectId);
    }
  }

  async readActionChain(sessionId: string): Promise<ActionEvent[]> {
    const actionChainPath = this.getActionChainPath(sessionId);
    return readJsonl<ActionEvent>(actionChainPath);
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
    return {
      schema_version: '2',
      event_id: generateEventId('evt'),
      turn_id: input.turnId,
      ts_ms: nowMs(),
      run_id: input.runId,
      session_id: input.sessionId,
      agent_id: input.agentId,
      event_type: input.eventType,
      status: input.status,
      duration_ms: 0,
      refs: input.refs || [],
      payload: input.payload,
    };
  }

  async getWorkflowState(caseId: string, runId: string): Promise<WorkflowState | null> {
    const run = this.readPersistedRun(caseId, runId);
    if (!run) return null;

    return {
      caseId,
      runId,
      sessionId: run.sessionId,
      currentStage: run.runtime.workflow_stage,
      previousStages: [],
      entryMode: run.runtime.entry_mode,
      backend: run.runtime.backend,
      orchestrationMode: 'multi_agent',
      coordinationMode: 'staged_handoff',
      blockers: [],
      lastUpdated: new Date(run.updatedAt).toISOString(),
    };
  }

  async updateWorkflowStage(caseId: string, runId: string, stage: WorkflowStage, blockers: Blocker[] = []): Promise<void> {
    const run = this.readPersistedRun(caseId, runId);
    if (!run) return;

    run.runtime.workflow_stage = stage;
    run.lastStage = stage;
    run.updatedAt = nowMs();

    if (stage === 'finalize') {
      run.status = 'completed';
      run.finishedAt = run.finishedAt || run.updatedAt;
    }

    this.writeRunFiles(run);

    if (blockers.length > 0) {
      const boardPath = path.join(this.getRunPath(caseId, runId), 'notes', 'hypothesis_board.yaml');
      const board = readYaml<Record<string, unknown>>(boardPath) || {};
      const hypothesisBoard = (board.hypothesis_board as Record<string, unknown>) || {};
      hypothesisBoard.blocking_issues = blockers;
      hypothesisBoard.last_updated = nowIso();
      board.hypothesis_board = hypothesisBoard;
      writeYaml(boardPath, board);
    }
  }

  getCurrentProjectId(): string | null {
    return this.readSelection().projectId;
  }

  setCurrentProjectId(projectId: string | null): void {
    const selection = this.readSelection();
    selection.projectId = projectId;
    if (!projectId) {
      selection.sessionId = null;
    } else if (selection.sessionId) {
      const selectedSession = this.readSession(selection.sessionId);
      if (!selectedSession || selectedSession.projectId !== projectId) {
        selection.sessionId = null;
      }
    }
    this.writeSelection(selection);
  }

  async getCurrentSessionId(): Promise<string | null> {
    return this.readSelection().sessionId;
  }

  async setCurrentSessionId(sessionId: string | null): Promise<void> {
    const selection = this.readSelection();
    selection.sessionId = sessionId;
    if (sessionId) {
      const session = this.readSession(sessionId);
      if (session) {
        selection.projectId = session.projectId;
      }
    }
    this.writeSelection(selection);
  }

  private syncSessionEvidence(sessionId: string, projectId: string): void {
    const latestRun = this.getLatestRun(sessionId);
    const actionEvents = fs.existsSync(this.getActionChainPath(sessionId))
      ? readJsonl<ActionEvent>(this.getActionChainPath(sessionId))
      : [];
    const eventCounts = actionEvents.reduce<Record<string, number>>((acc, event) => {
      acc[event.event_type] = (acc[event.event_type] || 0) + 1;
      return acc;
    }, {});
    const activeBlockers = actionEvents
      .filter((event) => event.event_type === 'blocker')
      .map((event) => ({
        code: String(event.payload.code || 'BLOCKER'),
        reason: String(event.payload.reason || event.payload.message || 'Blocker'),
        refs: Array.isArray(event.refs) ? event.refs : [],
        detectedAt: new Date(event.ts_ms).toISOString(),
      }));
    const verificationSummary = actionEvents
      .filter((event) => event.event_type === 'verification')
      .slice(-5)
      .map((event) => String(event.payload.summary || event.payload.verdict || event.payload.verification_kind || 'verification'));
    const reasoningSummaries = actionEvents
      .filter((event) => event.event_type === 'agent_summary')
      .slice(-10)
      .map((event, index) => ({
        summaryId: `summary-${index}-${event.event_id}`,
        stage: normalizeWorkflowStage(String(event.payload.stage || latestRun?.lastStage || 'investigate')),
        agentId: String(event.agent_id) as ReasoningSummary['agentId'],
        summary: String(event.payload.summary || event.payload.content || ''),
        evidence: Array.isArray(event.payload.evidence) ? event.payload.evidence.map(String) : [],
        nextStep: String(event.payload.next_step || event.payload.nextStep || ''),
        confidence: typeof event.payload.confidence === 'number' ? event.payload.confidence : 0.5,
        createdAt: new Date(event.ts_ms).toISOString(),
      }));

    const record: SessionEvidenceRecord = {
      schema_version: '1',
      session_id: sessionId,
      project_id: projectId,
      latest_run_id: latestRun?.runId || null,
      latest_run_status: latestRun?.status || null,
      latest_stage: latestRun?.lastStage || null,
      updated_at: nowIso(),
      event_counts: eventCounts,
      active_blockers: activeBlockers,
      verification_summary: verificationSummary,
      reasoning_summaries: reasoningSummaries,
      report_paths: latestRun?.reportPaths || null,
    };

    writeYaml(this.getSessionEvidencePath(sessionId), record);
  }

  private syncRuntimePaths(): void {
    const paths = appPathService.getRuntimePaths();
    this.dataRootPath = paths.appStateRoot;
    this.projectsRootPath = paths.projectsPath;
    this.globalKnowledgePath = paths.knowledgePath;
    this.registryPath = path.join(this.projectsRootPath, 'registry.json');
    this.selectionPath = path.join(this.projectsRootPath, 'selection.json');
  }

  private ensureRegistry(): void {
    if (fs.existsSync(this.registryPath)) {
      return;
    }

    this.writeJson(this.registryPath, {
      schemaVersion: '1',
      projects: [],
    } satisfies ProjectRegistry);
  }

  private ensureSelection(): void {
    if (fs.existsSync(this.selectionPath)) {
      return;
    }

    this.writeJson(this.selectionPath, {
      projectId: null,
      sessionId: null,
    } satisfies SelectionState);
  }

  private readRegistry(): ProjectRegistry {
    const registry = this.readJson<ProjectRegistry>(this.registryPath) || {
      schemaVersion: '1',
      projects: [],
    };
    const normalizedProjects = registry.projects.map((project) => this.normalizeProjectRecord(project));
    const changed = JSON.stringify(normalizedProjects) !== JSON.stringify(registry.projects);

    if (changed) {
      registry.projects = normalizedProjects;
      this.writeRegistry(registry);
    } else {
      registry.projects = normalizedProjects;
    }

    return registry;
  }

  private writeRegistry(registry: ProjectRegistry): void {
    this.writeJson(this.registryPath, registry);
  }

  private readSelection(): SelectionState {
    return this.readJson<SelectionState>(this.selectionPath) || {
      projectId: null,
      sessionId: null,
    };
  }

  private writeSelection(selection: SelectionState): void {
    this.writeJson(this.selectionPath, selection);
  }

  private writeProjectMetadata(project: ProjectRecord): void {
    const normalizedProject = this.normalizeProjectRecord(project);
    this.ensureDir(this.getProjectDataPath(normalizedProject));
    this.writeJson(path.join(this.getProjectDataPath(normalizedProject), 'project.json'), normalizedProject);
    const projectPaths = appPathService.initializeProjectRdx(normalizedProject.rootPath);
    writeYaml(projectPaths.projectMetadataPath, {
      schema_version: '1',
      name: normalizedProject.name,
    });
  }

  private writeRunFiles(run: PersistedRunRecord): void {
    const runPath = this.getRunPath(run.sessionId, run.runId);
    this.ensureDir(runPath);
    this.writeJson(path.join(runPath, 'run.json'), run);
    writeYaml(path.join(runPath, 'run.yaml'), {
      run_id: run.runId,
      turn_id: run.turnId,
      session_id: run.sessionId,
      case_id: run.caseId,
      project_id: run.projectId,
      created_at: new Date(run.createdAt).toISOString(),
      updated_at: new Date(run.updatedAt).toISOString(),
      mode: run.mode,
      goal: run.goal,
      status: run.status,
      last_stage: run.lastStage,
      coordination_mode: 'staged_handoff',
      orchestration_mode: 'multi_agent',
      runtime: run.runtime,
      captures: run.captures,
    });
  }

  private touchProject(projectId: string, lastSessionId?: string | null, updatedAt: number = nowMs()): void {
    const registry = this.readRegistry();
    const nextProjects = registry.projects.map((project) => {
      if (project.projectId !== projectId) return project;
      const nextLastSessionId = lastSessionId === undefined
        ? project.lastSessionId
        : lastSessionId || undefined;
      return {
        ...project,
        updatedAt,
        lastSessionId: nextLastSessionId,
      };
    });

    registry.projects = nextProjects;
    this.writeRegistry(registry);

    const project = registry.projects.find((item) => item.projectId === projectId);
    if (project) {
      this.writeProjectMetadata(project);
    }
  }

  private getProjectDataPath(project: ProjectRecord | string): string {
    const target = typeof project === 'string' ? this.getProjectById(project) : project;
    if (!target) {
      throw new Error(`Project not found: ${project}`);
    }
    return path.join(this.projectsRootPath, target.slug);
  }

  private getProjectSessionsRoot(project: ProjectRecord | string): string {
    const target = typeof project === 'string' ? this.getProjectById(project) : project;
    if (!target) {
      throw new Error(`Project not found: ${project}`);
    }
    return path.join(appPathService.getAppStatePaths().sessionsPath, target.projectId);
  }

  private ensureProjectSessionsRoot(project: ProjectRecord | string): string {
    const target = typeof project === 'string' ? this.getProjectById(project) : project;
    if (!target) {
      throw new Error(`Project not found: ${project}`);
    }

    const sessionsRoot = this.getProjectSessionsRoot(target);
    this.ensureDir(sessionsRoot);

    return sessionsRoot;
  }

  private findSessionLocation(sessionId: string): { project: ProjectRecord; sessionPath: string } | null {
    for (const project of this.listProjects()) {
      const sessionPath = path.join(this.ensureProjectSessionsRoot(project), sessionId);
      if (fs.existsSync(path.join(sessionPath, 'session.json'))) {
        return { project, sessionPath };
      }
    }
    return null;
  }

  private normalizeSessionRecord(session: SessionRecord, sessionPath?: string): SessionRecord {
    const resolvedSessionPath = sessionPath || this.findSessionLocation(session.sessionId)?.sessionPath || session.sessionPath;
    return {
      ...session,
      sessionPath: resolvedSessionPath || '',
    };
  }

  private readPersistedRun(sessionId: string, runId: string): PersistedRunRecord | null {
    const runJsonPath = path.join(this.getRunPath(sessionId, runId), 'run.json');
    const runJson = this.readJson<PersistedRunRecord>(runJsonPath);
    if (runJson) {
      runJson.lastStage = normalizeWorkflowStage(runJson.lastStage);
      runJson.runtime.workflow_stage = normalizeWorkflowStage(runJson.runtime.workflow_stage);
      return runJson;
    }

    const runYaml = readYaml<Record<string, unknown>>(path.join(this.getRunPath(sessionId, runId), 'run.yaml'));
    if (!runYaml) {
      return null;
    }

    return {
      runId,
      turnId: typeof runYaml.turn_id === 'string' ? runYaml.turn_id : undefined,
      projectId: String(runYaml.project_id || ''),
      sessionId,
      caseId: String(runYaml.case_id || sessionId),
      mode: (runYaml.mode as ExecutableAppMode) || 'debugger',
      goal: String(runYaml.goal || ''),
      captures: (runYaml.captures as CaptureDescriptor[]) || [],
      startedAt: Date.parse(String(runYaml.created_at || nowIso())),
      finishedAt: runYaml.finished_at ? Date.parse(String(runYaml.finished_at)) : undefined,
      status: (runYaml.status as PersistedRunRecord['status']) || 'running',
      lastStage: normalizeWorkflowStage(String(runYaml.last_stage || 'preflight')),
      backend: ((runYaml.runtime as Record<string, unknown>)?.backend as 'local' | 'remote') || 'local',
      createdAt: Date.parse(String(runYaml.created_at || nowIso())),
      updatedAt: Date.parse(String(runYaml.updated_at || runYaml.created_at || nowIso())),
      runtime: {
        backend: ((runYaml.runtime as Record<string, unknown>)?.backend as 'local' | 'remote') || 'local',
        entry_mode: (((runYaml.runtime as Record<string, unknown>)?.entry_mode as 'cli' | 'mcp') || 'cli'),
        context_id: ((runYaml.runtime as Record<string, unknown>)?.context_id as string | null) || null,
        runtime_owner: ((runYaml.runtime as Record<string, unknown>)?.runtime_owner as string | null) || null,
        session_id: String((runYaml.runtime as Record<string, unknown>)?.session_id || sessionId),
        workflow_stage: normalizeWorkflowStage((runYaml.runtime as Record<string, unknown>)?.workflow_stage as string | undefined),
      },
    };
  }

  private toRunSummary(run: PersistedRunRecord): RunSummary {
    return {
      runId: run.runId,
      turnId: run.turnId,
      projectId: run.projectId,
      sessionId: run.sessionId,
      caseId: run.caseId,
      mode: run.mode,
      goal: run.goal,
      captures: run.captures,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      stoppedAt: run.stoppedAt,
      status: run.status,
      stopReason: run.stopReason,
      lastStage: run.lastStage,
      backend: run.backend,
      reportPaths: run.reportPaths,
    };
  }

  private normalizeSessionTitle(projectId: string, title?: string): string {
    const normalized = title?.trim();
    if (normalized) {
      return normalized.slice(0, 80);
    }

    const nextIndex = this.getNextDefaultSessionIndex(projectId);
    return `new session ${nextIndex}`;
  }

  private getNextDefaultSessionIndex(projectId: string): number {
    const sessions = this.listSessions(projectId);
    const defaultTitlePattern = /^new session (\d+)$/i;
    const usedIndexes = sessions
      .map((session) => {
        const match = session.title.trim().match(defaultTitlePattern);
        return match ? Number.parseInt(match[1], 10) : null;
      })
      .filter((value): value is number => value !== null && Number.isInteger(value) && value >= 0);

    if (usedIndexes.length === 0) {
      return 0;
    }

    return Math.max(...usedIndexes) + 1;
  }

  private reconcileProjectSessionTitles(project: ProjectRecord): SessionRecord[] {
    const storedSessions = this.readProjectSessions(project);
    const normalizedSessions = storedSessions.map(({ session, sessionPath }) => (
      this.normalizeSessionRecord(session, sessionPath)
    ));
    const autoGeneratedTitlePattern = /^new session (\d+)$/i;
    const timestampTitlePattern = /^Session \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
    const autoSessions = normalizedSessions
      .filter((session) => (
        autoGeneratedTitlePattern.test(session.title.trim()) || timestampTitlePattern.test(session.title.trim())
      ))
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) {
          return a.createdAt - b.createdAt;
        }
        return a.sessionId.localeCompare(b.sessionId);
      });

    if (autoSessions.length === 0) {
      return normalizedSessions;
    }

    const nextTitlesBySessionId = new Map<string, string>();
    autoSessions.forEach((session, index) => {
      nextTitlesBySessionId.set(session.sessionId, `new session ${index}`);
    });

    let didRewrite = false;
    const rewrittenBySessionId = new Map<string, SessionRecord>();

    for (const { sessionPath } of storedSessions) {
      const session = normalizedSessions.find((entry) => entry.sessionPath === sessionPath);
      if (!session) {
        continue;
      }

      const nextTitle = nextTitlesBySessionId.get(session.sessionId);
      if (nextTitle && session.title !== nextTitle) {
        const rewrittenSession: SessionRecord = {
          ...session,
          title: nextTitle,
        };
        this.writeJson(path.join(sessionPath, 'session.json'), rewrittenSession);
        rewrittenBySessionId.set(session.sessionId, rewrittenSession);
        didRewrite = true;
        continue;
      }

      rewrittenBySessionId.set(session.sessionId, session);
    }

    if (!didRewrite) {
      return normalizedSessions;
    }

    return normalizedSessions.map((session) => rewrittenBySessionId.get(session.sessionId) ?? session);
  }

  private readProjectSessions(project: ProjectRecord): Array<{ session: SessionRecord; sessionPath: string }> {
    const sessionsRoot = this.ensureProjectSessionsRoot(project);
    if (!fs.existsSync(sessionsRoot)) {
      return [];
    }

    return fs.readdirSync(sessionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const sessionPath = path.join(sessionsRoot, entry.name);
        const session = this.readJson<SessionRecord>(path.join(sessionPath, 'session.json'));
        return session ? { session, sessionPath } : null;
      })
      .filter((entry): entry is { session: SessionRecord; sessionPath: string } => entry !== null);
  }

  private createUniqueProjectSlug(projectName: string, existingProjects: ProjectRecord[]): string {
    const baseSlug = sanitizeToken(projectName.toLowerCase()) || 'project';
    const existingSlugs = new Set(existingProjects.map((project) => project.slug));
    if (!existingSlugs.has(baseSlug)) {
      return baseSlug;
    }

    let counter = 2;
    while (existingSlugs.has(`${baseSlug}-${counter}`)) {
      counter += 1;
    }
    return `${baseSlug}-${counter}`;
  }

  private ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  private readJson<T>(filePath: string): T | null {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
    } catch (error) {
      console.error(`Failed to read JSON file: ${filePath}`, error);
      return null;
    }
  }

  private writeJson(filePath: string, data: unknown): void {
    this.ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private deepMerge<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
    const output: Record<string, unknown> = { ...base };

    for (const [key, value] of Object.entries(patch)) {
      if (Array.isArray(value)) {
        output[key] = value;
        continue;
      }

      if (value && typeof value === 'object') {
        const existingValue = output[key];
        output[key] = this.deepMerge(
          (existingValue && typeof existingValue === 'object' && !Array.isArray(existingValue)
            ? existingValue
            : {}) as Record<string, unknown>,
          value as Record<string, unknown>,
        );
        continue;
      }

      output[key] = value;
    }

    return output as T;
  }

  private persistProject(project: ProjectRecord): void {
    const registry = this.readRegistry();
    registry.projects = registry.projects.map((entry) => entry.projectId === project.projectId ? project : entry);
    this.writeRegistry(registry);
    this.writeProjectMetadata(project);
  }

  private ensureProjectResourceLayout(rootPath: string): {
    resourcePath: string;
    knowledgePath: string;
    inputsPath: string;
  } {
    const projectPaths = appPathService.initializeProjectRdx(rootPath);
    return {
      resourcePath: projectPaths.projectRdxRoot,
      knowledgePath: projectPaths.knowledgePath,
      inputsPath: projectPaths.inputsPath,
    };
  }

  private normalizeProjectRecord(project: ProjectRecord): ProjectRecord {
    const rootPath = path.resolve(project.rootPath);
    const { resourcePath, knowledgePath, inputsPath } = this.ensureProjectResourceLayout(rootPath);
    const inputs = this.collectProjectInputs(inputsPath);
    return {
      ...project,
      rootPath,
      resourcePath,
      knowledgePath,
      inputsPath,
      inputs,
      inputsUpdatedAt: project.inputsUpdatedAt || nowMs(),
    };
  }

  private collectProjectInputs(inputsPath: string): ProjectInputRecord[] {
    if (!fs.existsSync(inputsPath)) {
      return [];
    }

    const records: ProjectInputRecord[] = [];
    const walk = (dirPath: string) => {
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (path.extname(entry.name).toLowerCase() !== '.rdc') {
          continue;
        }

        const stats = fs.statSync(fullPath);
        records.push({
          inputId: this.createProjectInputId(inputsPath, fullPath),
          fileName: path.basename(fullPath),
          filePath: fullPath,
          source: 'project_resource',
          discoveredAt: stats.birthtimeMs || stats.ctimeMs || stats.mtimeMs,
          lastModifiedAt: stats.mtimeMs,
          size: stats.size,
        });
      }
    };

    walk(inputsPath);
    return records.sort((a, b) => a.fileName.localeCompare(b.fileName));
  }

  private createProjectInputId(inputsPath: string, filePath: string): string {
    const relativePath = path.relative(inputsPath, filePath).replace(/[\\/]+/g, '_');
    const sanitized = sanitizeToken(relativePath.toLowerCase().replace(/\.rdc$/i, ''));
    return `input_${sanitized || generateShortId()}`;
  }

  private resolveImportedInputPath(inputsPath: string, fileName: string): string {
    const extension = path.extname(fileName);
    const baseName = path.basename(fileName, extension);
    let candidate = path.join(inputsPath, fileName);
    let counter = 2;
    while (fs.existsSync(candidate)) {
      candidate = path.join(inputsPath, `${baseName}-${counter}${extension}`);
      counter += 1;
    }
    return candidate;
  }

  private readSessionAttachments(sessionId: string): SessionAttachmentRecord[] {
    return this.readJson<SessionAttachmentRecord[]>(this.getSessionAttachmentsManifestPath(sessionId)) ?? [];
  }

  private writeSessionAttachments(sessionId: string, attachments: SessionAttachmentRecord[]): void {
    this.writeJson(this.getSessionAttachmentsManifestPath(sessionId), attachments);
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


export const storageAdapter = new StorageAdapter();
