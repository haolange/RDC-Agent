import type { ActionEvent } from '@shared/types/evidence';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ArtifactRecord, HarnessTask } from '@shared/types/harness';
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
import { taskBoard } from '../workflow/debugger/TaskBoard';
import { traceStateStore } from '../workflow/debugger/TraceStateStore';
import { appPathService } from '../runtime/AppPathService';
import path from 'path';
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

const firstLine = (value: unknown, fallback: string): string => {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  return text.trim().split(/\r?\n/)[0]?.trim() || fallback;
};

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

const progressStatusFromTask = (task: HarnessTask): ProgressTaskStatus => {
  if (task.status === 'in_progress') return 'running';
  if (task.status === 'completed') return 'completed';
  if (task.status === 'blocked' || task.status === 'rejected') return 'blocked';
  if (task.status === 'cancelled') return 'cancelled';
  return 'pending';
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
    this.traceRoot = path.join(appPathService.getWorkspaceRoot(), '.rdc-agent', 'trace');
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
    const progress: ProgressTask[] = [];
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
        const thoughtId = `thought-${msg.id}`;
        if (msg.content.trim() && !existingNodeIds.has(thoughtId)) {
          this.emitter.emitThoughtFromText(runId, msg.content, thoughtId);
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
          this.emitter.emitThoughtFromText(runId, String(event.payload.summary || event.payload.content || ''));
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
      progress.push(...this.mapProgress(sessionId, runId, branchId, traceExecutionId));
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
        const thoughtId = `thought-${msg.id}`;
        if (msg.content.trim() && !existingAskNodeIds.has(thoughtId)) {
          this.emitter.emitThoughtFromText(runId, msg.content, thoughtId);
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

    const rightPanel = this.buildRightPanel(progress, artifacts, context, runViewModels);

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
    events: ActionEvent[],
    conversations: ConversationMessage[],
    runId: string,
  ): string | null {
    if (run.status === 'awaiting_approval') {
      return null;
    }
    if (run.status === 'completed') {
      const report = events.find((e) => e.event_type === 'report_published');
      if (report) return firstLine(report.payload.summary, '调试执行已完成，报告已生成。');
      const assistant = conversations.filter((m) => m.runId === runId && m.role === 'assistant').slice(-1)[0];
      if (assistant?.content.trim()) return assistant.content;
      return '调试执行已完成。';
    }
    if (run.status === 'failed' || run.status === 'interrupted') {
      return '执行失败，请查看错误详情与 raw trace。';
    }
    if (run.status === 'cancelled') return '任务已取消。';
    return null;
  }

  private mapProgress(sessionId: string, runId: string, branchId: string, traceLaneId: string): ProgressTask[] {
    return taskBoard.listTasks(sessionId, runId).map((task, index) => ({
      id: task.taskId,
      sessionId,
      traceLaneId,
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
    runs: AgentRunViewModel[],
  ): RightPanelViewModel {
    const activeRunIds = new Set(runs.filter((r) => r.run.status === 'running' || r.run.status === 'waiting_approval').map((r) => r.run.runId));
    const activeTraceLaneIds = new Set([...activeRunIds].flatMap((id) => [`ws-${id}-plan`, `ws-${id}-execution`, id]));

    return {
      progress: {
        current: progress.filter((t) => activeTraceLaneIds.has(t.traceLaneId) && ['running', 'blocked', 'pending', 'reopened'].includes(t.status)),
        history: progress.filter((t) => ['completed', 'cancelled'].includes(t.status)),
      },
      artifacts: {
        current: artifacts.slice(-6),
        previous: artifacts.slice(0, Math.max(0, artifacts.length - 6)),
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
