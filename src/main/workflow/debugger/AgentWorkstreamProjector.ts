import type { ActionEvent } from '@shared/types/evidence';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ArtifactRecord, HarnessTask } from '@shared/types/harness';
import type { RunSummary } from '@shared/types/session';
import type { DebugPlan, PlanApprovalState } from '@shared/types/workflow';
import type {
  AgentTextEvent,
  AgentWorkstreamPresentation,
  AgentWorkstreamSession,
  ArtifactsPanelViewModel,
  ContextPanelGroupViewModel,
  PlanStatus,
  ProcessEvent,
  ProcessTraceItemViewModel,
  ProgressPanelViewModel,
  ProgressTask,
  ProgressTaskStatus,
  RawAuditRef,
  RequestBranchGroup,
  RightPanelViewModel,
  SubAgentEvent,
  TaskResultRecord,
  TaskResultSection,
  TaskWorkstream,
  TaskWorkstreamViewModel,
  ToolEvent,
  ToolStatus,
  UserRequest,
  UserPromptBubbleViewModel,
  WorkstreamArtifactRecord,
  WorkstreamContextRecord,
  WorkstreamSessionResult,
} from '@shared/types/workstream';
import { nowIso } from '@shared/utils/id';
import { storageAdapter } from '../../sessions/StorageAdapter';
import { artifactStore } from '../../reports/ArtifactStore';
import { contextService } from '../../captures/ContextService';
import { taskBoard } from './TaskBoard';
import { workstreamStateStore, type WorkstreamPersistedState } from './WorkstreamStateStore';

interface AskTurn {
  turnId: string;
  createdAt: number;
  completedAt: number;
  messages: ConversationMessage[];
  userMessage?: ConversationMessage;
  assistantMessages: ConversationMessage[];
}

const toIso = (value: number | string | undefined, fallback = nowIso()): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return fallback;
};

const firstLine = (value: unknown, fallback: string): string => {
  const text = typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value);
  return text.trim().split(/\r?\n/)[0]?.trim() || fallback;
};

const cleanText = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value === undefined || value === null) {
    return '';
  }
  return JSON.stringify(value, null, 2);
};

const workstreamTypeFromRun = (run?: RunSummary | null): TaskWorkstream['type'] => run?.mode ?? 'ask';

const statusFromRun = (run: RunSummary, planStatus?: PlanStatus): TaskWorkstream['status'] => {
  if (planStatus === 'awaiting_approval' || run.status === 'awaiting_approval') {
    return 'awaiting_approval';
  }
  if (run.status === 'failed' || run.status === 'interrupted') {
    return 'failed';
  }
  if (run.status === 'cancelled') {
    return 'cancelled';
  }
  if (run.status === 'completed') {
    return 'completed';
  }
  return 'running';
};

const toolStatusFromEvent = (event: ActionEvent): ToolStatus => {
  if (event.status === 'error' || event.status === 'fail' || event.status === 'timeout') {
    return 'failed';
  }
  if (event.status === 'sent' || event.status === 'entered') {
    return 'running';
  }
  if (event.status === 'blocked') {
    return 'skipped';
  }
  return 'done';
};

const progressStatusFromTask = (task: HarnessTask): ProgressTaskStatus => {
  if (task.status === 'in_progress') return 'running';
  if (task.status === 'completed') return 'completed';
  if (task.status === 'blocked' || task.status === 'rejected') return 'blocked';
  if (task.status === 'cancelled') return 'cancelled';
  return 'pending';
};

const isPendingConversationStatus = (status: ConversationMessage['status'] | undefined): boolean => (
  status === 'draft' || status === 'streaming'
);

const artifactTypeFromRecord = (record: ArtifactRecord): WorkstreamArtifactRecord['type'] => {
  if (record.kind === 'report') return 'report';
  if (record.kind === 'screenshot') return 'visual_report';
  if (record.kind === 'trace' || record.kind === 'data') return 'evidence_bundle';
  return 'other';
};

const mapPlanStatus = (approvalState: PlanApprovalState | undefined, run: RunSummary): PlanStatus => {
  if (run.status === 'failed' || run.status === 'interrupted') return 'failed';
  if (run.status === 'completed') return 'executed';
  if (approvalState === 'approved') return 'accepted';
  if (approvalState === 'pending_user' || run.status === 'awaiting_approval') return 'awaiting_approval';
  if (approvalState === 'rejected') return 'needs_revision';
  return 'draft';
};

const planSections = (debugPlan: DebugPlan): TaskResultSection[] => {
  const sections = debugPlan.presentation?.sections ?? [];
  if (sections.length > 0) {
    return sections.map((section) => ({
      id: section.id || section.title,
      title: section.title,
      body: section.body.join('\n'),
      severity: 'normal',
    }));
  }

  return [
    { id: 'goal', title: '目标', body: debugPlan.userGoal },
    { id: 'scope', title: '执行路线', body: debugPlan.scope || '按 Debugger harness 推进 capture 分析。' },
    { id: 'acceptance', title: '验收标准', body: debugPlan.verificationContract.successCriteria.join('\n') },
    { id: 'risks', title: '风险 / 阻断', body: debugPlan.blockers.map((blocker) => blocker.reason).join('\n') || '暂无阻断。' },
    { id: 'deliverables', title: '预计产物', body: debugPlan.expectedDeliverables.join('\n') || '调试报告。' },
  ];
};

