import fs from 'fs';
import path from 'path';
import type { ActionEvent } from '@shared/types/evidence';
import type { ConversationMessage, ConversationWorkBlock } from '@shared/types/conversation';
import type { ArtifactRecord } from '@shared/types/harness';
import type { RunSummary, AppMode } from '@shared/types/session';
import type {
  AgentRun,
  AgentRunPresentation,
  AgentRunViewModel,
  TraceStatus,
} from '@shared/types/agenticTrace';
import type {
  PlanStatus,
  ProgressTask,
  ProgressTaskStatus,
  RightPanelViewModel,
  TraceArtifactRecord,
  TraceContextRecord,
  RawAuditRef,
  TraceSessionResult,
} from '@shared/types/trace';
import { nowIso } from '@shared/utils/id';
import { storageAdapter } from '../sessions/StorageAdapter';
import { artifactStore } from '../reports/ArtifactStore';
import { contextService } from '../captures/ContextService';
import { createSessionTaskStore } from '../agent-runtime/tasks/sessionTaskStore';
import type { TaskRecord } from '../agent-runtime/tasks/TaskRegistry';
import { traceStateStore } from '../workflow/debugger/TraceStateStore';
import { appPathService } from '../runtime/AppPathService';
import { TraceEventStore, TraceRunStore } from './TraceEventStore';
import { TraceEventEmitter } from './TraceEventEmitter';
import { traceTreeBuilder } from './TraceTreeBuilder';
import { projectionBuilder } from './ProjectionBuilder';
import { agentProfileRegistry } from './manifests/AgentProfileRegistry';

const toIso = (value: number | string | undefined, fallback = nowIso()): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return fallback;
};

const collectExplicitThinking = (
  blocks: ConversationWorkBlock[] | undefined,
): Array<{ blockId: string; thinking: NonNullable<ConversationWorkBlock['thinking']> }> => {
  const collected: Array<{ blockId: string; thinking: NonNullable<ConversationWorkBlock['thinking']> }> = [];
  const visit = (items: ConversationWorkBlock[] | undefined) => {
    for (const block of items ?? []) {
      if (block.thinking) collected.push({ blockId: block.id, thinking: block.thinking });
      visit(block.children);
    }
  };
  visit(blocks);
  return collected;
};

export function findCanonicalFinalAnswer(
  conversations: ConversationMessage[],
  runId: string,
): string | null {
  let finalAnswer: string | null = null;
  const visit = (blocks: ConversationWorkBlock[] | undefined) => {
    for (const block of blocks ?? []) {
      const resultText = block.result?.text?.trim();
      if (block.result?.outputPhase === 'final_answer' && resultText) {
        finalAnswer = resultText;
      }
      visit(block.children);
    }
  };
  for (const message of conversations) {
    if (message.runId !== runId || message.role !== 'assistant') continue;
    visit(message.workTrace?.blocks);
  }
  return finalAnswer;
}
const runStatusFromSummary = (run: RunSummary, planStatus?: PlanStatus): TraceStatus => {
  if (planStatus === 'awaiting_approval' || run.status === 'awaiting_approval') return 'waiting_approval';
  if (run.status === 'failed' || run.status === 'interrupted') return 'failed';
  if (run.status === 'cancelled') return 'cancelled';
  if (run.status === 'completed') return 'succeeded';
  return 'running';
};

const mapRunPlanStatus = (run: RunSummary): PlanStatus => {
  if (run.status === 'failed' || run.status === 'interrupted') return 'failed';
  if (run.status === 'completed') return 'executed';
  if (run.status === 'awaiting_approval') return 'awaiting_approval';
  return 'accepted';
};

const artifactTypeFromRecord = (record: ArtifactRecord): TraceArtifactRecord['type'] => {
  if (record.kind === 'report') return 'report';
  if (record.kind === 'screenshot') return 'visual_report';
  if (record.kind === 'trace' || record.kind === 'data') return 'evidence_bundle';
  return 'other';
};

interface AskTurn {
  turnId: string;
  createdAt: number;
  completedAt: number;
  messages: ConversationMessage[];
  userMessage?: ConversationMessage;
  assistantMessages: ConversationMessage[];
}

export class TraceService {
  private traceRoot: string;
  private runStore: TraceRunStore;
  private eventStore: TraceEventStore;
  private emitter: TraceEventEmitter;

  constructor() {
    this.traceRoot = appPathService.getAppStatePaths().tracesPath;
    this.runStore = new TraceRunStore(this.traceRoot);
    this.eventStore = new TraceEventStore(this.traceRoot);
    this.emitter = new TraceEventEmitter(this.eventStore);
  }

