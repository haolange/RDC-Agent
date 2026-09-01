import * as fs from 'fs';
import * as path from 'path';
import { appendJsonl, assertNoJsonlDiagnostics, readJsonl } from '@shared/utils/jsonl';
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
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type {
  Blocker,
  WorkflowStage,
  WorkflowState,
} from '@shared/types/workflow';
import type {
  CaptureDescriptor,
  ProjectRecord,
  RunSummary,
  SessionRecord,
} from '@shared/types/session';
import { isMissionAgentId } from '@shared/types/agent';
import { toPersistedRunV2 } from './runV2/runRecordSchema';
import { appPathService } from '../runtime/AppPathService';
import type { PersistedRunRecord } from './storageTypes';
import type { ReservedStagedConversationSession, StagedConversationSessionCommit } from './storageCommitTypes';
import { SessionRecordSchema, toSessionAttachmentManifest } from './storageSchema';
import { reconcileProjectSessionTitles } from './sessionRecordReconcile';
import { readPersistedRun as loadPersistedRun, toRunSummary, writeRunFiles as persistRunFiles } from './sessionRunPersistence';


const SAFE_RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isSafeRunId(runId: string): boolean {
  if (!runId || typeof runId !== 'string') return false;
  if (runId === '.' || runId === '..') return false;
  if (runId.includes('/') || runId.includes('\\') || runId.includes('\0')) return false;
  if (path.isAbsolute(runId)) return false;
  return SAFE_RUN_ID_RE.test(runId);
}

export class SessionRecordStore {
  constructor(private readonly host: import('./storageHost').StorageHost) {}

  removeSession(sessionId: string): void {
    const location = this.findSessionLocation(sessionId);
    if (!location) return;

    const runIds = this.listRuns(sessionId).map((run) => run.runId);
    this.removeSessionSideChannels(sessionId, runIds);

    if (fs.existsSync(location.sessionPath)) {
      fs.rmSync(location.sessionPath, { recursive: true, force: true });
    }

    const selection = this.host.projects.readSelection();
    if (selection.sessionId === sessionId) {
      selection.sessionId = null;
      this.host.projects.writeSelection(selection);
    }

    // 删除会话后，若 lastSessionId 仍指向被删会话，收敛到剩余会话之首或置空，
    // 避免 registry.lastSessionId 与实际会话列表脱节导致 sidebar 显示 stale。
    const projectId = location.project.projectId;
    const wasLastSession = location.project.lastSessionId === sessionId;
    if (wasLastSession) {
      const remaining = this.listSessions(projectId);
      this.host.projects.touchProject(projectId, remaining[0]?.sessionId ?? null);
    } else {
      this.host.projects.touchProject(projectId);
    }
  }

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