const resultFromPlan = (workstreamId: string, debugPlan: DebugPlan, status: PlanStatus): TaskResultRecord => ({
  id: `${workstreamId}-plan-result`,
  workstreamId,
  kind: 'plan',
  status,
  title: debugPlan.presentation?.title || 'Debugger Plan',
  sections: planSections(debugPlan),
  artifactIds: [`artifact-${debugPlan.planId}`],
  createdAt: debugPlan.createdAt,
});

const resultFromRun = (
  workstreamId: string,
  run: RunSummary,
  events: ActionEvent[],
  artifacts: WorkstreamArtifactRecord[],
): TaskResultRecord | undefined => {
  if (run.status === 'completed') {
    const reportEvent = events.find((event) => event.event_type === 'report_published');
    return {
      id: `${workstreamId}-report-result`,
      workstreamId,
      kind: 'report',
      status: 'completed',
      title: 'Execution Report',
      sections: [
        {
          id: 'summary',
          title: '结论',
          body: '调试执行已完成，报告和证据产物已写入 session 输出。',
        },
        {
          id: 'evidence',
          title: '关键证据',
          body: events
            .filter((event) => ['agent_summary', 'verification'].includes(event.event_type))
            .map((event) => firstLine(event.payload.summary ?? event.payload.verdict, event.event_type))
            .slice(0, 6)
            .join('\n') || '详见 report.md 和 raw trace。',
        },
        {
          id: 'artifacts',
          title: '产物入口',
          body: artifacts.map((artifact) => artifact.displayName).join('\n') || firstLine(reportEvent?.payload, 'report.md'),
        },
      ],
      artifactIds: artifacts.map((artifact) => artifact.id),
      createdAt: toIso(reportEvent?.ts_ms, toIso(run.finishedAt, nowIso())),
    };
  }

  if (run.status === 'failed' || run.status === 'interrupted') {
    return {
      id: `${workstreamId}-failure-result`,
      workstreamId,
      kind: 'failure',
      status: 'failed',
      title: 'Failure Report',
      sections: [
        { id: 'conclusion', title: '失败结论', body: run.stopReason || '任务未能完成。', severity: 'error' },
        {
          id: 'completed',
          title: '已完成内容',
          body: events.filter((event) => event.status === 'ok').map((event) => event.event_type).slice(0, 8).join('\n') || '无可确认完成项。',
        },
        { id: 'recovery', title: '可恢复路径', body: '保留当前 raw trace、context 和已产生产物；修复阻断后可重新发起任务。' },
      ],
      artifactIds: [],
      createdAt: toIso(run.finishedAt ?? run.stoppedAt, nowIso()),
    };
  }

  if (run.status === 'cancelled') {
    return {
      id: `${workstreamId}-cancelled-result`,
      workstreamId,
      kind: 'cancelled',
      status: 'cancelled',
      title: 'Cancelled Result',
      sections: [
        { id: 'time', title: '中断时间', body: toIso(run.stoppedAt, nowIso()) },
        { id: 'completed', title: '已完成内容', body: events.map((event) => event.event_type).slice(0, 8).join('\n') || '尚未产生可确认执行内容。' },
        { id: 'next', title: '可继续路径', body: '历史过程保留，可基于同一 capture 重新发起 Debugger 任务。' },
      ],
      artifactIds: [],
      createdAt: toIso(run.stoppedAt, nowIso()),
    };
  }

  return undefined;
};

const askResultFromTurn = (workstreamId: string, turn: AskTurn): TaskResultRecord | undefined => {
  const assistant = turn.assistantMessages.slice(-1)[0];
  if (!assistant || isPendingConversationStatus(assistant.status)) {
    return undefined;
  }

  const createdAt = toIso(assistant.updatedAt ?? assistant.createdAt, toIso(turn.completedAt));
  const diagnostic = assistant.diagnostic;

  if (assistant.status === 'error') {
    const sections: TaskResultSection[] = [
      {
        id: 'error',
        title: '失败原因',
        body: assistant.content || diagnostic?.userMessage || '回复生成失败。',
        severity: 'error',
      },
    ];
    if (diagnostic) {
      sections.push({
        id: 'diagnostic',
        title: '诊断',
        body: [
          diagnostic.code,
          diagnostic.providerId && diagnostic.modelId ? `${diagnostic.providerId}/${diagnostic.modelId}` : diagnostic.providerId,
          diagnostic.technicalMessage,
        ].filter(Boolean).join('\n'),
        severity: diagnostic.severity === 'error' ? 'error' : 'warning',
      });
    }
    return {
      id: `${workstreamId}-failure-result`,
      workstreamId,
      kind: 'failure',
      status: 'failed',
      title: 'Ask Failed',
      sections,
      artifactIds: [],
      createdAt,
    };
  }

  if (assistant.status === 'stopped') {
    return {
      id: `${workstreamId}-cancelled-result`,
      workstreamId,
      kind: 'cancelled',
      status: 'cancelled',
      title: 'Ask Cancelled',
      sections: [{ id: 'cancelled', title: '已停止', body: assistant.content || '当前请求已停止。' }],
      artifactIds: [],
      createdAt,
    };
  }

  const answer = turn.assistantMessages
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n');
  return {
    id: `${workstreamId}-answer-result`,
    workstreamId,
    kind: 'answer',
    status: 'completed',
    title: 'Ask Answer',
    sections: [{ id: 'answer', title: '回答', body: answer || '暂无回复内容。' }],
    artifactIds: [],
    createdAt,
  };
};

