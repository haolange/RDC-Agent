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
  ReasoningSummary,
  WorkflowStage,
  WorkflowState,
} from '@shared/types/workflow';
import { normalizeWorkflowStage } from '@shared/constants/stages';
import type {
  CaptureDescriptor,
  ExecutableAppMode,
  ProjectRecord,
  RunSummary,
  SessionAttachmentRecord,
  SessionRecord,
} from '@shared/types/session';
import { appPathService } from '../runtime/AppPathService';
import type {
  PersistedRunRecord,
  SessionEvidenceRecord,
} from './storageTypes';
import type { StagedConversationSessionCommit } from './storageCommitTypes';


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
    return this.reconcileProjectSessionTitles(project)
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
    this.host.io.writeJson(path.join(sessionPath, 'session.json'), session);
    if (!fs.existsSync(path.join(sessionPath, 'action_chain.jsonl'))) {
      fs.writeFileSync(path.join(sessionPath, 'action_chain.jsonl'), '', 'utf-8');
    }
    if (!fs.existsSync(path.join(sessionPath, 'conversation.jsonl'))) {
      fs.writeFileSync(path.join(sessionPath, 'conversation.jsonl'), '', 'utf-8');
    }
    if (!fs.existsSync(path.join(sessionPath, 'attachments.json'))) {
      this.host.io.writeJson(path.join(sessionPath, 'attachments.json'), [] satisfies SessionAttachmentRecord[]);
    }
    this.syncSessionEvidence(session.sessionId, session.projectId);

    this.host.projects.touchProject(project.projectId, session.sessionId, timestamp);
    this.host.projects.setCurrentProjectId(projectId);
    this.host.projects.setCurrentSessionId(session.sessionId);

    return session;
  }

  beginStagedConversationSession(
    projectId: string,
    title: string,
    sourceAttachmentPaths: string[],
    requestId: string,
    turnId: string,
  ): StagedConversationSessionCommit {
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
    if (fs.existsSync(stagingPath)) fs.rmSync(stagingPath, { recursive: true, force: true });
    this.host.io.ensureDir(path.join(stagingPath, 'attachments'));
    this.host.io.ensureDir(path.join(stagingPath, 'timeline'));
    this.host.io.ensureDir(path.join(stagingPath, 'runs'));
    const session: SessionRecord = {
      sessionId,
      projectId,
      title: this.normalizeSessionTitle(projectId, title),
      goal: '',
      sessionPath: finalPath,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    try {
      const attachments = this.host.history.copyAttachmentsForTurn(
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
    this.host.io.writeJsonAtomic(path.join(commit.stagingPath, 'attachments.json'), commit.attachments);
    this.host.io.writeUtf8Atomic(path.join(commit.stagingPath, 'action_chain.jsonl'), '');
    if (branchState) {
      this.host.io.writeJsonAtomic(path.join(commit.stagingPath, 'conversation-branches.json'), branchState);
    }
    fs.renameSync(commit.stagingPath, commit.finalPath);
    this.syncSessionEvidence(commit.session.sessionId, commit.session.projectId);
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
    const sessions = this.reconcileProjectSessionTitles(location.project);
    return sessions.find((session) => session.sessionId === sessionId) ?? null;
  }

  updateSession(sessionId: string, patch: Partial<SessionRecord>): SessionRecord | null {
    const location = this.findSessionLocation(sessionId);
    if (!location) return null;

    const existing = this.host.io.readJson<SessionRecord>(path.join(location.sessionPath, 'session.json'));
    if (!existing) return null;

    const nextSession: SessionRecord = {
      ...this.normalizeSessionRecord(existing, location.sessionPath),
      ...patch,
      sessionId: existing.sessionId,
      projectId: existing.projectId,
      sessionPath: location.sessionPath,
      updatedAt: nowMs(),
    };

    this.host.io.writeJson(path.join(location.sessionPath, 'session.json'), nextSession);
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

    const merged = this.host.io.deepMerge(
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
    this.host.io.ensureDir(artifactsDir);
    const artifactPath = path.join(artifactsDir, 'plan.md');
    fs.writeFileSync(artifactPath, content, 'utf8');
    return artifactPath;
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

  syncSessionEvidence(sessionId: string, projectId: string): void {
    const latestRun = this.getLatestRun(sessionId);
    const actionChainPath = this.getActionChainPath(sessionId);
    const actionEvents = fs.existsSync(actionChainPath)
      ? (() => {
        const result = readJsonl<ActionEvent>(actionChainPath);
        assertNoJsonlDiagnostics(actionChainPath, result.diagnostics);
        return result.records;
      })()
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

  writeRunFiles(run: PersistedRunRecord): void {
    const runPath = this.getRunPath(run.sessionId, run.runId);
    this.host.io.ensureDir(runPath);
    this.host.io.writeJson(path.join(runPath, 'run.json'), run);
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
    const runJsonPath = path.join(this.getRunPath(sessionId, runId), 'run.json');
    const runJson = this.host.io.readJson<PersistedRunRecord>(runJsonPath);
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
        this.host.io.writeJson(path.join(sessionPath, 'session.json'), rewrittenSession);
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
    const sessionsRoot = this.host.projects.ensureProjectSessionsRoot(project);
    if (!fs.existsSync(sessionsRoot)) {
      return [];
    }

    return fs.readdirSync(sessionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const sessionPath = path.join(sessionsRoot, entry.name);
        const session = this.host.io.readJson<SessionRecord>(path.join(sessionPath, 'session.json'));
        return session ? { session, sessionPath } : null;
      })
      .filter((entry): entry is { session: SessionRecord; sessionPath: string } => entry !== null);
  }
}