  listSessions(projectId: string): SessionRecord[] {
    const project = this.host.projects.getProjectById(projectId);
    if (!project) return [];
    return reconcileProjectSessionTitles(this.host, project, (session, sessionPath) => (
      this.normalizeSessionRecord(session, sessionPath)
    ))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  createSession(projectId: string, title?: string, goal: string = ''): SessionRecord {
    const project = this.host.projects.getProjectById(projectId);
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

    const sessionPath = path.join(this.host.projects.ensureProjectSessionsRoot(project), session.sessionId);
    session.sessionPath = sessionPath;
    this.host.io.ensureDir(sessionPath);
    this.host.io.ensureDir(path.join(sessionPath, 'attachments'));
    this.host.io.ensureDir(path.join(sessionPath, 'timeline'));
    this.host.io.ensureDir(path.join(sessionPath, 'runs'));
    this.host.io.writeJsonAtomic(path.join(sessionPath, 'session.json'), session);
    if (!fs.existsSync(path.join(sessionPath, 'action_chain.jsonl'))) {
      fs.writeFileSync(path.join(sessionPath, 'action_chain.jsonl'), '', 'utf-8');
    }
    if (!fs.existsSync(path.join(sessionPath, 'conversation.jsonl'))) {
      fs.writeFileSync(path.join(sessionPath, 'conversation.jsonl'), '', 'utf-8');
    }
    if (!fs.existsSync(path.join(sessionPath, 'attachments.json'))) {
      this.host.io.writeJsonAtomic(path.join(sessionPath, 'attachments.json'), toSessionAttachmentManifest([]));
    }
    this.host.projects.touchProject(project.projectId, session.sessionId, timestamp);
    this.host.projects.setCurrentProjectId(projectId);
    this.host.projects.setCurrentSessionId(session.sessionId);

    return session;
  }

  allocateStagedConversationSession(
    projectId: string,
    title: string,
    requestId: string,
    turnId: string,
  ): ReservedStagedConversationSession {
    const project = this.host.projects.getProjectById(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const timestamp = nowMs();
    const sessionId = `sess_${generateShortId()}`;
    const sessionsRoot = this.host.projects.ensureProjectSessionsRoot(project);
    const finalPath = path.join(sessionsRoot, sessionId);
    const stagingPath = path.join(
      sessionsRoot,
      `.turn-staging-${sanitizeToken(requestId).slice(0, 48) || generateShortId()}-${sessionId}`,
    );
    return {
      session: {
        sessionId,
        projectId,
        title: this.normalizeSessionTitle(projectId, title),
        goal: '',
        sessionPath: finalPath,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      requestId,
      turnId,
      stagingPath,
      finalPath,
    };
  }

  beginStagedConversationSession(
    projectId: string,
    title: string,
    sourceAttachmentPaths: string[],
    requestId: string,
    turnId: string,
    options?: {
      reserved?: ReservedStagedConversationSession;
      plannedAttachments?: import('@shared/types/session').SessionAttachmentRecord[];
    },
  ): StagedConversationSessionCommit {
    const reserved = options?.reserved ?? this.allocateStagedConversationSession(
      projectId,
      title,
      requestId,
      turnId,
    );
    const { session, stagingPath, finalPath } = reserved;
    if (fs.existsSync(stagingPath)) fs.rmSync(stagingPath, { recursive: true, force: true });
    this.host.io.ensureDir(path.join(stagingPath, 'attachments'));
    this.host.io.ensureDir(path.join(stagingPath, 'timeline'));
    this.host.io.ensureDir(path.join(stagingPath, 'runs'));
    try {
      const attachments = options?.plannedAttachments
        ? this.copyPlannedAttachments(
          sourceAttachmentPaths,
          options.plannedAttachments,
          path.join(stagingPath, 'attachments'),
        )
        : this.host.history.copyAttachmentsForTurn(
          session,
          sourceAttachmentPaths,
          path.join(stagingPath, 'attachments'),
          path.join(finalPath, 'attachments'),
        );
      return { session, requestId, turnId, stagingPath, finalPath, attachments };
    } catch (error) {
      fs.rmSync(stagingPath, { recursive: true, force: true });
      throw error;
    }
  }

  private copyPlannedAttachments(
    sourceAttachmentPaths: string[],
    planned: import('@shared/types/session').SessionAttachmentRecord[],
    physicalAttachmentsDir: string,
  ): import('@shared/types/session').SessionAttachmentRecord[] {
    for (let index = 0; index < planned.length; index += 1) {
      const sourcePath = path.resolve(sourceAttachmentPaths[index]!);
      const targetPath = path.join(physicalAttachmentsDir, planned[index]!.fileName);
      fs.copyFileSync(sourcePath, targetPath);
    }
    return planned;
  }

  commitStagedConversationSession(
    commit: StagedConversationSessionCommit,
    history: ConversationMessage[],
    branchState: ConversationBranchState | null,
  ): SessionRecord {
    if (!fs.existsSync(commit.stagingPath) || fs.existsSync(commit.finalPath)) {
      throw new Error('Staged conversation session is no longer commit-ready.');
    }
    this.host.io.writeJsonAtomic(path.join(commit.stagingPath, 'session.json'), commit.session);
    this.host.io.writeJsonlAtomic(path.join(commit.stagingPath, 'conversation.jsonl'), history);
    this.host.io.writeJsonAtomic(
      path.join(commit.stagingPath, 'attachments.json'),
      toSessionAttachmentManifest(commit.attachments),
    );
    this.host.io.writeUtf8Atomic(path.join(commit.stagingPath, 'action_chain.jsonl'), '');
    if (branchState) {
      this.host.io.writeJsonAtomic(path.join(commit.stagingPath, 'conversation-branches.json'), branchState);
    }
    fs.renameSync(commit.stagingPath, commit.finalPath);
    this.host.projects.touchProject(commit.session.projectId, commit.session.sessionId, commit.session.updatedAt);
    this.host.projects.setCurrentProjectId(commit.session.projectId);
    this.host.projects.setCurrentSessionId(commit.session.sessionId);
    return commit.session;
  }

  rollbackStagedConversationSession(commit: StagedConversationSessionCommit): void {
    if (fs.existsSync(commit.stagingPath)) fs.rmSync(commit.stagingPath, { recursive: true, force: true });
  }

  readSession(sessionId: string): SessionRecord | null {
    const location = this.findSessionLocation(sessionId);
    if (!location) return null;
    const sessions = reconcileProjectSessionTitles(this.host, location.project, (session, sessionPath) => (
      this.normalizeSessionRecord(session, sessionPath)
    ));
    return sessions.find((session) => session.sessionId === sessionId) ?? null;
  }

  updateSession(sessionId: string, patch: Partial<SessionRecord>): SessionRecord | null {
    const location = this.findSessionLocation(sessionId);
    if (!location) return null;

    const existing = this.host.io.readJson(path.join(location.sessionPath, 'session.json'), SessionRecordSchema);
    if (!existing) return null;

    const nextSession: SessionRecord = {
      ...this.normalizeSessionRecord(existing, location.sessionPath),
      ...patch,
      sessionId: existing.sessionId,
      projectId: existing.projectId,
      sessionPath: location.sessionPath,
      updatedAt: nowMs(),
    };

    this.host.io.writeJsonAtomic(path.join(location.sessionPath, 'session.json'), nextSession);
    this.host.projects.touchProject(existing.projectId, nextSession.sessionId, nextSession.updatedAt);
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
      .map((run) => toRunSummary(run));
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
    if (!isSafeRunId(runId)) {
      throw new Error(`Invalid runId: ${runId}`);
    }
    const runsRoot = path.resolve(location.sessionPath, 'runs');
    const runPath = path.resolve(runsRoot, runId);
    const relative = path.relative(runsRoot, runPath);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`runId escaped runs directory: ${runId}`);
    }
    return runPath;
  }

  async createCase(input: {
    caseId?: string;
    projectId?: string;
    userGoal: string;
    symptomSummary: string;
  }): Promise<string> {
    const projectId = input.projectId || this.host.projects.getCurrentProjectId();
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
    profileId: string;
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
    this.host.io.ensureDir(runPath);
    this.host.io.ensureDir(path.join(runPath, 'artifacts'));
    this.host.io.ensureDir(path.join(runPath, 'notes'));
    this.host.io.ensureDir(path.join(runPath, 'reports'));
    this.host.io.ensureDir(path.join(runPath, 'logs'));
    this.host.io.ensureDir(path.join(runPath, 'screenshots'));
    this.host.io.ensureDir(path.join(runPath, 'checkpoints'));

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
    const persistedRun = toPersistedRunV2({
      runId,
      turnId: input.turnId,
      projectId: session.projectId,
      sessionId,
      caseId: sessionId,
      profileId: input.profileId,
      goal: input.goal || session.goal,
      captures: isMissionAgentId(input.profileId) ? captures : [],
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
    });

    persistRunFiles(this.host, runPath, persistedRun);
    if (persistedRun.kind === 'mission') {
      writeYaml(path.join(runPath, 'capture_refs.yaml'), {
        captures: persistedRun.captures.map((capture, index) => ({
          capture_id: capture.id || `cap-${index}`,
          capture_role: capture.role,
          source_path: capture.filePath,
        })),
      });
      writeYaml(path.join(runPath, 'notes', 'hypothesis_board.yaml'), {
        hypothesis_board: {
          session_id: sessionId,
          entry_skill: persistedRun.mission,
          user_goal: persistedRun.goal,
          intake_state: 'handoff_ready',
          current_phase: 'intake',
          current_task: '',
          active_owner: persistedRun.profileId,
          pending_requirements: [],
          blocking_issues: [],
          progress_summary: ['accepted intake complete'],
          next_actions: ['run dispatch_readiness before specialist dispatch'],
          last_updated: nowIso(),
          hypotheses: [],
        },
      });
    }

    this.updateSession(sessionId, {
      goal: persistedRun.goal,
      lastRunId: runId,
    });
    this.host.projects.touchProject(session.projectId, sessionId);
    this.host.projects.setCurrentProjectId(session.projectId);
    this.host.projects.setCurrentSessionId(sessionId);

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

    const allowedTopLevel = new Set([
      'status',
      'stopReason',
      'runtime',
      'endedAt',
      'updatedAt',
      'finishedAt',
      'stoppedAt',
      'lastStage',
      'goal',
      'captures',
      'reportPaths',
      'backend',
      'diagnostics',
      'turnId',
    ]);
    const sanitizedPatch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!allowedTopLevel.has(key)) continue;
      sanitizedPatch[key] = value;
    }