export class AgentWorkstreamProjector {
  async getSession(sessionId: string): Promise<WorkstreamSessionResult> {
    try {
      const session = storageAdapter.readSession(sessionId);
      if (!session) {
        return { success: false, error: `Session not found: ${sessionId}` };
      }

      const runs = storageAdapter.listRuns(sessionId).slice().sort((left, right) => left.startedAt - right.startedAt);
      const conversations = storageAdapter.readConversationHistory(sessionId);
      const events = await storageAdapter.readActionChain(sessionId);
      let state = workstreamStateStore.read(sessionId);

      for (const run of runs) {
        const snapshot = storageAdapter.readPlanSnapshot(sessionId, run.runId);
        if (snapshot?.debug_plan) {
          state = workstreamStateStore.ensureRunRequest({
            sessionId,
            runId: run.runId,
            prompt: run.goal,
            planId: snapshot.debug_plan.planId,
            workstreamId: this.planWorkstreamId(run.runId),
          });
          const desiredStatus = mapPlanStatus(snapshot.approval_state, run);
          const currentStatus = state.plans.find((plan) => plan.planId === snapshot.debug_plan?.planId)?.status;
          if (
            snapshot.debug_plan.planId
            && currentStatus
            && currentStatus !== desiredStatus
            && currentStatus !== 'needs_revision'
            && currentStatus !== 'superseded'
          ) {
            state = workstreamStateStore.markPlan(sessionId, snapshot.debug_plan.planId, desiredStatus);
          }
        }
      }

      const model = this.buildSessionModel(sessionId, runs, conversations, events, state);
      const presentation = this.buildPresentation(model);
      return { success: true, session: model, presentation };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  buildConversationPresentation(
    sessionId: string,
    conversations: ConversationMessage[],
  ): AgentWorkstreamPresentation {
    const model = this.buildSessionModel(sessionId, [], conversations, [], {
      schemaVersion: '1',
      sessionId,
      activeBranchId: 'branch-main',
      userRequests: [],
      branches: [],
      plans: [],
      updatedAt: nowIso(),
    });
    return this.buildPresentation(model);
  }

  buildSessionModel(
    sessionId: string,
    runs: RunSummary[],
    conversations: ConversationMessage[],
    events: ActionEvent[],
    state: WorkstreamPersistedState,
  ): AgentWorkstreamSession {
    const rawAuditRefs: RawAuditRef[] = events.map((event) => ({
      id: `raw-${event.event_id}`,
      label: event.event_type,
      eventId: event.event_id,
      runId: event.run_id,
      sessionId: event.session_id,
      ref: `action_chain:${event.event_id}`,
    }));
    const workstreams: TaskWorkstream[] = [];
    const progress: ProgressTask[] = [];
    const artifacts: WorkstreamArtifactRecord[] = [];
    const context: WorkstreamContextRecord[] = [];
    const userRequests: UserRequest[] = [...state.userRequests];

    for (const run of runs) {
      const snapshot = storageAdapter.readPlanSnapshot(sessionId, run.runId);
      const runEvents = events.filter((event) => event.run_id === run.runId).sort((left, right) => left.ts_ms - right.ts_ms);
      const planStatus = state.plans.find((plan) => plan.planId === snapshot?.debug_plan?.planId)?.status
        ?? mapPlanStatus(snapshot?.approval_state, run);
      const branchId = this.branchIdForWorkstream(state.branches, this.planWorkstreamId(run.runId), state.activeBranchId);
      const planWorkstream = this.buildPlanWorkstream(run, snapshot?.debug_plan ?? null, planStatus, branchId, runEvents, conversations);
      workstreams.push(planWorkstream);

      const runArtifacts = this.mapArtifacts(sessionId, run.runId, branchId, this.executionWorkstreamId(run.runId), runEvents);
      artifacts.push(...runArtifacts);
      progress.push(...this.mapProgress(sessionId, run.runId, branchId, this.executionWorkstreamId(run.runId)));
      context.push(...this.mapContext(sessionId, run.runId, branchId, this.executionWorkstreamId(run.runId), run));

      if (this.shouldShowExecutionWorkstream(run, snapshot?.approval_state, runEvents)) {
        workstreams.push(this.buildExecutionWorkstream(run, branchId, runEvents, runArtifacts));
      }
    }

    for (const turn of this.groupAskTurns(conversations)) {
      if (turn.messages.some((message) => message.runId)) {
        continue;
      }
      const branchId = state.activeBranchId || 'branch-main';
      const id = `ws-ask-${turn.turnId}`;
      workstreams.push(this.buildAskWorkstream(sessionId, branchId, id, turn));
      userRequests.push(this.userRequestFromAskTurn(sessionId, branchId, id, turn));
    }

    const updatedAt = nowIso();
    return {
      sessionId,
      activeBranchId: state.activeBranchId || 'branch-main',
      latestDisplayedPlanId: state.latestDisplayedPlanId,
      latestAcceptedPlanId: state.latestAcceptedPlanId,
      userRequests,
      workstreams: workstreams.sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt)),
      progress,
      artifacts,
      context,
      branches: state.branches,
      rawAuditRefs,
      updatedAt,
    };
  }

