import path from 'path';
import type { AgentRole } from '@shared/types/agent';
import type { ActionEvent } from '@shared/types/evidence';
import type { ConversationMessage, ConversationStreamEvent } from '@shared/types/conversation';
import type {
  AgentResultCard,
  ArtifactRecord,
  EvidenceRecord,
  HarnessTask,
  PlanContract,
  VerificationResult,
} from '@shared/types/harness';
import type { DebugSessionStartRequest, RunSummary, SessionRecord } from '@shared/types/session';
import type {
  AskUserAnswer,
  AskUserPrompt,
  Blocker,
  DebugPlan,
  PlanApprovalState,
  PlanReadiness,
  ReasoningSummary,
  WorkflowState,
} from '@shared/types/workflow';
import { normalizeWorkflowStage } from '@shared/constants/stages';
import { BLOCKER_CODES } from '@shared/constants/blockers';
import { generateEventId, nowIso, nowMs } from '@shared/utils/id';
import { storageAdapter, type PersistedPlanSnapshot } from './StorageAdapter';
import { intakeContextResolver } from './IntakeContextResolver';
import { planBuilder } from './PlanBuilder';
import { runExecutionService } from './RunExecutionService';
import { rdxSessionService } from '../index';
import { specialistRecipeRunner, type SpecialistRecipeResult } from './SpecialistRecipeRunner';
import { toolBridge } from './ToolBridge';
import { harnessController } from './HarnessController';
import { reportBundleService } from './ReportBundleService';
import { debuggerLlmService } from './DebuggerLlmService';
import { artifactStore } from './ArtifactStore';
import { contextService } from './ContextService';
import { evidenceLedger } from './EvidenceLedger';
import { taskBoard } from './TaskBoard';
import { workflowProjectionPublisher } from '../workflow/debugger/WorkflowProjectionPublisher';

export interface StartWorkflowResult {
  success: boolean;
  runId?: string;
  sessionId?: string;
  caseId?: string;
  currentStage?: WorkflowState['currentStage'];
  status?: RunSummary['status'];
  planStatus?: PlanReadiness;
  pendingQuestions?: AskUserPrompt | null;
  debugPlanSummary?: DebugPlan | null;
  error?: string;
}

export interface PlanResult {
  success: boolean;
  runId?: string;
  sessionId?: string;
  debugPlan?: DebugPlan | null;
  pendingQuestions?: AskUserPrompt | null;
  approvalState?: PlanApprovalState;
  error?: string;
}

interface RunLocation {
  session: SessionRecord;
  run: RunSummary;
}

interface PlanLlmPayload {
  scope: string;
  notes: string[];
  recommended_specialists: AgentRole[];
  verification_focus: string[];
}

interface InvestigationLlmPayload {
  summary: string;
  evidence: string[];
  next_step: string;
  confidence: number;
  root_cause: string;
  recommendations: string[];
}

interface SkepticReviewPayload {
  verdict: 'approved' | 'approved_with_warning' | 'rejected';
  summary: string;
}

interface CuratedReportPayload {
  title: string;
  summary: string;
  root_cause: string;
  fix_description: string;
  evidence_summary: string[];
  recommendations: string[];
  confidence: number;
}

function latestStageHistory(events: ActionEvent[]): WorkflowState['previousStages'] {
  return events
    .filter((event) => event.event_type === 'workflow_stage_transition')
    .map((event) => normalizeWorkflowStage(String(event.payload.toStage || 'preflight')));
}