    if (existing.kind === 'conversation' && 'captures' in sanitizedPatch) {
      const nextCaptures = sanitizedPatch.captures;
      if (!Array.isArray(nextCaptures) || nextCaptures.length > 0) {
        throw new Error('CONVERSATION_RUN_CAPTURES_FORBIDDEN: conversation runs cannot persist captures.');
      }
    }

    const merged = this.host.io.deepMerge(
      existing as unknown as Record<string, unknown>,
      sanitizedPatch,
    ) as unknown as PersistedRunRecord;
    const workflowStage = merged.runtime?.workflow_stage || existing.runtime.workflow_stage;
    merged.runtime = {
      ...existing.runtime,
      ...(merged.runtime || {}),
      workflow_stage: workflowStage,
    };
    const identity = existing.kind === 'mission'
      ? { kind: existing.kind, profileId: existing.profileId, mission: existing.mission }
      : { kind: existing.kind, profileId: existing.profileId };
    Object.assign(merged, identity);
    if (existing.kind !== 'mission') {
      delete (merged as { mission?: unknown }).mission;
    }
    merged.lastStage = workflowStage;
    merged.updatedAt = nowMs();

    if (workflowStage === 'finalize' && merged.status === 'running') {
      merged.status = 'completed';
      merged.finishedAt = merged.finishedAt || merged.updatedAt;
    }