  buildPresentation(session: AgentWorkstreamSession): AgentWorkstreamPresentation {
    const activeWorkstreams = session.workstreams.filter((workstream) => workstream.branchId === session.activeBranchId);
    const items: AgentWorkstreamPresentation['items'] = activeWorkstreams.flatMap((workstream) => {
      const taskItem = this.toTaskViewModel(session, workstream);
      const userEvents = workstream.processEvents.flatMap((event): AgentWorkstreamPresentation['items'] => {
        if (event.kind === 'user.confirmed') {
          return [{
            kind: 'user_confirmation',
            id: event.id,
            workstreamId: event.workstreamId,
            planId: event.planId,
            label: event.label,
            createdAt: event.createdAt,
          }];
        }
        if (event.kind === 'user.revision_requested') {
          return [{
            kind: 'user_revision',
            id: event.id,
            workstreamId: event.workstreamId,
            planId: event.planId,
            prompt: event.prompt,
            createdAt: event.createdAt,
          }];
        }
        return [];
      });
      return [taskItem, ...userEvents];
    });
    const rightPanel = this.buildRightPanel(session, activeWorkstreams);
    const latestPlan = activeWorkstreams
      .filter((workstream) => workstream.planStatus === 'awaiting_approval')
      .slice(-1)[0] ?? null;
    const latestPlanResult = latestPlan?.result;

    return {
      sessionId: session.sessionId,
      activeBranchId: session.activeBranchId,
      mode: activeWorkstreams.find((workstream) => workstream.type !== 'ask')?.type ?? 'ask',
      items,
      rightPanel,
      approval: latestPlan && latestPlanResult
        ? {
            planId: latestPlan.planId ?? latestPlanResult.id,
            workstreamId: latestPlan.id,
            runId: latestPlan.id.replace(/^ws-/, '').replace(/-plan$/, ''),
            status: 'awaiting_approval',
            title: latestPlanResult.title,
            summary: latestPlanResult.sections.slice(0, 2).map((section) => `${section.title}: ${section.body}`).join('\n'),
            canApprove: true,
            canRequestRevision: true,
          }
        : null,
      branchNavigator: session.branches[0]
        ? {
            activeBranchId: session.activeBranchId,
            branchIndex: Math.max(session.branches[0].branches.findIndex((branch) => branch.id === session.activeBranchId), 0),
            branchCount: session.branches[0].branches.length,
            branches: session.branches[0].branches,
          }
        : null,
      rawAuditRefs: session.rawAuditRefs,
      updatedAt: session.updatedAt,
    };
  }