  getRun(runId: string): AgentRun | null {
    return this.runStore.get(runId);
  }

  getEvents(runId: string, afterSeq = 0) {
    return this.eventStore.getEvents(runId, afterSeq);
  }

  exportRun(runId: string) {
    return this.eventStore.exportRun(runId);
  }

  async getSession(sessionId: string): Promise<TraceSessionResult> {
    try {
      const session = storageAdapter.readSession(sessionId);
      if (!session) {
        return { success: false, error: `Session not found: ${sessionId}` };
      }
      const presentation = await this.buildPresentation(sessionId);
      return { success: true, presentation };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async buildPresentation(sessionId: string): Promise<AgentRunPresentation> {
    const state = traceStateStore.read(sessionId);
    const conversations = storageAdapter.readConversationHistory(sessionId);
    const events = await storageAdapter.readActionChain(sessionId);
    return this.buildPresentationFromData(
      sessionId,
      storageAdapter.listRuns(sessionId),
      conversations,
      events,
      state,
    );
  }

  private async buildPresentationFromData(
    sessionId: string,
    runs: RunSummary[],
    conversations: ConversationMessage[],
    events: ActionEvent[],
    state: ReturnType<typeof traceStateStore.read>,
  ): Promise<AgentRunPresentation> {
    const runViewModels: AgentRunViewModel[] = [];
    const artifacts: TraceArtifactRecord[] = [];
    const context: TraceContextRecord[] = [];
    const rawAuditRefs: RawAuditRef[] = events.slice(-20).map((event) => ({
      id: event.event_id,
      label: event.event_type,
      eventId: event.event_id,
      runId: event.run_id,
      sessionId,
      ref: `raw-${event.event_id}`,
    }));

    let mode: AppMode = 'ask';

    for (const run of runs) {
      const runEvents = events.filter((e) => e.run_id === run.runId).sort((a, b) => a.ts_ms - b.ts_ms);
      const planStatus = mapRunPlanStatus(run);
      const branchId = state.activeBranchId || 'branch-main';
      const agentType = run.mode ?? 'debugger';
      mode = agentType;
      const profile = agentProfileRegistry.getForMode(agentType);

      const userPrompt = this.userPromptForRun(conversations, run.runId)
        || runEvents.find((e) => e.event_type === 'user_message')?.payload?.content as string
        || '调试任务';

      const runId = run.runId;
      let agentRun = this.runStore.get(runId);
      if (!agentRun) {
        agentRun = {
          runId,
          agentType,
          userRequest: String(userPrompt),
          status: runStatusFromSummary(run, planStatus),
          createdAt: toIso(run.startedAt),
          updatedAt: toIso(run.finishedAt ?? run.startedAt),
        };
        this.runStore.save(agentRun);
      } else {
        agentRun.status = runStatusFromSummary(run, planStatus);
        agentRun.updatedAt = toIso(run.finishedAt ?? Date.now());
        this.runStore.save(agentRun);
      }

      const existingRunEvents = this.eventStore.getEvents(runId);
      const existingNodeIds = new Set(
        existingRunEvents.flatMap((traceEvent) => {
          const ids: string[] = [];
          if (traceEvent.type === 'run.completed') ids.push(`__final__:${runId}`);
          const payloadId = (traceEvent.payload as { id?: string })?.id;
          if (payloadId) ids.push(payloadId);
          return ids;
        }),
      );
      const existingPhaseStarts = new Set(
        existingRunEvents
          .filter((traceEvent) => traceEvent.type === 'phase.started')
          .map((traceEvent) => (traceEvent.payload as { phaseId?: string }).phaseId)
          .filter((phaseId): phaseId is string => Boolean(phaseId)),
      );
      const existingPhaseCompletions = new Set(
        existingRunEvents
          .filter((traceEvent) => traceEvent.type === 'phase.completed')
          .map((traceEvent) => (traceEvent.payload as { phaseId?: string }).phaseId)
          .filter((phaseId): phaseId is string => Boolean(phaseId)),
      );
      const phaseTitle = (phaseId: string) => (
        profile.phases.find((phase) => phase.phaseId === phaseId)?.displayName ?? phaseId
      );
      const startPhase = (phaseId: string) => {
        if (existingPhaseStarts.has(phaseId)) return;
        this.emitter.emitPhaseStarted(runId, phaseId, phaseTitle(phaseId));
        existingPhaseStarts.add(phaseId);
      };
      const completePhase = (phaseId: string) => {
        if (!existingPhaseStarts.has(phaseId) || existingPhaseCompletions.has(phaseId)) return;
        this.emitter.emitPhaseCompleted(runId, phaseId);
        existingPhaseCompletions.add(phaseId);
      };
      const hasTaskFrame = existingRunEvents.some(
        (traceEvent) => (traceEvent.payload as { kind?: string })?.kind === 'task_frame',
      );
      if (!hasTaskFrame) {
        this.emitter.emitTaskFrame(runId, String(userPrompt));
      }
      startPhase('understand');
      for (const msg of conversations.filter((m) => m.runId === runId && m.role === 'assistant')) {
        for (const item of collectExplicitThinking(msg.workTrace?.blocks)) {
          const thoughtId = `thought-${msg.id}-${item.blockId}`;
          if (existingNodeIds.has(thoughtId)) continue;
          this.emitter.emitThinkingArtifact(runId, item.thinking, thoughtId);
          existingNodeIds.add(thoughtId);
        }
      }
      for (const event of runEvents) {
        if (existingNodeIds.has(event.event_id)) continue;
        if (event.event_type === 'tool_execution') {
          completePhase('understand');
          completePhase('plan');
          startPhase('execute');
          this.emitter.emitToolFromActionEvent(runId, event);
        } else if (event.event_type === 'dispatch') {
          completePhase('understand');
          completePhase('plan');
          startPhase('execute');
          this.emitter.emitSubAgent(runId, event);
        } else if (event.event_type === 'agent_summary') {
          completePhase('understand');
          completePhase('plan');
          startPhase('execute');
          // Agent summaries are workflow metadata, not provider thinking artifacts.
        }
        existingNodeIds.add(event.event_id);
      }
      const finalContent = this.finalContentForRun(run, runEvents, conversations, runId);
      if (finalContent && !existingNodeIds.has(`__final__:${runId}`)) {
        completePhase('understand');
        completePhase('plan');
        completePhase('execute');
        startPhase('summarize');
        this.emitter.emitFinalResponse(runId, finalContent);
        completePhase('summarize');
        existingNodeIds.add(`__final__:${runId}`);
      }

      const traceEvents = this.eventStore.getEvents(runId);
      const nodes = traceTreeBuilder.build(traceEvents, profile);
      const timeline = projectionBuilder.build(agentRun, nodes, profile);

      runViewModels.push({ run: agentRun, timeline });

      const traceExecutionId = `ws-${runId}-execution`;
      artifacts.push(...this.mapArtifacts(sessionId, runId, branchId, traceExecutionId, runEvents));
      context.push(...this.mapContext(sessionId, runId, branchId, traceExecutionId, run));
    }

    for (const turn of this.groupAskTurns(conversations)) {
      if (turn.messages.some((m) => m.runId)) continue;
      const runId = `ask-${turn.turnId}`;
      const userPrompt = turn.userMessage?.content.trim() || 'Ask';
      const assistant = turn.assistantMessages.slice(-1)[0];
      const status: TraceStatus = assistant?.status === 'error'
        ? 'failed'
        : assistant?.status === 'stopped'
          ? 'cancelled'
          : !assistant || assistant.status === 'streaming' || assistant.status === 'draft'
            ? 'running'
            : 'succeeded';

      let agentRun = this.runStore.get(runId) ?? {
        runId,
        agentType: 'ask',
        userRequest: userPrompt,
        status,
        createdAt: toIso(turn.createdAt),
        updatedAt: toIso(turn.completedAt),
      };
      agentRun.status = status;
      this.runStore.save(agentRun);

      const existingAskEvents = this.eventStore.getEvents(runId);
      const existingAskNodeIds = new Set(
        existingAskEvents.flatMap((traceEvent) => {
          const ids: string[] = [];
          if (traceEvent.type === 'run.completed') ids.push(`__final__:${runId}`);
          const payloadId = (traceEvent.payload as { id?: string })?.id;
          if (payloadId) ids.push(payloadId);
          return ids;
        }),
      );
      const hasAskTaskFrame = existingAskEvents.some(
        (traceEvent) => (traceEvent.payload as { kind?: string })?.kind === 'task_frame',
      );
      if (!hasAskTaskFrame) {
        this.emitter.emitTaskFrame(runId, userPrompt);
      }
      for (const msg of turn.assistantMessages) {
        for (const item of collectExplicitThinking(msg.workTrace?.blocks)) {
          const thoughtId = `thought-${msg.id}-${item.blockId}`;
          if (existingAskNodeIds.has(thoughtId)) continue;
          this.emitter.emitThinkingArtifact(runId, item.thinking, thoughtId);
          existingAskNodeIds.add(thoughtId);
        }
      }
      if (
        assistant?.content.trim()
        && !existingAskNodeIds.has(`__final__:${runId}`)
        && status !== 'running'
      ) {
        this.emitter.emitFinalResponse(runId, assistant.content);
      }

      const profile = agentProfileRegistry.get('ask');
      const nodes = traceTreeBuilder.build(this.eventStore.getEvents(runId), profile);
      runViewModels.push({
        run: agentRun,
        timeline: projectionBuilder.build(agentRun, nodes, profile),
      });
    }

    const branchId = state.activeBranchId || 'branch-main';
    const sessionPlan = this.mapSessionPlanArtifact(sessionId, branchId, `ws-${sessionId}-plan`);
    if (sessionPlan && !artifacts.some((item) => item.type === 'plan' && item.path === sessionPlan.path)) {
      artifacts.unshift(sessionPlan);
    }

    const progress = await this.mapSessionProgress(sessionId, branchId);
    const rightPanel = this.buildRightPanel(progress, artifacts, context);

    return {
      sessionId,
      activeBranchId: state.activeBranchId || 'branch-main',
      mode,
      runs: runViewModels.sort((a, b) => Date.parse(a.run.createdAt) - Date.parse(b.run.createdAt)),
      rightPanel,
      branchNavigator: null,
      rawAuditRefs,
      updatedAt: nowIso(),
    };
  }

  async buildConversationPresentation(
    sessionId: string,
    conversations: ConversationMessage[],
  ): Promise<AgentRunPresentation> {
    const state = storageAdapter.readSession(sessionId)
      ? traceStateStore.read(sessionId)
      : {
          schemaVersion: '1' as const,
          sessionId,
          activeBranchId: 'branch-main',
          userRequests: [],
          branches: [],
          plans: [],
          updatedAt: nowIso(),
        };
    const events: ActionEvent[] = [];
    return this.buildPresentationFromData(sessionId, [], conversations, events, state);
  }

  private userPromptForRun(conversations: ConversationMessage[], runId: string): string | undefined {
    const userMsg = conversations.find((m) => m.runId === runId && m.role === 'user');
    return userMsg?.content.trim();
  }

  private finalContentForRun(
    run: RunSummary,
    _events: ActionEvent[],
    conversations: ConversationMessage[],
    runId: string,
  ): string | null {
    if (run.status !== 'completed') return null;
    return findCanonicalFinalAnswer(conversations, runId);

  }

  /**
   * 会话级进度投影：读取当前会话的 TaskRegistry 任务（`${userData}/state/tasks/{sessionId}`），
   * 映射为「进度」泳道所需的 ProgressTask。按创建时间排序生成计划序号；`pending` 且存在
   * 未完成的上游依赖时判定为 `blocked`；`deleted` 任务不进入投影。
   */
  private async mapSessionProgress(sessionId: string, branchId: string): Promise<ProgressTask[]> {
    let records: TaskRecord[];
    try {
      records = await createSessionTaskStore(sessionId).listTasks();
    } catch {
      return [];
    }
    const active = records.filter((record) => record.status !== 'deleted');
    const byId = new Map(active.map((record) => [record.id, record] as const));
    const completedIds = new Set(
      active.filter((record) => record.status === 'completed').map((record) => record.id),
    );
    const ordered = [...active].sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    );
    return ordered.map((task, index) => {
      const unresolvedBlockers = task.blockedBy
        .map((id) => byId.get(id))
        .filter((blocker): blocker is TaskRecord => Boolean(blocker) && !completedIds.has(blocker!.id));
      const status: ProgressTaskStatus = task.status === 'completed'
        ? 'completed'
        : task.status === 'in_progress'
          ? 'running'
          : unresolvedBlockers.length > 0
            ? 'blocked'
            : 'pending';
      return {
        id: task.id,
        sessionId,
        traceLaneId: sessionId,
        branchId,
        title: task.subject,
        status,
        order: index,
        createdAt: new Date(task.createdAt).toISOString(),
        updatedAt: new Date(task.updatedAt).toISOString(),
        completedAt: task.status === 'completed' ? new Date(task.updatedAt).toISOString() : undefined,
        source: 'runtime',
        activeForm: task.activeForm,
        blockerSummary: unresolvedBlockers.length > 0
          ? unresolvedBlockers.map((blocker) => blocker.subject).join('、')
          : undefined,
      };
    });
  }

  /**
   * 读取会话级 plan.md（由 plan_artifact 工具写入），供右侧产物泳道做会话内 markdown 预览。
   */
  private mapSessionPlanArtifact(
    sessionId: string,
    branchId: string,
    traceLaneId: string,
  ): TraceArtifactRecord | null {
    try {
      const session = storageAdapter.readSession(sessionId);
      if (!session?.sessionPath) return null;
      const planPath = path.join(session.sessionPath, 'artifacts', 'plan.md');
      if (!fs.existsSync(planPath)) return null;
      const stat = fs.statSync(planPath);
      if (!stat.isFile()) return null;
      const previewMarkdown = fs.readFileSync(planPath, 'utf8');
      const updatedAt = toIso(stat.mtimeMs);
      return {
        id: `session-plan-${sessionId}`,
        sessionId,
        traceLaneId,
        branchId,
        type: 'plan',
        status: 'ready',
        displayName: 'plan.md',
        path: planPath,
        rawRef: `session-plan:${sessionId}`,
        previewMarkdown,
        createdAt: toIso(stat.birthtimeMs || stat.mtimeMs),
        updatedAt,
      };
    } catch {
      return null;
    }
  }

  private mapArtifacts(
    sessionId: string,
    runId: string,
    branchId: string,
    traceLaneId: string,
    runEvents: ActionEvent[],
  ): TraceArtifactRecord[] {
    const registered = artifactStore.list(sessionId, runId).map<TraceArtifactRecord>((record) => ({
      id: record.artifactId,
      sessionId,
      traceLaneId,
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
    const reports = runEvents
      .filter((e) => e.event_type === 'report_published')
      .flatMap<TraceArtifactRecord>((event) => {
        const records: TraceArtifactRecord[] = [];
        for (const key of ['markdownPath', 'htmlPath', 'jsonPath']) {
          const value = event.payload[key];
          if (typeof value !== 'string' || !value.trim()) continue;
          records.push({
            id: `${event.event_id}-${key}`,
            sessionId,
            traceLaneId,
            branchId,
            sourceEventId: event.event_id,
            type: key === 'htmlPath' ? 'visual_report' : 'report',
            status: 'ready',
            displayName: value.split(/[\\/]/).filter(Boolean).pop() || value,
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
    traceLaneId: string,
    run: RunSummary,
  ): TraceContextRecord[] {
    const packets = contextService.listContextPackets(sessionId, runId);
    const captureContext = run.captures.map<TraceContextRecord>((capture) => ({
      id: `context-capture-${capture.id}`,
      sessionId,
      traceLaneId,
      branchId,
      kind: 'capture',
      label: capture.filePath.split(/[\\/]/).filter(Boolean).pop() || capture.filePath,
      summary: capture.filePath,
      importance: 'decisive',
      firstObservedAt: toIso(run.startedAt),
      lastObservedAt: toIso(run.finishedAt ?? run.startedAt),
      detailsRef: capture.filePath,
    }));
    const packetContext = packets.map<TraceContextRecord>((packet) => ({
      id: `context-${packet.packetId}`,
      sessionId,
      traceLaneId,
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
    return [...captureContext, ...packetContext];
  }

  private buildRightPanel(
    progress: ProgressTask[],
    artifacts: TraceArtifactRecord[],
    context: TraceContextRecord[],
  ): RightPanelViewModel {
    const planArtifacts = artifacts.filter((item) => item.type === 'plan');
    const otherArtifacts = artifacts.filter((item) => item.type !== 'plan');
    const recentOthers = otherArtifacts.slice(-6);
    const previousOthers = otherArtifacts.slice(0, Math.max(0, otherArtifacts.length - 6));
    return {
      progress: {
        current: progress.filter((t) => ['running', 'blocked', 'pending', 'reopened'].includes(t.status)),
        history: progress.filter((t) => ['completed', 'cancelled'].includes(t.status)),
      },
      artifacts: {
        current: [...planArtifacts, ...recentOthers],
        previous: previousOthers,
      },
      context: {
        groups: (['capture', 'file', 'source', 'capability'] as const).map((kind) => {
          const all = context.filter((r) => r.kind === kind);
          return { kind, important: all.filter((r) => r.importance !== 'normal'), all };
        }),
      },
    };
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
      if (message.role === 'assistant') group.assistantMessages.push(message);
      groups.set(turnId, group);
    }
    return Array.from(groups.values()).sort((a, b) => a.createdAt - b.createdAt);
  }
}

export const traceService = new TraceService();