    persistRunFiles(this.host, this.getRunPath(merged.sessionId, merged.runId), merged);
    this.updateSession(caseId, {
      lastRunId: runId,
    });
  }

  getActionChainPath(sessionId: string): string {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for action chain: ${sessionId}`);
    }
    return path.join(location.sessionPath, 'action_chain.jsonl');
  }

  getSessionAttachmentsDir(sessionId: string): string {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for attachments: ${sessionId}`);
    }
    const attachmentsDir = path.join(location.sessionPath, 'attachments');
    this.host.io.ensureDir(attachmentsDir);
    return attachmentsDir;
  }

  getSessionAttachmentsManifestPath(sessionId: string): string {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for attachment manifest: ${sessionId}`);
    }
    return path.join(location.sessionPath, 'attachments.json');
  }

  writeSessionPlanArtifact(sessionId: string, content: string): string {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for plan artifact: ${sessionId}`);
    }
    const artifactsDir = path.join(location.sessionPath, 'artifacts');
    this.host.io.ensureDir(artifactsDir);
    const artifactPath = path.join(artifactsDir, 'plan.md');
    fs.writeFileSync(artifactPath, content, 'utf8');
    return artifactPath;
  }

  async appendActionEvent(sessionId: string, event: ActionEvent): Promise<void> {
    appendJsonl(this.getActionChainPath(sessionId), event);
    this.updateSession(sessionId, {});
  }

  async readActionChain(sessionId: string): Promise<ActionEvent[]> {
    const actionChainPath = this.getActionChainPath(sessionId);
    const result = readJsonl<ActionEvent>(actionChainPath);
    assertNoJsonlDiagnostics(actionChainPath, result.diagnostics);
    return result.records;
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

    persistRunFiles(this.host, this.getRunPath(run.sessionId, run.runId), run);

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

  writeRunFiles(run: PersistedRunRecord): void {
    persistRunFiles(this.host, this.getRunPath(run.sessionId, run.runId), run);
  }

  findSessionLocation(sessionId: string): { project: ProjectRecord; sessionPath: string } | null {
    for (const project of this.host.projects.listProjects()) {
      const sessionPath = path.join(this.host.projects.ensureProjectSessionsRoot(project), sessionId);
      if (fs.existsSync(path.join(sessionPath, 'session.json'))) {
        return { project, sessionPath };
      }
    }
    return null;
  }

  normalizeSessionRecord(session: SessionRecord, sessionPath?: string): SessionRecord {
    const resolvedSessionPath = sessionPath || this.findSessionLocation(session.sessionId)?.sessionPath || session.sessionPath;
    return {
      ...session,
      sessionPath: resolvedSessionPath || '',
    };
  }

  readPersistedRun(sessionId: string, runId: string): PersistedRunRecord | null {
    const location = this.findSessionLocation(sessionId);
    if (!location) return null;
    return loadPersistedRun(this.host, this.getRunPath(sessionId, runId), sessionId, runId, location.sessionPath);
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

}