  private buildPlanWorkstream(
    run: RunSummary,
    debugPlan: DebugPlan | null,
    planStatus: PlanStatus,
    branchId: string,
    runEvents: ActionEvent[],
    conversations: ConversationMessage[],
  ): TaskWorkstream {
    const id = this.planWorkstreamId(run.runId);
    const confirmationEvents = runEvents
      .filter((event) => ['user_confirmation', 'user_revision_requested'].includes(event.event_type))
      .map<ProcessEvent>((event) => event.event_type === 'user_confirmation'
        ? {
            kind: 'user.confirmed',
            id: event.event_id,
            workstreamId: id,
            planId: String(event.payload.planId || debugPlan?.planId || ''),
            createdAt: toIso(event.ts_ms),
            label: String(event.payload.label || '同意执行'),
          }
        : {
            kind: 'user.revision_requested',
            id: event.event_id,
            workstreamId: id,
            planId: String(event.payload.planId || debugPlan?.planId || ''),
            createdAt: toIso(event.ts_ms),
            prompt: String(event.payload.prompt || ''),
          });
    const planEvents = runEvents.filter((event) => (
      event.event_type === 'tool_execution'
      || event.event_type === 'blocker'
      || event.event_type === 'workflow_stage_transition'
    ));

    return {
      id,
      sessionId: run.sessionId,
      branchId,
      type: workstreamTypeFromRun(run),
      status: planStatus === 'awaiting_approval' ? 'awaiting_approval' : planStatus === 'failed' ? 'failed' : 'completed',
      density: planStatus === 'awaiting_approval' ? 'expanded' : 'compact',
      resultKind: 'plan',
      startedAt: toIso(run.startedAt),
      completedAt: planStatus === 'awaiting_approval' ? undefined : toIso(run.startedAt + 1),
      processEvents: [
        ...this.agentTextFromConversation(id, run.runId, conversations),
        ...this.processEventsFromActionEvents(id, planEvents),
        ...confirmationEvents,
      ].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)),
      result: debugPlan ? resultFromPlan(id, debugPlan, planStatus) : undefined,
      planId: debugPlan?.planId,
      planStatus,
    };
  }

  private buildExecutionWorkstream(
    run: RunSummary,
    branchId: string,
    runEvents: ActionEvent[],
    artifacts: WorkstreamArtifactRecord[],
  ): TaskWorkstream {
    const id = this.executionWorkstreamId(run.runId);
    const executionEvents = runEvents.filter((event) => ![
      'user_message',
      'user_confirmation',
      'user_revision_requested',
    ].includes(event.event_type));
    const status = statusFromRun(run);
    const result = resultFromRun(id, run, executionEvents, artifacts);

    return {
      id,
      sessionId: run.sessionId,
      branchId,
      type: workstreamTypeFromRun(run),
      status,
      density: status === 'completed' ? 'compact' : 'expanded',
      resultKind: result?.kind,
      sourceRequestRevisionId: this.revisionIdForBranch(branchId),
      startedAt: toIso(run.startedAt + 2),
      completedAt: run.finishedAt ? toIso(run.finishedAt) : undefined,
      processEvents: this.processEventsFromActionEvents(id, executionEvents),
      result,
    };
  }

  private buildAskWorkstream(
    sessionId: string,
    branchId: string,
    workstreamId: string,
    turn: AskTurn,
  ): TaskWorkstream {
    const assistant = turn.assistantMessages.slice(-1)[0];
    const pending = !assistant || isPendingConversationStatus(assistant.status);
    const failed = assistant?.status === 'error';
    const cancelled = assistant?.status === 'stopped';
    const status: TaskWorkstream['status'] = failed
      ? 'failed'
      : cancelled
        ? 'cancelled'
        : pending
          ? 'running'
          : 'completed';
    const result = askResultFromTurn(workstreamId, turn);
    const pendingEvent = pending
      ? [{
          kind: 'agent.text' as const,
          id: `agent-text-${assistant?.id ?? `${turn.turnId}-pending`}`,
          workstreamId,
          createdAt: toIso(assistant?.createdAt ?? turn.createdAt),
          text: assistant?.content.trim() || '正在生成回复。',
        }]
      : [];

    return {
      id: workstreamId,
      sessionId,
      branchId,
      type: 'ask',
      status,
      density: status === 'running' ? 'expanded' : 'compact',
      resultKind: result?.kind,
      startedAt: toIso(turn.createdAt),
      completedAt: status === 'running' ? undefined : toIso(turn.completedAt),
      processEvents: pendingEvent,
      result,
    };
  }

  private userRequestFromAskTurn(
    sessionId: string,
    branchId: string,
    workstreamId: string,
    turn: AskTurn,
  ): UserRequest {
    const requestId = `request-ask-${turn.turnId}`;
    const revisionId = `revision-ask-${turn.turnId}`;
    const prompt = turn.userMessage?.content.trim()
      || turn.messages.find((message) => message.role === 'user')?.content.trim()
      || 'Ask';

    return {
      id: requestId,
      sessionId,
      rootRevisionId: revisionId,
      activeRevisionId: revisionId,
      revisions: [
        {
          id: revisionId,
          requestId,
          branchId,
          prompt,
          createdAt: toIso(turn.userMessage?.createdAt ?? turn.createdAt),
          resultingWorkstreamIds: [workstreamId],
        },
      ],
    };
  }

  private processEventsFromActionEvents(workstreamId: string, events: ActionEvent[]): ProcessEvent[] {
    const processEvents: ProcessEvent[] = [];
    for (const event of events) {
      if (event.event_type === 'tool_execution') {
        const title = String(event.payload.tool_name || event.payload.toolName || 'Tool');
        processEvents.push({
          kind: 'tool',
          id: event.event_id,
          workstreamId,
          taskId: typeof event.payload.taskId === 'string' ? event.payload.taskId : undefined,
          createdAt: toIso(event.ts_ms),
          completedAt: event.status === 'sent' || event.status === 'entered' ? undefined : toIso(event.ts_ms + event.duration_ms),
          status: toolStatusFromEvent(event),
          title,
          summary: firstLine(event.payload.summary ?? event.payload.result ?? event.payload.error ?? event.payload.data, title),
          target: cleanText(event.payload.target ?? event.payload.eventId ?? event.payload.prompt_id),
          durationMs: event.duration_ms,
          inputRef: `input:${event.event_id}`,
          outputRef: `output:${event.event_id}`,
          artifactIds: Array.isArray(event.payload.artifacts) ? event.payload.artifacts.map(String) : [],
          rawTraceRef: `raw-${event.event_id}`,
          errorSummary: event.status === 'error' || event.status === 'fail' ? firstLine(event.payload.error ?? event.payload.message, '工具失败') : undefined,
        } satisfies ToolEvent);
        continue;
      }

      if (event.event_type === 'dispatch') {
        const label = String(event.payload.targetAgent || event.agent_id || 'Sub Agent');
        processEvents.push({
          kind: 'subagent',
          id: event.event_id,
          workstreamId,
          createdAt: toIso(event.ts_ms),
          completedAt: event.status === 'sent' ? undefined : toIso(event.ts_ms + event.duration_ms),
          status: toolStatusFromEvent(event),
          label,
          summary: firstLine(event.payload.objective, '子 agent 已接收任务。'),
          rawTraceRef: `raw-${event.event_id}`,
        } satisfies SubAgentEvent);
        continue;
      }

      if (event.event_type === 'agent_summary') {
        processEvents.push({
          kind: 'agent.text',
          id: event.event_id,
          workstreamId,
          createdAt: toIso(event.ts_ms),
          text: String(event.payload.summary || event.payload.content || ''),
        });
        continue;
      }

      if (event.event_type === 'blocker' || event.event_type === 'verification' || event.event_type === 'report_published') {
        processEvents.push({
          kind: 'agent.text',
          id: event.event_id,
          workstreamId,
          createdAt: toIso(event.ts_ms),
          text: firstLine(event.payload.summary ?? event.payload.reason ?? event.payload.verdict ?? event.payload, event.event_type),
        });
      }
    }
    return processEvents.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  }

  private agentTextFromConversation(
    workstreamId: string,
    runId: string,
    conversations: ConversationMessage[],
  ): AgentTextEvent[] {
    return conversations
      .filter((message) => message.runId === runId && message.role === 'assistant' && message.content.trim())
      .map((message) => ({
        kind: 'agent.text',
        id: `agent-text-${message.id}`,
        workstreamId,
        createdAt: toIso(message.createdAt),
        text: message.content,
      }));
  }

  private mapProgress(sessionId: string, runId: string, branchId: string, workstreamId: string): ProgressTask[] {
    return taskBoard.listTasks(sessionId, runId).map((task, index) => ({
      id: task.taskId,
      sessionId,
      workstreamId,
      branchId,
      title: task.title,
      status: progressStatusFromTask(task),
      order: index,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
      source: task.source === 'plan' ? 'plan' : 'runtime',
      linkedEventIds: task.evidenceRefs,
      blockerSummary: task.blockerRefs.join(', ') || undefined,
    }));
  }

  private mapArtifacts(
    sessionId: string,
    runId: string,
    branchId: string,
    workstreamId: string,
    runEvents: ActionEvent[],
  ): WorkstreamArtifactRecord[] {
    const registered = artifactStore.list(sessionId, runId).map<WorkstreamArtifactRecord>((record) => ({
      id: record.artifactId,
      sessionId,
      workstreamId,
      branchId,
      sourceEventId: record.evidenceIds[0],
      type: artifactTypeFromRecord(record),
      status: 'ready',
      displayName: record.title,
      taskTitle: record.taskId,
      path: record.filePath,
      rawRef: `artifact:${record.artifactId}`,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }));

    const reportEvents = runEvents.filter((event) => event.event_type === 'report_published');
    const reports = reportEvents.flatMap<WorkstreamArtifactRecord>((event) => {
      const records: WorkstreamArtifactRecord[] = [];
      for (const key of ['markdownPath', 'htmlPath', 'jsonPath']) {
        const value = event.payload[key];
        if (typeof value !== 'string' || !value.trim()) {
          continue;
        }
        records.push({
          id: `${event.event_id}-${key}`,
          sessionId,
          workstreamId,
          branchId,
          sourceEventId: event.event_id,
          type: key === 'htmlPath' ? 'visual_report' : 'report',
          status: 'ready',
          displayName: value.split(/[\\/]/).filter(Boolean).pop() || value,
          taskTitle: 'Execution Report',
          path: value,
          rawRef: `raw-${event.event_id}`,
          createdAt: toIso(event.ts_ms),
          updatedAt: toIso(event.ts_ms),
        });
      }
      return records;
    });

    return [...registered, ...reports];
  }

  private mapContext(
    sessionId: string,
    runId: string,
    branchId: string,
    workstreamId: string,
    run: RunSummary,
  ): WorkstreamContextRecord[] {
    const packets = contextService.listContextPackets(sessionId, runId);
    const captureContext = run.captures.map<WorkstreamContextRecord>((capture) => ({
      id: `context-capture-${capture.id}`,
      sessionId,
      workstreamId,
      branchId,
      kind: 'capture',
      label: capture.filePath.split(/[\\/]/).filter(Boolean).pop() || capture.filePath,
      summary: capture.filePath,
      importance: 'decisive',
      firstObservedAt: toIso(run.startedAt),
      lastObservedAt: toIso(run.finishedAt ?? run.startedAt),
      detailsRef: capture.filePath,
    }));

    const packetContext = packets.map<WorkstreamContextRecord>((packet) => ({
      id: `context-${packet.packetId}`,
      sessionId,
      workstreamId,
      branchId,
      kind: packet.kind === 'capture' ? 'capture' : packet.kind === 'tool_result' ? 'source' : 'file',
      label: packet.title,
      summary: packet.summary,
      importance: packet.evidenceIds.length > 0 ? 'cited' : packet.kind === 'plan' ? 'important' : 'normal',
      firstObservedAt: packet.createdAt,
      lastObservedAt: packet.createdAt,
      sourceEventIds: packet.evidenceIds,
      artifactIds: packet.artifactIds,
      detailsRef: packet.refs[0],
    }));

    const capabilityContext = contextService.readPlanContract(sessionId, runId)?.capabilityProfiles.map<WorkstreamContextRecord>((profile) => ({
      id: `context-capability-${profile.profileId}`,
      sessionId,
      workstreamId,
      branchId,
      kind: 'capability',
      label: profile.owner,
      summary: profile.toolNames.slice(0, 4).join(', '),
      importance: 'important',
      firstObservedAt: profile.createdAt,
      lastObservedAt: profile.updatedAt,
      detailsRef: profile.profileId,
    })) ?? [];

    return [...captureContext, ...packetContext, ...capabilityContext];
  }

  private toTaskViewModel(session: AgentWorkstreamSession, workstream: TaskWorkstream): TaskWorkstreamViewModel {
    const prompt = this.promptForWorkstream(session, workstream);
    const result = workstream.result
      ? {
          ...workstream.result,
          artifacts: session.artifacts.filter((artifact) => workstream.result?.artifactIds.includes(artifact.id)),
        }
      : undefined;

    return {
      kind: 'task_workstream',
      id: workstream.id,
      type: workstream.type,
      status: workstream.status,
      density: workstream.density,
      title: this.titleForWorkstream(workstream),
      startedAt: workstream.startedAt,
      completedAt: workstream.completedAt,
      prompt,
      process: {
        collapsed: workstream.status === 'completed' || workstream.density === 'compact',
        items: this.toProcessItems(workstream.processEvents),
      },
      result,
      planId: workstream.planId,
      planStatus: workstream.planStatus,
    };
  }

  private toProcessItems(events: ProcessEvent[]): ProcessTraceItemViewModel[] {
    const items: ProcessTraceItemViewModel[] = [];
    let textBuffer: AgentTextEvent[] = [];
    const flushText = () => {
      if (textBuffer.length === 0) {
        return;
      }
      const first = textBuffer[0];
      items.push({
        kind: 'agent_thinking',
        id: `thinking-${first.id}`,
        createdAt: first.createdAt,
        text: textBuffer.map((event) => event.text).filter(Boolean).join('\n\n'),
      });
      textBuffer = [];
    };

    for (const event of events) {
      if (event.kind === 'agent.text') {
        textBuffer.push(event);
        continue;
      }
      flushText();
      if (event.kind === 'tool') {
        items.push({
          kind: 'tool_row',
          id: event.id,
          createdAt: event.createdAt,
          completedAt: event.completedAt,
          status: event.status,
          title: event.title,
          summary: event.summary,
          target: event.target,
          durationMs: event.durationMs,
          taskId: event.taskId,
          artifactIds: event.artifactIds ?? [],
          rawTraceRef: event.rawTraceRef,
          inputRef: event.inputRef,
          outputRef: event.outputRef,
          errorSummary: event.errorSummary,
        });
        continue;
      }
      if (event.kind === 'subagent') {
        items.push({
          kind: 'subagent_row',
          id: event.id,
          createdAt: event.createdAt,
          completedAt: event.completedAt,
          status: event.status,
          label: event.label,
          summary: event.summary,
          resultSummary: event.resultSummary,
          taskId: event.taskId,
          nestedWorkstream: event.nestedWorkstream,
          rawTraceRef: event.rawTraceRef,
        });
      }
    }
    flushText();
    return items;
  }

  private buildRightPanel(session: AgentWorkstreamSession, activeWorkstreams: TaskWorkstream[]): RightPanelViewModel {
    const activeWorkstreamIds = new Set(activeWorkstreams.map((workstream) => workstream.id));
    const progress: ProgressPanelViewModel = {
      current: session.progress
        .filter((task) => activeWorkstreamIds.has(task.workstreamId) && ['running', 'blocked', 'pending', 'reopened'].includes(task.status))
        .sort((left, right) => left.order - right.order),
      history: session.progress
        .filter((task) => activeWorkstreamIds.has(task.workstreamId) && ['completed', 'cancelled'].includes(task.status))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    };
    const artifacts: ArtifactsPanelViewModel = {
      current: session.artifacts.filter((artifact) => activeWorkstreamIds.has(artifact.workstreamId)).slice(-6),
      previous: session.artifacts.filter((artifact) => !activeWorkstreamIds.has(artifact.workstreamId)),
    };
    const contextGroups: ContextPanelGroupViewModel[] = (['capture', 'file', 'source', 'capability'] as const).map((kind) => {
      const all = session.context.filter((record) => record.kind === kind);
      return {
        kind,
        important: all.filter((record) => record.importance !== 'normal'),
        all,
      };
    });

    return {
      progress,
      artifacts,
      context: { groups: contextGroups },
    };
  }

  private promptForWorkstream(session: AgentWorkstreamSession, workstream: TaskWorkstream): UserPromptBubbleViewModel | undefined {
    for (const request of session.userRequests) {
      const revision = request.revisions.find((entry) => entry.resultingWorkstreamIds.includes(workstream.id));
      if (!revision) {
        continue;
      }
      const group = session.branches.find((entry) => entry.rootRequestId === request.id);
      const branchIndex = Math.max(group?.branches.findIndex((branch) => branch.id === revision.branchId) ?? 0, 0);
      const branchCount = group?.branches.length ?? 1;
      return {
        kind: 'user_prompt',
        id: `prompt-${revision.id}`,
        branchId: revision.branchId,
        requestId: request.id,
        revisionId: revision.id,
        prompt: revision.prompt,
        createdAt: revision.createdAt,
        branchIndex,
        branchCount,
        canCopy: true,
        canEdit: true,
      };
    }
    return undefined;
  }

  private titleForWorkstream(workstream: TaskWorkstream): string {
    if (workstream.resultKind === 'plan') return 'Plan Task';
    if (workstream.resultKind === 'report') return 'Execution Task';
    if (workstream.resultKind === 'failure') return 'Failure Task';
    if (workstream.resultKind === 'cancelled') return 'Cancelled Task';
    return workstream.type === 'ask' ? 'Ask Task' : 'Agent Task';
  }

  private shouldShowExecutionWorkstream(run: RunSummary, approvalState: PlanApprovalState | undefined, events: ActionEvent[]): boolean {
    return approvalState === 'approved'
      || ['running', 'stopping', 'completed', 'failed', 'cancelled', 'interrupted'].includes(run.status)
      || events.some((event) => ['dispatch', 'agent_summary', 'verification', 'report_published'].includes(event.event_type));
  }

  private groupAskTurns(messages: ConversationMessage[]): AskTurn[] {
    const groups = new Map<string, AskTurn>();
    for (const message of messages) {
      const turnId = message.turnId || message.id;
      const group = groups.get(turnId) ?? {
        turnId,
        createdAt: message.createdAt,
        completedAt: message.updatedAt ?? message.createdAt,
        messages: [],
        assistantMessages: [],
      };
      group.createdAt = Math.min(group.createdAt, message.createdAt);
      group.completedAt = Math.max(group.completedAt, message.updatedAt ?? message.createdAt);
      group.messages.push(message);
      if (message.role === 'user' && (!group.userMessage || message.createdAt < group.userMessage.createdAt)) {
        group.userMessage = message;
      }
      if (message.role === 'assistant') {
        group.assistantMessages.push(message);
      }
      groups.set(turnId, group);
    }
    return Array.from(groups.values()).map((group) => ({
      ...group,
      messages: group.messages.slice().sort((left, right) => left.createdAt - right.createdAt),
      assistantMessages: group.assistantMessages.slice().sort((left, right) => left.createdAt - right.createdAt),
    })).sort((left, right) => left.createdAt - right.createdAt);
  }

  private branchIdForWorkstream(groups: RequestBranchGroup[], workstreamId: string, fallback: string): string {
    for (const group of groups) {
      const branch = group.branches.find((entry) => entry.workstreamIds.includes(workstreamId));
      if (branch) {
        return branch.id;
      }
    }
    return fallback || 'branch-main';
  }

  private revisionIdForBranch(branchId: string): string | undefined {
    return branchId.startsWith('branch-') ? branchId.replace(/^branch-/, 'revision-') : undefined;
  }

  private planWorkstreamId(runId: string): string {
    return `ws-${runId}-plan`;
  }

  private executionWorkstreamId(runId: string): string {
    return `ws-${runId}-execution`;
  }
}

export const agentWorkstreamProjector = new AgentWorkstreamProjector();