function dedupeBlockers(blockers: Blocker[]): Blocker[] {
  const seen = new Set<string>();
  const result: Blocker[] = [];
  for (const blocker of blockers) {
    const key = `${blocker.code}:${blocker.reason}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(blocker);
  }
  return result;
}

const KNOWN_AGENT_ROLES = new Set<AgentRole>([
  'rdc-debugger',
  'triage_agent',
  'capture_repro_agent',
  'pass_graph_pipeline_agent',
  'pixel_forensics_agent',
  'shader_ir_agent',
  'driver_device_agent',
  'skeptic_agent',
  'curator_agent',
]);

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? '').trim())
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function toConfidence(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function toRecommendedSpecialists(value: unknown, fallback: AgentRole[]): AgentRole[] {
  const parsed = toStringArray(value).filter((entry): entry is AgentRole => KNOWN_AGENT_ROLES.has(entry as AgentRole));
  return parsed.length > 0 ? Array.from(new Set(parsed)) : fallback;
}

export class DebugWorkflowService {
  async startPlan(request: DebugSessionStartRequest): Promise<StartWorkflowResult> {
    try {
      const resolved = intakeContextResolver.resolve(request);
      const caseId = request.sessionId || await storageAdapter.createCase({
        caseId: request.sessionId,
        projectId: request.projectId,
        userGoal: resolved.goalText,
        symptomSummary: resolved.goalText,
      });
      const { runId, sessionId } = await storageAdapter.createRun({
        caseId,
        turnId: request.turnId,
        capturePaths: resolved.captures.map((capture) => capture.filePath),
        mode: request.mode,
        goal: resolved.goalText,
        captures: resolved.captures,
        backend: resolved.backend,
        status: 'planning',
      });

      debuggerLlmService.resetRunSummary(runId);

      const basePlan = planBuilder.build(resolved);
      let debugPlan = basePlan.debugPlan;
      let pendingQuestions = basePlan.pendingQuestions;
      const blockers = [...basePlan.blockers];

      if (blockers.length === 0) {
        blockers.push(...debuggerLlmService.getRouteBlockers(
          this.getRequiredRouteAgents(debugPlan, resolved.backend),
          'plan',
        ));
      }

      if (blockers.length === 0) {
        try {
          debugPlan = await this.generatePlanWithLlm({
            sessionId,
            runId,
            resolvedGoal: resolved.goalText,
            basePlan: debugPlan,
          });
          blockers.push(...debuggerLlmService.getRouteBlockers(
            this.getRequiredRouteAgents(debugPlan, resolved.backend),
            'plan',
          ));
        } catch (error) {
          blockers.push(this.normalizeLlmBlocker(error, BLOCKER_CODES.BLOCKED_LLM_REQUEST_FAILED.code));
        }
      }

      debugPlan = {
        ...debugPlan,
        blockers: dedupeBlockers([...debugPlan.blockers, ...blockers]),
        strictReady: Boolean(debugPlan.targetCapture) && dedupeBlockers([...debugPlan.blockers, ...blockers]).length === 0 && !pendingQuestions,
        planReadiness: blockers.length > 0
          ? 'blocked'
          : pendingQuestions
            ? 'needs_user_input'
            : 'strict_ready',
        updatedAt: nowIso(),
      };
      const approvalState: PlanApprovalState = debugPlan.strictReady ? 'pending_user' : 'not_requested';

      storageAdapter.writePlanSnapshot(sessionId, runId, {
        debug_plan: debugPlan,
        pending_questions: pendingQuestions,
        approval_state: approvalState,
        intake_context: resolved.intakeContext,
      } satisfies PersistedPlanSnapshot);
      this.seedHarnessPlan({
        sessionId,
        runId,
        mode: request.mode,
        captures: resolved.captures,
        debugPlan,
        pendingQuestions,
      });

      await storageAdapter.updateRun(sessionId, runId, {
        status: blockers.length > 0
          ? 'failed'
          : pendingQuestions
            ? 'awaiting_input'
            : 'awaiting_approval',
        lastStage: blockers.length > 0 ? 'plan' : pendingQuestions ? 'awaiting_user_input' : 'plan',
        runtime: {
          workflow_stage: blockers.length > 0 ? 'plan' : pendingQuestions ? 'awaiting_user_input' : 'plan',
        },
      });

      await this.appendActionEvent(sessionId, storageAdapter.createActionEvent({
        runId,
        sessionId,
        agentId: 'rdc-debugger',
        eventType: 'user_message',
        status: 'ok',
        payload: {
          role: 'user',
          content: resolved.goalText,
          source: resolved.taskFilePath ? 'task_file' : 'prompt',
        },
      }));

      for (const [fromStage, toStage] of [
        ['preflight', 'entry_gate'],
        ['entry_gate', 'intake_gate'],
        ['intake_gate', 'plan'],
      ] as const) {
        await this.appendActionEvent(sessionId, storageAdapter.createActionEvent({
          runId,
          sessionId,
          agentId: 'rdc-debugger',
          eventType: 'workflow_stage_transition',
          status: 'ok',
          payload: {
            fromStage,
            toStage,
          },
        }));
      }

      if (pendingQuestions) {
        await this.appendActionEvent(sessionId, storageAdapter.createActionEvent({
          runId,
          sessionId,
          agentId: 'rdc-debugger',
          eventType: 'blocker',
          status: 'blocked',
          payload: {
            code: 'ASK_USER_REQUIRED',
            reason: 'Plan requires structured user answers before execution can start.',
            prompt_id: pendingQuestions.promptId,
          },
        }));
      }

      for (const blocker of blockers) {
        await this.appendActionEvent(sessionId, storageAdapter.createActionEvent({
          runId,
          sessionId,
          agentId: 'rdc-debugger',
          eventType: 'blocker',
          status: 'blocked',
          payload: {
            code: blocker.code,
            reason: blocker.reason,
            refs: blocker.refs,
          },
        }));
      }

      this.emitWorkflowState(await this.getWorkflowState(sessionId, runId));

      return {
        success: true,
        runId,
        sessionId,
        caseId,
        currentStage: blockers.length > 0 ? 'plan' : pendingQuestions ? 'awaiting_user_input' : 'plan',
        status: blockers.length > 0
          ? 'failed'
          : pendingQuestions
            ? 'awaiting_input'
            : 'awaiting_approval',
        planStatus: debugPlan.planReadiness,
        pendingQuestions,
        debugPlanSummary: debugPlan,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getPlan(runId: string): Promise<PlanResult> {
    const location = this.findRun(runId);
    if (!location) {
      return { success: false, error: `Run not found: ${runId}` };
    }
    const snapshot = storageAdapter.readPlanSnapshot(location.session.sessionId, runId);
    return {
      success: true,
      runId,
      sessionId: location.session.sessionId,
      debugPlan: snapshot?.debug_plan ?? null,
      pendingQuestions: snapshot?.pending_questions ?? null,
      approvalState: snapshot?.approval_state ?? 'not_requested',
    };
  }

  async submitQuestions(runId: string, answers: AskUserAnswer[]): Promise<PlanResult> {
    const location = this.findRun(runId);
    if (!location) {
      return { success: false, error: `Run not found: ${runId}` };
    }

    const snapshot = storageAdapter.readPlanSnapshot(location.session.sessionId, runId);
    if (!snapshot?.debug_plan) {
      return { success: false, error: 'No plan snapshot available.' };
    }

    const nextPlan: DebugPlan = {
      ...snapshot.debug_plan,
      updatedAt: nowIso(),
      blockers: snapshot.debug_plan.blockers.filter((blocker) => blocker.code !== 'ASK_USER_REQUIRED'),
    };

    for (const answer of answers) {
      if (answer.questionId !== 'target_capture') {
        continue;
      }
      const projectInputs = storageAdapter.listProjectInputs(location.session.projectId);
      const matchedInput = projectInputs.find((input) => (
        input.inputId === answer.selectedOptionId
        || input.fileName === answer.freeformText?.trim()
      ));
      if (matchedInput) {
        nextPlan.targetCapture = {
          captureId: matchedInput.inputId,
          fileName: matchedInput.fileName,
          filePath: matchedInput.filePath,
        };
        nextPlan.missingInfo = nextPlan.missingInfo.filter((item) => item !== 'target_capture');
      }
    }

    nextPlan.blockers = dedupeBlockers([
      ...nextPlan.blockers,
      ...debuggerLlmService.getRouteBlockers(
        this.getRequiredRouteAgents(nextPlan, location.run.backend),
        'plan',
      ),
    ]);
    nextPlan.strictReady = Boolean(nextPlan.targetCapture) && nextPlan.blockers.length === 0;
    nextPlan.planReadiness = nextPlan.blockers.length > 0
      ? 'blocked'
      : nextPlan.strictReady
        ? 'strict_ready'
        : 'needs_user_input';

    const previousBlockerKeys = new Set(snapshot.debug_plan.blockers.map((blocker) => `${blocker.code}:${blocker.reason}`));
    const newBlockers = nextPlan.blockers.filter((blocker) => !previousBlockerKeys.has(`${blocker.code}:${blocker.reason}`));
    const nextStatus = nextPlan.blockers.length > 0 ? 'failed' : nextPlan.strictReady ? 'awaiting_approval' : 'awaiting_input';
    const nextStage = nextPlan.blockers.length > 0 || nextPlan.strictReady ? 'plan' : 'awaiting_user_input';

    storageAdapter.writePlanSnapshot(location.session.sessionId, runId, {
      ...snapshot,
      debug_plan: nextPlan,
      pending_questions: nextPlan.strictReady || nextPlan.blockers.length > 0 ? null : snapshot.pending_questions,
      approval_state: nextPlan.blockers.length > 0 ? 'not_requested' : nextPlan.strictReady ? 'pending_user' : snapshot.approval_state,
    });

    await storageAdapter.updateRun(location.session.sessionId, runId, {
      status: nextStatus,
      lastStage: nextStage,
      runtime: {
        workflow_stage: nextStage,
      },
    });

    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId,
      sessionId: location.session.sessionId,
      agentId: 'rdc-debugger',
      eventType: 'user_message',
      status: 'ok',
      payload: {
        role: 'user',
        content: JSON.stringify(answers),
        source: 'ask_user_answers',
      },
    }));

    for (const blocker of newBlockers) {
      await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
        runId,
        sessionId: location.session.sessionId,
        agentId: 'rdc-debugger',
        eventType: 'blocker',
        status: 'blocked',
        payload: {
          code: blocker.code,
          reason: blocker.reason,
          refs: blocker.refs,
        },
      }));
    }

    this.emitRunStatus(location.session.sessionId, runId, nextStatus, nextStage);
    this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, runId));
    await this.appendAssistantConversationMessage(
      location.session.sessionId,
      runId,
      nextPlan.strictReady
        ? '收到，执行前置条件已经补齐。你现在可以批准这份计划，我再进入正式调试。'
        : nextPlan.blockers.length > 0
          ? nextPlan.blockers[0]?.reason || '当前还不能进入正式调试。'
          : '收到，我已经更新了计划输入，不过还需要你继续补全剩余信息。',
    );

    return {
      success: true,
      runId,
      sessionId: location.session.sessionId,
      debugPlan: nextPlan,
      pendingQuestions: nextPlan.strictReady || nextPlan.blockers.length > 0 ? null : snapshot.pending_questions,
      approvalState: nextPlan.blockers.length > 0 ? 'not_requested' : nextPlan.strictReady ? 'pending_user' : snapshot.approval_state,
    };
  }

  async approvePlan(runId: string): Promise<PlanResult> {
    const location = this.findRun(runId);
    if (!location) {
      return { success: false, error: `Run not found: ${runId}` };
    }

    const snapshot = storageAdapter.readPlanSnapshot(location.session.sessionId, runId);
    if (!snapshot?.debug_plan) {
      return { success: false, error: 'No plan snapshot available.' };
    }
    if (!snapshot.debug_plan.strictReady) {
      return { success: false, error: 'Plan is not strict ready.' };
    }

    const routeBlockers = debuggerLlmService.getRouteBlockers(
      this.getRequiredRouteAgents(snapshot.debug_plan, location.run.backend),
      'dispatch',
    );
    if (routeBlockers.length > 0) {
      const blockedPlan: DebugPlan = {
        ...snapshot.debug_plan,
        blockers: dedupeBlockers([...snapshot.debug_plan.blockers, ...routeBlockers]),
        strictReady: false,
        planReadiness: 'blocked',
        updatedAt: nowIso(),
      };
      storageAdapter.writePlanSnapshot(location.session.sessionId, runId, {
        ...snapshot,
        debug_plan: blockedPlan,
        approval_state: 'not_requested',
      });
      for (const blocker of routeBlockers) {
        await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
          runId,
          sessionId: location.session.sessionId,
          agentId: 'rdc-debugger',
          eventType: 'blocker',
          status: 'blocked',
          payload: {
            code: blocker.code,
            reason: blocker.reason,
            refs: blocker.refs,
          },
        }));
      }
      await storageAdapter.updateRun(location.session.sessionId, runId, {
        status: 'failed',
        lastStage: 'plan',
        runtime: {
          workflow_stage: 'plan',
        },
      });
      this.emitRunStatus(location.session.sessionId, runId, 'failed', 'plan');
      this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, runId));
      return {
        success: false,
        error: routeBlockers.map((blocker) => blocker.reason).join(' | '),
        debugPlan: blockedPlan,
        approvalState: 'not_requested',
      };
    }

    storageAdapter.writePlanSnapshot(location.session.sessionId, runId, {
      ...snapshot,
      approval_state: 'approved',
      pending_questions: null,
    });
    this.applyTaskMutation(location.session.sessionId, runId, 'plan', 'completed', 'User approved the Debugger plan.');
    this.applyTaskMutation(location.session.sessionId, runId, 'speclist', 'in_progress', 'Task breakdown started after plan approval.');
    contextService.writeRunCapsule(location.session.sessionId, runId);

    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId,
      sessionId: location.session.sessionId,
      agentId: 'rdc-debugger',
      eventType: 'workflow_stage_transition',
      status: 'ok',
      payload: {
        fromStage: 'plan',
        toStage: 'dispatch',
      },
    }));

    await storageAdapter.updateRun(location.session.sessionId, runId, {
      status: 'running',
      lastStage: 'dispatch',
      runtime: {
        workflow_stage: 'dispatch',
      },
    });
    this.emitRunStatus(location.session.sessionId, runId, 'running', 'dispatch');
    this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, runId));
    await this.appendAssistantConversationMessage(
      location.session.sessionId,
      runId,
      '计划已批准，我现在开始正式调试，并按证据链推进后续分析。',
    );

    runExecutionService.startRun({
      runId,
      sessionId: location.session.sessionId,
      projectId: location.run.projectId,
    }, (signal) => this.executeApprovedRun(location, snapshot.debug_plan!, signal));

    return {
      success: true,
      runId,
      sessionId: location.session.sessionId,
      debugPlan: snapshot.debug_plan,
      pendingQuestions: null,
      approvalState: 'approved',
    };
  }

  async restartRun(runId: string): Promise<PlanResult> {
    const location = this.findRun(runId);
    if (!location) {
      return { success: false, error: `Run not found: ${runId}` };
    }
    const snapshot = storageAdapter.readPlanSnapshot(location.session.sessionId, runId);
    if (!snapshot?.debug_plan?.strictReady) {
      return { success: false, error: 'Cannot restart without a strict-ready plan.' };
    }

    const { runId: nextRunId, sessionId } = await storageAdapter.createRun({
      caseId: location.session.sessionId,
      capturePaths: location.run.captures.map((capture) => capture.filePath),
      mode: location.run.mode,
      goal: location.run.goal,
      captures: location.run.captures,
      backend: location.run.backend,
      status: 'awaiting_approval',
    });
    storageAdapter.writePlanSnapshot(sessionId, nextRunId, {
      ...snapshot,
      approval_state: 'pending_user',
      pending_questions: null,
      debug_plan: {
        ...snapshot.debug_plan,
        updatedAt: nowIso(),
      },
    });
    await storageAdapter.updateRun(location.session.sessionId, runId, {
      status: 'interrupted',
      stopReason: 'Restarted from stale run',
      stoppedAt: Date.now(),
      finishedAt: Date.now(),
    });

    this.emitWorkflowState(await this.getWorkflowState(sessionId, nextRunId));
    await this.appendAssistantConversationMessage(
      sessionId,
      nextRunId,
      '我已经为你重建了一次可继续的调试运行。确认计划后，我会从新的 run 继续推进。',
    );

    return {
      success: true,
      runId: nextRunId,
      sessionId,
      debugPlan: snapshot.debug_plan,
      pendingQuestions: null,
      approvalState: 'pending_user',
    };
  }

  async stopRun(runId: string): Promise<{ success: boolean; error?: string }> {
    const location = this.findRun(runId);
    if (!location) {
      return { success: false, error: `Run not found: ${runId}` };
    }

    const active = runExecutionService.stopRun(runId);
    toolBridge.abortRun(runId);
    await rdxSessionService.closeOrReplaceOpenedCapture();

    await storageAdapter.updateRun(location.session.sessionId, runId, {
      status: active && process.env.RDC_AGENT_TEST_MODE !== '1' ? 'stopping' : 'cancelled',
      stopReason: 'Stopped by user',
      stoppedAt: Date.now(),
      finishedAt: active && process.env.RDC_AGENT_TEST_MODE !== '1' ? undefined : Date.now(),
    });

    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId,
      sessionId: location.session.sessionId,
      agentId: 'rdc-debugger',
      eventType: 'blocker',
      status: 'warning',
      payload: {
        code: 'RUN_STOPPED',
        reason: 'Run stopped by user request.',
      },
    }));
    this.emitRunStatus(
      location.session.sessionId,
      runId,
      active && process.env.RDC_AGENT_TEST_MODE !== '1' ? 'stopping' : 'cancelled',
      location.run.lastStage,
      'Stopped by user',
    );
    this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, runId));

    return { success: true };
  }

  async getWorkflowState(sessionId: string, runId?: string): Promise<WorkflowState> {
    const run = runId
      ? storageAdapter.listRuns(sessionId).find((entry) => entry.runId === runId) || null
      : storageAdapter.getLatestRun(sessionId);
    if (!run) {
      return {
        caseId: sessionId,
        runId: '',
        sessionId,
        currentStage: 'preflight',
        previousStages: [],
        entryMode: 'cli',
        backend: 'local',
        orchestrationMode: 'multi_agent',
        coordinationMode: 'staged_handoff',
        blockers: [],
        lastUpdated: nowIso(),
      };
    }

    const events = await storageAdapter.readActionChain(sessionId);
    const runEvents = events.filter((event) => event.run_id === run.runId);
    const snapshot = storageAdapter.readPlanSnapshot(sessionId, run.runId);
    const blockers = runEvents
      .filter((event) => event.event_type === 'blocker')
      .map((event) => ({
        code: String(event.payload.code || 'BLOCKER'),
        reason: String(event.payload.reason || event.payload.message || 'Blocker'),
        refs: Array.isArray(event.payload.refs) ? event.payload.refs.map(String) : [],
        detectedAt: new Date(event.ts_ms).toISOString(),
      }));
    const reasoningSummaries: ReasoningSummary[] = runEvents
      .filter((event) => event.event_type === 'agent_summary')
      .map((event) => ({
        summaryId: event.event_id,
        stage: normalizeWorkflowStage(String(event.payload.stage || run.lastStage)),
        agentId: String(event.agent_id) as AgentRole,
        summary: String(event.payload.summary || event.payload.content || ''),
        evidence: Array.isArray(event.payload.evidence) ? event.payload.evidence.map(String) : [],
        nextStep: String(event.payload.next_step || event.payload.nextStep || ''),
        confidence: typeof event.payload.confidence === 'number' ? event.payload.confidence : 0.5,
        createdAt: new Date(event.ts_ms).toISOString(),
      }));

    return {
      caseId: run.caseId,
      runId: run.runId,
      sessionId,
      currentStage: normalizeWorkflowStage(run.lastStage),
      previousStages: latestStageHistory(runEvents),
      entryMode: 'cli',
      backend: run.backend,
      orchestrationMode: 'multi_agent',
      coordinationMode: 'staged_handoff',
      blockers,
      planReadiness: snapshot?.debug_plan?.strictReady
        ? 'ready_for_approval'
        : snapshot?.debug_plan?.planReadiness,
      approvalState: snapshot?.approval_state,
      debugPlan: snapshot?.debug_plan ?? null,
      harnessTasks: taskBoard.listTasks(sessionId, run.runId),
      pendingQuestions: snapshot?.pending_questions ?? null,
      reasoningSummaries,
      recoveryState: run.status === 'interrupted'
        ? {
            recoveredAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : undefined,
            recoveryReason: run.stopReason,
          }
        : null,
      lastUpdated: nowIso(),
    };
  }

  async recoverInterruptedRuns(): Promise<void> {
    const projects = storageAdapter.listProjects();
    for (const project of projects) {
      const sessions = storageAdapter.listSessions(project.projectId);
      for (const session of sessions) {
        const runs = storageAdapter.listRuns(session.sessionId);
        for (const run of runs) {
          if (!['running', 'queued', 'planning', 'stopping'].includes(run.status)) {
            continue;
          }
          if (runExecutionService.listActiveRuns().some((active) => active.runId === run.runId)) {
            continue;
          }
          await storageAdapter.updateRun(session.sessionId, run.runId, {
            status: 'interrupted',
            stopReason: 'Recovered after app restart',
            stoppedAt: Date.now(),
            finishedAt: Date.now(),
          });
          await this.appendActionEvent(session.sessionId, storageAdapter.createActionEvent({
            runId: run.runId,
            sessionId: session.sessionId,
            agentId: 'rdc-debugger',
            eventType: 'blocker',
            status: 'warning',
            payload: {
              code: 'STALE_RUN_RECOVERED',
              reason: 'Run was marked interrupted during app startup recovery.',
            },
          }));
        }
      }
    }
  }

  private seedHarnessPlan(input: {
    sessionId: string;
    runId: string;
    mode: DebugSessionStartRequest['mode'];
    captures: DebugSessionStartRequest['captures'];
    debugPlan: DebugPlan;
    pendingQuestions: AskUserPrompt | null;
  }): PlanContract {
    const now = nowIso();
    const tasks = this.createHarnessTasks(input.sessionId, input.runId, input.debugPlan, now);
    for (const task of tasks) {
      taskBoard.upsertTask(input.sessionId, input.runId, task);
    }

    const planContract: PlanContract = {
      schemaVersion: '1',
      planId: input.debugPlan.planId,
      runId: input.runId,
      sessionId: input.sessionId,
      mode: input.mode,
      goal: input.debugPlan.userGoal,
      status: input.pendingQuestions
        ? 'blocked'
        : input.debugPlan.strictReady
          ? 'ready'
          : input.debugPlan.blockers.length > 0
            ? 'blocked'
            : 'pending',
      captures: input.captures ?? [],
      tasks,
      verificationContract: {
        contractId: `${input.debugPlan.planId}-verification`,
        runId: input.runId,
        sessionId: input.sessionId,
        requiredMethods: this.getRequiredVerificationMethods(input.debugPlan),
        targetRefs: [
          input.debugPlan.targetCapture?.captureId,
          input.debugPlan.targetCapture?.filePath,
          input.debugPlan.targetFrameOrEvent?.eventLabel,
        ].filter((entry): entry is string => Boolean(entry)),
        successCriteria: input.debugPlan.verificationContract.successCriteria,
        evidenceRequirements: [
          input.debugPlan.verificationContract.requiresScreenshotEvidence ? 'screenshot' : '',
          input.debugPlan.verificationContract.requiresShaderInspection ? 'shader' : '',
          input.debugPlan.verificationContract.requiresPixelEvidence ? 'pixel' : '',
          input.debugPlan.verificationContract.requiresBaselineComparison ? 'baseline' : '',
        ].filter(Boolean),
        blockerCodes: input.debugPlan.blockers.map((blocker) => blocker.code),
        createdAt: now,
        updatedAt: now,
      },
      questionRequests: input.pendingQuestions
        ? input.pendingQuestions.questions.map((question) => ({
            questionId: question.id,
            runId: input.runId,
            sessionId: input.sessionId,
            prompt: question.prompt,
            reason: input.pendingQuestions!.summary,
            options: question.options.map((option) => ({
              optionId: option.id,
              label: option.label,
              description: option.description,
            })),
            allowFreeform: Boolean(question.freeformPlaceholder),
            requestedBy: 'harness',
            createdAt: input.pendingQuestions!.createdAt,
          }))
        : [],
      questionAnswers: [],
      revisions: [],
      capabilityProfiles: [],
      createdAt: now,
      updatedAt: now,
    };

    contextService.writePlanContract(input.sessionId, input.runId, planContract);
    contextService.appendContextPacket(input.sessionId, input.runId, {
      packetId: generateEventId('context-packet'),
      runId: input.runId,
      sessionId: input.sessionId,
      kind: 'plan',
      source: 'harness',
      title: 'Debugger plan contract',
      summary: input.debugPlan.scope,
      content: JSON.stringify({
        goal: input.debugPlan.userGoal,
        targetCapture: input.debugPlan.targetCapture,
        targetFrameOrEvent: input.debugPlan.targetFrameOrEvent,
        deliverables: input.debugPlan.expectedDeliverables,
      }),
      refs: planContract.verificationContract.targetRefs,
      taskIds: tasks.map((task) => task.taskId),
      evidenceIds: [],
      artifactIds: [],
      createdAt: now,
    });
    contextService.writeRunCapsule(input.sessionId, input.runId);
    return planContract;
  }

  private createHarnessTasks(
    sessionId: string,
    runId: string,
    debugPlan: DebugPlan,
    createdAt: string,
  ): HarnessTask[] {
    const base = {
      runId,
      sessionId,
      priority: 'normal' as const,
      dependsOn: [] as string[],
      evidenceRefs: [] as string[],
      artifactRefs: [] as string[],
      blockerRefs: [] as string[],
      source: 'plan' as const,
      userApproval: 'not_required' as const,
      createdAt,
      updatedAt: createdAt,
    };

    return [
      {
        ...base,
        taskId: 'plan',
        title: 'Plan',
        intent: 'context',
        objective: debugPlan.scope,
        status: debugPlan.blockers.length > 0 ? 'blocked' : 'pending',
        owner: 'rdc-debugger',
        stage: 'plan',
        acceptanceCriteria: ['Target capture, scope, specialists, deliverables, and verification criteria are explicit.'],
      },
      {
        ...base,
        taskId: 'speclist',
        title: 'Task breakdown',
        intent: 'hypothesis',
        objective: 'Seed the Debugger task board from the approved plan.',
        status: 'pending',
        owner: 'rdc-debugger',
        stage: 'speclist',
        dependsOn: ['plan'],
        acceptanceCriteria: debugPlan.expectedDeliverables,
      },
      {
        ...base,
        taskId: 'dispatch',
        title: 'Specialist dispatch',
        intent: 'investigation',
        objective: `Dispatch ${debugPlan.recommendedSpecialists.length || 1} Debugger investigation lane(s).`,
        status: 'pending',
        owner: 'rdc-debugger',
        stage: 'dispatch',
        dependsOn: ['speclist'],
        acceptanceCriteria: ['Every selected specialist returns an AgentResultCard with evidence references.'],
      },
      {
        ...base,
        taskId: 'investigate',
        title: 'Evidence investigation',
        intent: 'investigation',
        objective: debugPlan.targetFrameOrEvent?.eventLabel ?? debugPlan.scope,
        status: 'pending',
        owner: 'rdc-debugger',
        stage: 'investigate',
        dependsOn: ['dispatch'],
        acceptanceCriteria: ['Investigation summary is grounded in EvidenceLedger records.'],
      },
      {
        ...base,
        taskId: 'fix_verify',
        title: 'Verification',
        intent: 'verification',
        objective: 'Validate the leading finding against the verification contract.',
        status: 'pending',
        owner: 'skeptic_agent',
        stage: 'fix_verify',
        dependsOn: ['investigate'],
        acceptanceCriteria: debugPlan.verificationContract.successCriteria,
      },
      {
        ...base,
        taskId: 'curate',
        title: 'Curation',
        intent: 'report',
        objective: 'Publish a report bundle grounded in accepted evidence.',
        status: 'pending',
        owner: 'curator_agent',
        stage: 'curate',
        dependsOn: ['fix_verify'],
        acceptanceCriteria: debugPlan.expectedDeliverables,
      },
    ];
  }

  private getRequiredVerificationMethods(debugPlan: DebugPlan): Array<'tool' | 'screenshot' | 'pixel' | 'shader' | 'baseline' | 'manual' | 'llm_review'> {
    const methods = new Set<Array<'tool' | 'screenshot' | 'pixel' | 'shader' | 'baseline' | 'manual' | 'llm_review'>[number]>(['tool', 'llm_review']);
    if (debugPlan.verificationContract.requiresScreenshotEvidence) methods.add('screenshot');
    if (debugPlan.verificationContract.requiresPixelEvidence) methods.add('pixel');
    if (debugPlan.verificationContract.requiresShaderInspection) methods.add('shader');
    if (debugPlan.verificationContract.requiresBaselineComparison) methods.add('baseline');
    return Array.from(methods);
  }

  private applyTaskMutation(
    sessionId: string,
    runId: string,
    taskId: string,
    status: HarnessTask['status'],
    reason: string,
    refs: { evidenceRefs?: string[]; artifactRefs?: string[]; blockerRefs?: string[] } = {},
  ): void {
    const existing = taskBoard.getTask(sessionId, runId, taskId);
    if (!existing) {
      return;
    }

    taskBoard.mutateTask(sessionId, runId, {
      mutationId: generateEventId('task-mutation'),
      taskId,
      runId,
      sessionId,
      type: status === 'completed' ? 'update_status' : 'update_status',
      actor: 'harness',
      patch: {
        status,
        evidenceRefs: refs.evidenceRefs ?? existing.evidenceRefs,
        artifactRefs: refs.artifactRefs ?? existing.artifactRefs,
        blockerRefs: refs.blockerRefs ?? existing.blockerRefs,
        completedAt: status === 'completed' ? nowIso() : existing.completedAt,
      },
      reason,
      requiresUserApproval: false,
      createdAt: nowIso(),
    });
  }

  private persistAgentResult(sessionId: string, runId: string, result: SpecialistRecipeResult): AgentResultCard {
    const artifactIds = result.artifacts.map((artifactPath) => {
      const artifactId = generateEventId('artifact');
      const record: ArtifactRecord = {
        artifactId,
        runId,
        sessionId,
        kind: artifactPath.toLowerCase().endsWith('.png') ? 'screenshot' : 'data',
        title: `${result.agentId} artifact`,
        filePath: artifactPath,
        mimeType: artifactPath.toLowerCase().endsWith('.png') ? 'image/png' : 'application/json',
        sizeBytes: 0,
        taskId: 'dispatch',
        evidenceIds: [],
        metadata: {
          agentId: result.agentId,
        },
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      artifactStore.register(sessionId, runId, record);
      return artifactId;
    });

    const evidenceId = generateEventId('evidence');
    const evidenceRecord: EvidenceRecord = {
      evidenceId,
      runId,
      sessionId,
      kind: 'analysis',
      title: `${result.agentId} finding`,
      summary: result.reasoningSummary.summary,
      refs: result.reasoningSummary.evidence,
      taskId: 'dispatch',
      agentId: result.agentId,
      artifactIds,
      strength: result.reasoningSummary.confidence >= 0.75 ? 'strong' : 'supporting',
      metadata: {
        nextStep: result.reasoningSummary.nextStep,
        confidence: result.reasoningSummary.confidence,
      },
      createdAt: nowIso(),
    };
    evidenceLedger.appendEvidence(sessionId, runId, evidenceRecord);

    const card: AgentResultCard = {
      cardId: generateEventId('agent-card'),
      runId,
      sessionId,
      agentId: result.agentId,
      taskId: 'dispatch',
      status: 'completed',
      summary: result.reasoningSummary.summary,
      evidenceIds: [evidenceId],
      artifactIds,
      verificationResultIds: [],
      nextActions: [result.reasoningSummary.nextStep].filter(Boolean),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const storedCard = contextService.appendAgentResultCard(sessionId, runId, card);
    contextService.writeRunCapsule(sessionId, runId);
    return storedCard;
  }

  private persistVerificationResult(
    sessionId: string,
    runId: string,
    debugPlan: DebugPlan,
    verification: { status: 'ok' | 'warning'; payload: Record<string, unknown> },
    skeptic: { payload: Record<string, unknown> },
    evidenceIds: string[],
  ): VerificationResult {
    const rejected = skeptic.payload.verdict === 'rejected';
    const verificationResult: VerificationResult = {
      resultId: generateEventId('verification'),
      contractId: `${debugPlan.planId}-verification`,
      runId,
      sessionId,
      status: rejected ? 'failed' : verification.status === 'ok' ? 'passed' : 'inconclusive',
      proposedRoute: rejected ? 'generator' : 'curator',
      method: 'llm_review',
      summary: String(skeptic.payload.summary || verification.payload.summary || ''),
      failedCriteria: rejected ? debugPlan.verificationContract.successCriteria : [],
      evidenceGaps: rejected ? ['Verifier rejected the available evidence chain.'] : [],
      rejectedClaims: rejected ? [String(verification.payload.summary || 'Rejected verification claim')] : [],
      taskMutations: rejected
        ? [{
            mutationId: generateEventId('task-mutation'),
            taskId: 'fix_verify',
            runId,
            sessionId,
            type: 'update_status',
            actor: 'skeptic_agent',
            patch: {
              status: 'blocked',
              blockerRefs: ['SKEPTIC_REJECTED'],
            },
            reason: String(skeptic.payload.summary || 'Skeptic rejected the evidence chain.'),
            requiresUserApproval: false,
            createdAt: nowIso(),
          }]
        : [],
      evidenceIds,
      artifactIds: [],
      blockers: rejected ? ['SKEPTIC_REJECTED'] : [],
      confidence: rejected ? 0.35 : verification.status === 'ok' ? 0.82 : 0.64,
      loopCount: 0,
      createdAt: nowIso(),
    };
    evidenceLedger.appendVerificationResult(sessionId, runId, verificationResult);
    contextService.writeRunCapsule(sessionId, runId);
    return verificationResult;
  }

  private async executeApprovedRun(location: RunLocation, debugPlan: DebugPlan, signal: AbortSignal): Promise<void> {
    const project = storageAdapter.getProjectById(location.run.projectId);
    if (!project || !debugPlan.targetCapture) {
      throw new Error('Project or target capture is missing.');
    }

    if (process.env.RDC_AGENT_TEST_MODE === '1') {
      await this.executeMockRun(location, debugPlan, signal, project.rootPath);
      return;
    }

    const resolved = intakeContextResolver.resolve({
      projectId: location.run.projectId,
      sessionId: location.session.sessionId,
      mode: location.run.mode,
      goal: location.run.goal,
      captures: location.run.captures,
    });
    const captures = location.run.captures.length > 0
      ? location.run.captures
      : [{
          id: debugPlan.targetCapture.captureId,
          filePath: debugPlan.targetCapture.filePath,
          role: 'primary' as const,
          backendHint: location.run.backend,
          status: 'pending' as const,
      }];

    try {
      const routeBlockers = debuggerLlmService.getRouteBlockers(
        this.getRequiredRouteAgents(debugPlan, location.run.backend),
        'dispatch',
      );
      if (routeBlockers.length > 0) {
        throw { blocker: routeBlockers[0] };
      }

      await rdxSessionService.bootstrap({
        projectId: location.run.projectId,
        sessionId: location.session.sessionId,
        mode: location.run.mode,
        goal: location.run.goal,
        captures,
        primaryCaptureId: debugPlan.targetCapture.captureId,
        replayDevice: resolved.replayDevice,
      });

      const runtimeContext = {
        runId: location.run.runId,
        turnId: location.run.turnId,
        sessionId: location.session.sessionId,
        caseId: location.run.caseId,
        contextId: rdxSessionService.getContextId() || '',
        runtimeOwner: rdxSessionService.getRuntimeOwner() || '',
        ownerLeaseId: rdxSessionService.getOwnerLeaseId() || '',
        debugPlan,
        targetCapturePath: debugPlan.targetCapture.filePath,
        outputRoot: storageAdapter.getRunPath(location.session.sessionId, location.run.runId),
        signal,
      };

      if (!runtimeContext.contextId || !runtimeContext.runtimeOwner || !runtimeContext.ownerLeaseId) {
        throw new Error('Runtime context is incomplete after bootstrap.');
      }

      await storageAdapter.updateRun(location.session.sessionId, location.run.runId, {
        captures: rdxSessionService.getCaptureDescriptors(),
        runtime: {
          context_id: runtimeContext.contextId,
          runtime_owner: runtimeContext.runtimeOwner,
          workflow_stage: 'dispatch',
        },
      });

      const surface = await specialistRecipeRunner.prepareSurface(runtimeContext);
      this.applyTaskMutation(location.session.sessionId, location.run.runId, 'speclist', 'completed', 'Task board seeded for the approved plan.');
      this.applyTaskMutation(location.session.sessionId, location.run.runId, 'dispatch', 'in_progress', 'Specialist dispatch started.');
      contextService.appendContextPacket(location.session.sessionId, location.run.runId, {
        packetId: generateEventId('context-packet'),
        runId: location.run.runId,
        sessionId: location.session.sessionId,
        kind: 'handoff',
        source: 'harness',
        title: 'Specialist dispatch context',
        summary: debugPlan.scope,
        content: JSON.stringify({
          targetCapture: debugPlan.targetCapture,
          targetFrameOrEvent: debugPlan.targetFrameOrEvent,
          specialists: debugPlan.recommendedSpecialists,
        }),
        refs: [debugPlan.targetCapture.filePath],
        taskIds: ['dispatch'],
        evidenceIds: [],
        artifactIds: [],
        createdAt: nowIso(),
      });
      const specialistResults: Array<{ reasoningSummary: ReasoningSummary; artifacts: string[] }> = [];
      for (const specialist of debugPlan.recommendedSpecialists) {
        if (signal.aborted) {
          throw new Error(`Run aborted: ${location.run.runId}`);
        }

        await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
          runId: location.run.runId,
          sessionId: location.session.sessionId,
          agentId: 'rdc-debugger',
          eventType: 'dispatch',
          status: 'sent',
          payload: {
            targetAgent: specialist,
            objective: `Investigate ${debugPlan.scope}`,
          },
        }));

        const result = await specialistRecipeRunner.run(specialist, runtimeContext, surface);
        specialistResults.push(result);
        this.persistAgentResult(location.session.sessionId, location.run.runId, result);
        await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
          runId: location.run.runId,
          sessionId: location.session.sessionId,
          agentId: specialist,
          eventType: 'agent_summary',
          status: 'ok',
          payload: {
            stage: 'dispatch',
            summary: result.reasoningSummary.summary,
            evidence: result.reasoningSummary.evidence,
            next_step: result.reasoningSummary.nextStep,
            confidence: result.reasoningSummary.confidence,
            artifacts: result.artifacts,
          },
        }));
      }
      this.applyTaskMutation(location.session.sessionId, location.run.runId, 'dispatch', 'completed', 'Specialist dispatch completed.');

      await this.persistInvestigationAndReport(location, debugPlan, runtimeContext, surface.replaySessionId, specialistResults);
    } catch (error) {
      const aborted = signal.aborted;
      const blocker = aborted
        ? {
            code: 'RUN_STOPPED',
            reason: 'Run stopped by user.',
            refs: [],
            detectedAt: nowIso(),
          }
        : this.normalizeLlmBlocker(error, 'RUN_FAILED');
      await storageAdapter.updateRun(location.session.sessionId, location.run.runId, {
        status: aborted ? 'cancelled' : 'failed',
        stopReason: aborted ? 'Stopped by user' : blocker.reason,
        stoppedAt: Date.now(),
        finishedAt: Date.now(),
      });
      await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
        runId: location.run.runId,
        sessionId: location.session.sessionId,
        agentId: 'rdc-debugger',
        eventType: 'blocker',
        status: aborted ? 'warning' : 'error',
        payload: {
          code: blocker.code,
          reason: blocker.reason,
          refs: blocker.refs,
        },
      }));
      this.emitRunStatus(
        location.session.sessionId,
        location.run.runId,
        aborted ? 'cancelled' : 'failed',
        location.run.lastStage,
        blocker.reason,
      );
      this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, location.run.runId));
    } finally {
      await rdxSessionService.closeOrReplaceOpenedCapture();
    }
  }

  private async executeMockRun(
    location: RunLocation,
    debugPlan: DebugPlan,
    signal: AbortSignal,
    projectRoot: string,
  ): Promise<void> {
    const slowRun = /stop-test|slow-run/i.test(debugPlan.userGoal);
    const specialistAgents = debugPlan.recommendedSpecialists.length > 0
      ? debugPlan.recommendedSpecialists
      : ['triage_agent', 'pixel_forensics_agent', 'shader_ir_agent'];
    this.applyTaskMutation(location.session.sessionId, location.run.runId, 'speclist', 'completed', 'Mock task board seeded.');
    this.applyTaskMutation(location.session.sessionId, location.run.runId, 'dispatch', 'in_progress', 'Mock specialist dispatch started.');

    for (const specialist of specialistAgents) {
      if (signal.aborted) {
        throw new Error(`Run aborted: ${location.run.runId}`);
      }
      await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
        runId: location.run.runId,
        sessionId: location.session.sessionId,
        agentId: 'rdc-debugger',
        eventType: 'dispatch',
        status: 'sent',
        payload: {
          targetAgent: specialist,
          objective: `Mock investigate ${debugPlan.scope}`,
        },
      }));
      await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
        runId: location.run.runId,
        sessionId: location.session.sessionId,
        agentId: specialist as AgentRole,
        eventType: 'tool_execution',
        status: 'ok',
        payload: {
          tool_name: `mock.${specialist}.tool`,
          result: 'success',
        },
      }));
      await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
        runId: location.run.runId,
        sessionId: location.session.sessionId,
        agentId: specialist as AgentRole,
        eventType: 'agent_summary',
        status: 'ok',
        payload: {
          stage: 'dispatch',
          summary: `${specialist} completed deterministic mock analysis.`,
          evidence: [`mock:${specialist}`],
          next_step: 'Continue through the debugger main chain.',
          confidence: 0.7,
        },
      }));
      const evidenceId = generateEventId('evidence');
      evidenceLedger.appendEvidence(location.session.sessionId, location.run.runId, {
        evidenceId,
        runId: location.run.runId,
        sessionId: location.session.sessionId,
        kind: 'analysis',
        title: `${specialist} mock finding`,
        summary: `${specialist} completed deterministic mock analysis.`,
        refs: [`mock:${specialist}`],
        taskId: 'dispatch',
        agentId: specialist as AgentRole,
        artifactIds: [],
        strength: 'supporting',
        metadata: {
          confidence: 0.7,
        },
        createdAt: nowIso(),
      });
      contextService.appendAgentResultCard(location.session.sessionId, location.run.runId, {
        cardId: generateEventId('agent-card'),
        runId: location.run.runId,
        sessionId: location.session.sessionId,
        agentId: specialist as AgentRole,
        taskId: 'dispatch',
        status: 'completed',
        summary: `${specialist} completed deterministic mock analysis.`,
        evidenceIds: [evidenceId],
        artifactIds: [],
        verificationResultIds: [],
        nextActions: ['Continue through the debugger main chain.'],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
    }
    this.applyTaskMutation(location.session.sessionId, location.run.runId, 'dispatch', 'completed', 'Mock specialist dispatch completed.');
    this.applyTaskMutation(location.session.sessionId, location.run.runId, 'investigate', 'completed', 'Mock investigation completed.');
    this.applyTaskMutation(location.session.sessionId, location.run.runId, 'fix_verify', 'completed', 'Mock verification completed.');

    if (slowRun) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, 1800);
        signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new Error(`Run aborted: ${location.run.runId}`));
        }, { once: true });
      });
    }

    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      agentId: 'rdc-debugger',
      eventType: 'verification',
      status: 'ok',
      payload: {
        verification_kind: 'fix_verify',
        verdict: 'passed',
        summary: 'Deterministic mock verification passed.',
      },
    }));

    const report = {
      title: `Mock Debugger Report - ${debugPlan.targetCapture?.fileName || 'capture'}`,
      summary: 'Deterministic mock execution completed through the debugger main chain.',
      rootCause: 'Mock root cause for deterministic E2E coverage.',
      fixDescription: 'Mock fix validated for deterministic E2E coverage.',
      evidenceSummary: specialistAgents.map((agent) => `mock:${agent}`),
      recommendations: ['Use live mode for full RenderDoc-backed execution.'],
      confidence: 0.75,
      generatedAt: nowIso(),
      curatorAgentId: 'curator_agent' as const,
    };

    const bundle = reportBundleService.publish({
      projectRoot,
      sessionId: location.session.sessionId,
      runId: location.run.runId,
      goal: debugPlan.userGoal,
      report,
      evidenceSummary: report.evidenceSummary,
      verificationSummary: ['Deterministic mock verification passed.'],
      eventCount: (await storageAdapter.readActionChain(location.session.sessionId))
        .filter((event) => event.run_id === location.run.runId)
        .length,
      artifactPaths: [],
      llmExecution: debuggerLlmService.getRunSummary(location.run.runId),
    });

    await storageAdapter.updateRun(location.session.sessionId, location.run.runId, {
      status: 'completed',
      finishedAt: Date.now(),
      lastStage: 'finalize',
      reportPaths: bundle,
      runtime: {
        workflow_stage: 'finalize',
      },
    });
    this.applyTaskMutation(location.session.sessionId, location.run.runId, 'curate', 'completed', 'Mock report bundle published.');
    contextService.writeRunCapsule(location.session.sessionId, location.run.runId);
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      agentId: 'curator_agent',
      eventType: 'report_published',
      status: 'ok',
      payload: {
        markdownPath: bundle.markdownPath,
        jsonPath: bundle.jsonPath,
        htmlPath: bundle.htmlPath,
      },
    }));
    await this.appendAssistantConversationMessage(
      location.session.sessionId,
      location.run.runId,
      `调试报告已生成：${bundle.htmlPath || bundle.markdownPath || 'reports ready'}`,
    );
    this.emitRunStatus(location.session.sessionId, location.run.runId, 'completed', 'finalize');
    this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, location.run.runId));
  }

  private async persistInvestigationAndReport(
    location: RunLocation,
    debugPlan: DebugPlan,
    runtimeContext: {
      runId: string;
      turnId?: string;
      sessionId: string;
      caseId: string;
      contextId: string;
      runtimeOwner: string;
      ownerLeaseId: string;
      debugPlan: DebugPlan;
      targetCapturePath: string;
      outputRoot: string;
      signal: AbortSignal;
    },
    replaySessionId: string,
    specialistResults: Array<{ reasoningSummary: ReasoningSummary; artifacts: string[] }>,
  ): Promise<void> {
    this.applyTaskMutation(location.session.sessionId, location.run.runId, 'investigate', 'in_progress', 'Investigation synthesis started.');
    await storageAdapter.updateRun(location.session.sessionId, location.run.runId, {
      lastStage: 'investigate',
      runtime: {
        workflow_stage: 'investigate',
      },
    });
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      agentId: 'rdc-debugger',
      eventType: 'workflow_stage_transition',
      status: 'ok',
      payload: {
        fromStage: 'dispatch',
        toStage: 'investigate',
      },
    }));

    const investigationSummary = await this.buildInvestigationSummary(location, debugPlan, specialistResults);
    const investigationEvidenceId = generateEventId('evidence');
    evidenceLedger.appendEvidence(location.session.sessionId, location.run.runId, {
      evidenceId: investigationEvidenceId,
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      kind: 'analysis',
      title: 'Debugger investigation summary',
      summary: investigationSummary.summary,
      refs: investigationSummary.evidence,
      taskId: 'investigate',
      agentId: 'rdc-debugger',
      artifactIds: [],
      strength: investigationSummary.confidence >= 0.75 ? 'strong' : 'supporting',
      metadata: {
        nextStep: investigationSummary.nextStep,
        confidence: investigationSummary.confidence,
      },
      createdAt: nowIso(),
    });
    this.applyTaskMutation(
      location.session.sessionId,
      location.run.runId,
      'investigate',
      'completed',
      'Investigation summary recorded in EvidenceLedger.',
      { evidenceRefs: [investigationEvidenceId] },
    );
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      agentId: 'rdc-debugger',
      eventType: 'agent_summary',
      status: 'ok',
      payload: {
        stage: 'investigate',
        summary: investigationSummary.summary,
        evidence: investigationSummary.evidence,
        next_step: investigationSummary.nextStep,
        confidence: investigationSummary.confidence,
      },
    }));

    this.applyTaskMutation(location.session.sessionId, location.run.runId, 'fix_verify', 'in_progress', 'Verification started.');
    const verification = await this.executeVerification(runtimeContext, replaySessionId, investigationSummary);
    await storageAdapter.updateRun(location.session.sessionId, location.run.runId, {
      lastStage: 'fix_verify',
      runtime: {
        workflow_stage: 'fix_verify',
      },
    });
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      agentId: 'rdc-debugger',
      eventType: 'verification',
      status: verification.status,
      payload: verification.payload,
    }));

    const skeptic = await this.executeSkepticReview(location, debugPlan, investigationSummary, verification);
    const verificationResult = this.persistVerificationResult(
      location.session.sessionId,
      location.run.runId,
      debugPlan,
      verification,
      skeptic,
      [investigationEvidenceId],
    );
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      agentId: 'skeptic_agent',
      eventType: 'verification',
      status: skeptic.status,
      payload: skeptic.payload,
    }));

    if (skeptic.payload.verdict === 'rejected') {
      this.applyTaskMutation(
        location.session.sessionId,
        location.run.runId,
        'fix_verify',
        'blocked',
        String(skeptic.payload.summary || 'Skeptic rejected the evidence chain.'),
        { evidenceRefs: verificationResult.evidenceIds },
      );
      await storageAdapter.updateRun(location.session.sessionId, location.run.runId, {
        status: 'failed',
        stopReason: String(skeptic.payload.summary || 'Skeptic rejected the evidence chain.'),
        stoppedAt: Date.now(),
        finishedAt: Date.now(),
        lastStage: 'fix_verify',
        runtime: {
          workflow_stage: 'fix_verify',
        },
      });
      this.emitRunStatus(
        location.session.sessionId,
        location.run.runId,
        'failed',
        'fix_verify',
        String(skeptic.payload.summary || 'Skeptic rejected the evidence chain.'),
      );
      this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, location.run.runId));
      return;
    }
    this.applyTaskMutation(
      location.session.sessionId,
      location.run.runId,
      'fix_verify',
      'completed',
      'Verifier accepted the evidence chain.',
      { evidenceRefs: verificationResult.evidenceIds },
    );
    this.applyTaskMutation(location.session.sessionId, location.run.runId, 'curate', 'in_progress', 'Curator report generation started.');

    const project = storageAdapter.getProjectById(location.run.projectId);
    if (!project) {
      throw new Error(`Project not found: ${location.run.projectId}`);
    }

    const report = await this.buildReport(location, debugPlan, investigationSummary, verification, skeptic);
    const llmExecution = debuggerLlmService.getRunSummary(location.run.runId);
    const bundle = reportBundleService.publish({
      projectRoot: project.rootPath,
      sessionId: location.session.sessionId,
      runId: location.run.runId,
      goal: debugPlan.userGoal,
      report,
      evidenceSummary: investigationSummary.evidence,
      verificationSummary: [
        String(verification.payload.summary),
        String(skeptic.payload.summary),
      ],
      eventCount: (await storageAdapter.readActionChain(location.session.sessionId))
        .filter((event) => event.run_id === location.run.runId)
        .length,
      artifactPaths: specialistResults.flatMap((result) => result.artifacts),
      llmExecution,
    });

    await storageAdapter.updateRun(location.session.sessionId, location.run.runId, {
      status: 'completed',
      finishedAt: Date.now(),
      lastStage: 'finalize',
      reportPaths: bundle,
      runtime: {
        workflow_stage: 'finalize',
      },
    });
    this.applyTaskMutation(location.session.sessionId, location.run.runId, 'curate', 'completed', 'Report bundle published.');
    contextService.writeRunCapsule(location.session.sessionId, location.run.runId);
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      agentId: 'curator_agent',
      eventType: 'report_published',
      status: 'ok',
      payload: {
        markdownPath: bundle.markdownPath,
        jsonPath: bundle.jsonPath,
        htmlPath: bundle.htmlPath,
      },
    }));
    await this.appendAssistantConversationMessage(
      location.session.sessionId,
      location.run.runId,
      `调试报告已生成：${bundle.htmlPath || bundle.markdownPath || 'reports ready'}`,
    );
    this.emitRunStatus(location.session.sessionId, location.run.runId, 'completed', 'finalize');
    this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, location.run.runId));
  }

  private async buildInvestigationSummary(
    location: RunLocation,
    debugPlan: DebugPlan,
    specialistResults: Array<{ reasoningSummary: ReasoningSummary }>,
  ): Promise<ReasoningSummary> {
    const evidence = specialistResults.flatMap((result) => result.reasoningSummary.evidence);
    const deterministic: InvestigationLlmPayload = {
      summary: `Investigation synthesized ${specialistResults.length} specialist briefs around ${debugPlan.targetCapture?.fileName || 'the target capture'} and ${debugPlan.targetFrameOrEvent?.eventLabel || 'the active frame'}.`,
      evidence,
      next_step: 'Validate the leading root-cause hypothesis against verification contract and skeptic review.',
      confidence: specialistResults.length > 1 ? 0.74 : 0.58,
      root_cause: `The leading root cause sits around ${debugPlan.targetFrameOrEvent?.eventLabel || 'the active frame'} and must be validated against the collected pipeline, pixel, and shader evidence.`,
      recommendations: [
        'Review the highlighted pipeline, pixel, and shader evidence together before landing a permanent fix.',
        'Preserve the generated screenshots and specialist notes for regression tracking.',
      ],
    };

    const { data } = await debuggerLlmService.callStructured<InvestigationLlmPayload>({
      agentId: 'rdc-debugger',
      stage: 'investigate',
      sessionId: location.session.sessionId,
      runId: location.run.runId,
      messages: [
        {
          role: 'system',
          content: 'You are the RDC Debugger orchestrator. Return JSON only with keys summary, evidence, next_step, confidence, root_cause, recommendations. Ground every field in the provided specialist evidence.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            goal: debugPlan.userGoal,
            targetCapture: debugPlan.targetCapture,
            targetFrameOrEvent: debugPlan.targetFrameOrEvent,
            specialistResults: specialistResults.map((result) => result.reasoningSummary),
          }),
        },
      ],
      maxTokens: 700,
      temperature: 0.2,
      parse: (text) => debuggerLlmService.parseJson<InvestigationLlmPayload>(text),
      testValue: deterministic,
      auditSummary: (payload) => payload.summary,
    });

    return {
      summaryId: `rdc-debugger-${Date.now()}`,
      stage: 'investigate',
      agentId: 'rdc-debugger',
      summary: data.summary,
      evidence: toStringArray(data.evidence).length > 0 ? toStringArray(data.evidence) : evidence,
      nextStep: data.next_step,
      confidence: toConfidence(data.confidence, deterministic.confidence),
      createdAt: nowIso(),
    };
  }

  private async executeVerification(
    runtimeContext: {
      runId: string;
      turnId?: string;
      sessionId: string;
      caseId: string;
      contextId: string;
      runtimeOwner: string;
      ownerLeaseId: string;
      debugPlan: DebugPlan;
      targetCapturePath: string;
      outputRoot: string;
      signal: AbortSignal;
    },
    replaySessionId: string,
    investigationSummary: ReasoningSummary,
  ): Promise<{
    status: 'ok' | 'warning';
    payload: Record<string, unknown>;
  }> {
    const verificationScreenshot = path.join(runtimeContext.outputRoot, 'screenshots', 'verification.png');
    await harnessController.wrapToolExecution({
      toolName: 'rd.export.screenshot',
      args: {
        session_id: replaySessionId,
        output_path: verificationScreenshot,
        file_format: 'png',
        include_alpha: true,
      },
      agentId: 'rdc-debugger',
      sessionId: runtimeContext.sessionId,
      runId: runtimeContext.runId,
      turnId: runtimeContext.turnId,
      execute: () => toolBridge.call({
        toolName: 'rd.export.screenshot',
        args: {
          session_id: replaySessionId,
          output_path: verificationScreenshot,
          file_format: 'png',
          include_alpha: true,
          context_id: runtimeContext.contextId,
          runtime_owner: runtimeContext.runtimeOwner,
          owner_lease_id: runtimeContext.ownerLeaseId,
        },
        contextId: runtimeContext.contextId,
        turnId: runtimeContext.turnId,
        runtimeOwner: runtimeContext.runtimeOwner,
        ownerLeaseId: runtimeContext.ownerLeaseId,
        runId: runtimeContext.runId,
        abortSignal: runtimeContext.signal,
      }),
    });

    return {
      status: runtimeContext.debugPlan.verificationContract.requiresFixValidation ? 'warning' : 'ok',
      payload: {
        verification_kind: 'fix_verify',
        verdict: runtimeContext.debugPlan.verificationContract.requiresFixValidation ? 'evidence_consistent_warning' : 'passed',
        summary: runtimeContext.debugPlan.verificationContract.requiresFixValidation
          ? 'Verification completed with real framebuffer evidence, but shader hotfix replay remained best-effort only.'
          : 'Verification completed with real framebuffer evidence.',
        screenshot_path: verificationScreenshot,
        evidence: investigationSummary.evidence,
      },
    };
  }

  private async executeSkepticReview(
    location: RunLocation,
    debugPlan: DebugPlan,
    investigationSummary: ReasoningSummary,
    verification: { status: 'ok' | 'warning'; payload: Record<string, unknown> },
  ): Promise<{
    status: 'ok' | 'warning';
    payload: Record<string, unknown>;
  }> {
    const deterministic: SkepticReviewPayload = {
      verdict: verification.status === 'ok' ? 'approved' : 'approved_with_warning',
      summary: verification.status === 'ok'
        ? 'Skeptic accepted the evidence chain.'
        : 'Skeptic accepted the evidence chain but flagged verification as best-effort.',
    };

    const { data } = await debuggerLlmService.callStructured<SkepticReviewPayload>({
      agentId: 'skeptic_agent',
      stage: 'skeptic',
      sessionId: location.session.sessionId,
      runId: location.run.runId,
      messages: [
        {
          role: 'system',
          content: 'You are the skeptic agent. Return JSON only with keys verdict and summary. Verdict must be one of approved, approved_with_warning, rejected. Reject only when the evidence chain is not strong enough to support publication.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            goal: debugPlan.userGoal,
            investigationSummary,
            verification,
          }),
        },
      ],
      maxTokens: 400,
      temperature: 0.1,
      parse: (text) => debuggerLlmService.parseJson<SkepticReviewPayload>(text),
      testValue: deterministic,
      auditSummary: (payload) => payload.summary,
    });

    return {
      status: data.verdict === 'approved' ? 'ok' : 'warning',
      payload: {
        verification_kind: 'skeptic_review',
        verdict: data.verdict,
        summary: data.summary,
      },
    };
  }

  private async buildReport(
    location: RunLocation,
    debugPlan: DebugPlan,
    investigationSummary: ReasoningSummary,
    verification: { payload: Record<string, unknown> },
    skeptic: { payload: Record<string, unknown> },
  ) {
    const deterministic: CuratedReportPayload = {
      title: `Debugger Report - ${debugPlan.targetCapture?.fileName || 'capture'}`,
      summary: investigationSummary.summary,
      root_cause: investigationSummary.summary,
      fix_description: String(verification.payload.summary),
      evidence_summary: investigationSummary.evidence,
      recommendations: [
        'Review the highlighted pipeline/shader evidence before landing a permanent fix.',
        'Keep the generated screenshot and specialist notes together with the report for regression tracking.',
      ],
      confidence: investigationSummary.confidence,
    };

    const { data } = await debuggerLlmService.callStructured<CuratedReportPayload>({
      agentId: 'curator_agent',
      stage: 'curate',
      sessionId: location.session.sessionId,
      runId: location.run.runId,
      messages: [
        {
          role: 'system',
          content: 'You are the curator agent. Return JSON only with keys title, summary, root_cause, fix_description, evidence_summary, recommendations, confidence. Summaries must stay grounded in the verified evidence chain and skeptic outcome.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            goal: debugPlan.userGoal,
            investigationSummary,
            verification,
            skeptic,
          }),
        },
      ],
      maxTokens: 900,
      temperature: 0.2,
      parse: (text) => debuggerLlmService.parseJson<CuratedReportPayload>(text),
      testValue: deterministic,
      auditSummary: (payload) => payload.summary,
    });

    return {
      title: data.title,
      summary: data.summary,
      rootCause: data.root_cause,
      fixDescription: data.fix_description,
      evidenceSummary: toStringArray(data.evidence_summary),
      recommendations: toStringArray(data.recommendations),
      confidence: toConfidence(data.confidence, deterministic.confidence),
      generatedAt: nowIso(),
      curatorAgentId: 'curator_agent' as const,
    };
  }

  private getRequiredRouteAgents(debugPlan: DebugPlan, backend: 'local' | 'remote'): AgentRole[] {
    const required = new Set<AgentRole>([
      'rdc-debugger',
      'skeptic_agent',
      'curator_agent',
      ...debugPlan.recommendedSpecialists,
    ]);

    if (backend === 'remote') {
      required.add('driver_device_agent');
    }

    return Array.from(required);
  }

  private async generatePlanWithLlm(input: {
    sessionId: string;
    runId: string;
    resolvedGoal: string;
    basePlan: DebugPlan;
  }): Promise<DebugPlan> {
    const deterministic: PlanLlmPayload = {
      scope: input.basePlan.scope,
      notes: input.basePlan.notes,
      recommended_specialists: input.basePlan.recommendedSpecialists,
      verification_focus: input.basePlan.verificationContract.successCriteria,
    };

    const { data } = await debuggerLlmService.callStructured<PlanLlmPayload>({
      agentId: 'rdc-debugger',
      stage: 'plan',
      sessionId: input.sessionId,
      runId: input.runId,
      messages: [
        {
          role: 'system',
          content: 'You are the RDC Debugger planner. Return JSON only with keys scope, notes, recommended_specialists, verification_focus. Keep the plan grounded in the provided intake facts and do not invent unsupported captures or event ids.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            goal: input.resolvedGoal,
            basePlan: input.basePlan,
          }),
        },
      ],
      maxTokens: 700,
      temperature: 0.2,
      parse: (text) => debuggerLlmService.parseJson<PlanLlmPayload>(text),
      testValue: deterministic,
      auditSummary: (payload) => payload.scope,
    });

    return {
      ...input.basePlan,
      scope: data.scope || input.basePlan.scope,
      notes: Array.from(new Set([
        ...input.basePlan.notes,
        ...toStringArray(data.notes),
        ...toStringArray(data.verification_focus).map((item) => `Verification focus: ${item}`),
      ])),
      recommendedSpecialists: toRecommendedSpecialists(data.recommended_specialists, input.basePlan.recommendedSpecialists),
      updatedAt: nowIso(),
    };
  }

  private normalizeLlmBlocker(error: unknown, fallbackCode: string): Blocker {
    if (error && typeof error === 'object' && 'blocker' in error) {
      const blocker = (error as { blocker?: Blocker }).blocker;
      if (blocker) {
        return blocker;
      }
    }

    return {
      code: fallbackCode,
      reason: error instanceof Error ? error.message : String(error),
      refs: [],
      detectedAt: nowIso(),
    };
  }

  private async appendActionEvent(sessionId: string, event: ActionEvent): Promise<void> {
    if (!event.turn_id && event.run_id) {
      const location = this.findRun(event.run_id);
      if (location?.run.turnId) {
        event.turn_id = location.run.turnId;
      }
    }
    await storageAdapter.appendActionEvent(sessionId, event);
    workflowProjectionPublisher.publishEvidenceEvent(event);
  }

  private async appendAssistantConversationMessage(
    sessionId: string,
    runId: string | null,
    content: string,
  ): Promise<void> {
    const runLocation = this.findRun(runId || '');
    const message: ConversationMessage = {
      id: generateEventId('msga'),
      turnId: runLocation?.run.turnId || generateEventId('turn'),
      sessionId,
      projectId: runLocation?.session.projectId ?? null,
      runId,
      modeContext: runLocation?.run.mode ?? 'debugger',
      role: 'assistant',
      agentId: 'rdc-debugger',
      content,
      status: 'complete',
      updatedAt: nowMs(),
      reasoningTrace: null,
      createdAt: nowMs(),
    };
    storageAdapter.appendConversationMessage(sessionId, message);
    this.emitConversationEvent({
      type: 'message_completed',
      sessionId,
      turnId: message.turnId,
      message,
    });
  }

  private findRun(runId: string): RunLocation | null {
    const projects = storageAdapter.listProjects();
    for (const project of projects) {
      const sessions = storageAdapter.listSessions(project.projectId);
      for (const session of sessions) {
        const run = storageAdapter.listRuns(session.sessionId).find((entry) => entry.runId === runId);
        if (run) {
          return { session, run };
        }
      }
    }
    return null;
  }

  private emitWorkflowState(state: WorkflowState): void {
    workflowProjectionPublisher.publishWorkflowState(state);
  }

  private emitRunStatus(
    sessionId: string,
    runId: string,
    status: RunSummary['status'],
    lastStage?: string,
    stopReason?: string,
  ): void {
    workflowProjectionPublisher.publishRunStatus({
      sessionId,
      runId,
      status,
      lastStage,
      stopReason,
    });
  }

  private emitConversationEvent(event: ConversationStreamEvent): void {
    workflowProjectionPublisher.publishConversationEvent(event);
  }
}

export const debugWorkflowService = new DebugWorkflowService();
