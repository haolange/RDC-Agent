import type { ActionEvent } from '@shared/types/evidence';
import type { ConversationMessage, ConversationWorkBlock } from '@shared/types/conversation';
import { DEFAULT_AGENT_ID } from '@shared/types/agent';
import type { RunSummary } from '@shared/types/session';
import type {
  AgentRun,
  AgentRunPresentation,
  AgentRunViewModel,
  TraceStatus,
} from '@shared/types/agenticTrace';
import type {
  PlanStatus,
  RawAuditRef,
  TraceSessionResult,
} from '@shared/types/trace';
import { nowIso } from '@shared/utils/id';
import { storageAdapter } from '../sessions/StorageAdapter';
import { traceStateStore } from '../workflow/debugger/TraceStateStore';
import { appPathService } from '../runtime/AppPathService';
import { TraceEventStore, TraceRunStore } from './TraceEventStore';
import { TraceEventEmitter } from './TraceEventEmitter';
import { traceTreeBuilder } from './TraceTreeBuilder';
import { projectionBuilder } from './ProjectionBuilder';
import { agentProfileRegistry } from './manifests/AgentProfileRegistry';
import { rightRailProjectionService } from './RightRailProjectionService';

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

interface HistoryTurn {
  turnId: string;
  createdAt: number;
  completedAt: number;
  messages: ConversationMessage[];
  userMessage?: ConversationMessage;
  assistantMessages: ConversationMessage[];
}

export function resolveHistoryTurnProfileId(turn: {
  userMessage?: Pick<ConversationMessage, 'profileId' | 'agentId'>;
  assistantMessages: Array<Pick<ConversationMessage, 'profileId' | 'agentId'>>;
}): string {
  const raw = turn.userMessage?.profileId
    ?? turn.assistantMessages.at(-1)?.profileId
    ?? turn.assistantMessages.at(-1)?.agentId
    ?? '';
  const id = typeof raw === 'string' ? raw.trim() : '';
  return id || DEFAULT_AGENT_ID;
}

export class TraceService {
  private stores: { run: TraceRunStore; events: TraceEventStore; emitter: TraceEventEmitter } | null = null;

  private getStores() {
    if (!this.stores) {
      const root = appPathService.getAppStatePaths().tracesPath;
      const events = new TraceEventStore(root);
      this.stores = { run: new TraceRunStore(root), events, emitter: new TraceEventEmitter(events) };
    }
    return this.stores;
  }

  private get runStore() { return this.getStores().run; }
  private get eventStore() { return this.getStores().events; }
  private get emitter() { return this.getStores().emitter; }

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
    const rawAuditRefs: RawAuditRef[] = events.slice(-20).map((event) => ({
      id: event.event_id,
      label: event.event_type,
      eventId: event.event_id,
      runId: event.run_id,
      sessionId,
      ref: `raw-${event.event_id}`,
    }));

    let profileId = 'general';

    for (const run of runs) {
      const runEvents = events.filter((e) => e.run_id === run.runId).sort((a, b) => a.ts_ms - b.ts_ms);
      const planStatus = mapRunPlanStatus(run);
      const agentType = run.profileId ?? 'general';
      profileId = agentType;
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
          startPhase('work');
          this.emitter.emitToolFromActionEvent(runId, event);
        } else if (event.event_type === 'dispatch') {
          completePhase('understand');
          startPhase('work');
          this.emitter.emitSubAgent(runId, event);
        } else if (event.event_type === 'agent_summary') {
          completePhase('understand');
          startPhase('work');
          // Agent summaries are workflow metadata, not provider thinking artifacts.
        }
        existingNodeIds.add(event.event_id);
      }
      const finalContent = this.finalContentForRun(run, runEvents, conversations, runId);
      if (finalContent && !existingNodeIds.has(`__final__:${runId}`)) {
        completePhase('understand');
        completePhase('work');
        startPhase('summarize');
        this.emitter.emitFinalResponse(runId, finalContent);
        completePhase('summarize');
        existingNodeIds.add(`__final__:${runId}`);
      }

      const traceEvents = this.eventStore.getEvents(runId);
      const nodes = traceTreeBuilder.build(traceEvents, profile);
      const timeline = projectionBuilder.build(agentRun, nodes, profile);

      runViewModels.push({ run: agentRun, timeline });

    }

    for (const turn of this.groupHistoryTurns(conversations)) {
      if (turn.messages.some((m) => m.runId)) continue;
      const runId = `history-${turn.turnId}`;
      const userPrompt = turn.userMessage?.content.trim() || 'Conversation';
      const assistant = turn.assistantMessages.slice(-1)[0];
      const status: TraceStatus = assistant?.status === 'error'
        ? 'failed'
        : assistant?.status === 'stopped'
          ? 'cancelled'
          : !assistant || assistant.status === 'streaming' || assistant.status === 'draft'
            ? 'running'
            : 'succeeded';

      const profileId = resolveHistoryTurnProfileId(turn);
      let agentRun = this.runStore.get(runId) ?? {
        runId,
        agentType: profileId,
        userRequest: userPrompt,
        status,
        createdAt: toIso(turn.createdAt),
        updatedAt: toIso(turn.completedAt),
      };
      agentRun.status = status;
      this.runStore.save(agentRun);

      const existingHistoryEvents = this.eventStore.getEvents(runId);
      const existingHistoryNodeIds = new Set(
        existingHistoryEvents.flatMap((traceEvent) => {
          const ids: string[] = [];
          if (traceEvent.type === 'run.completed') ids.push(`__final__:${runId}`);
          const payloadId = (traceEvent.payload as { id?: string })?.id;
          if (payloadId) ids.push(payloadId);
          return ids;
        }),
      );
      const hasHistoryTaskFrame = existingHistoryEvents.some(
        (traceEvent) => (traceEvent.payload as { kind?: string })?.kind === 'task_frame',
      );
      if (!hasHistoryTaskFrame) {
        this.emitter.emitTaskFrame(runId, userPrompt);
      }
      for (const msg of turn.assistantMessages) {
        for (const item of collectExplicitThinking(msg.workTrace?.blocks)) {
          const thoughtId = `thought-${msg.id}-${item.blockId}`;
          if (existingHistoryNodeIds.has(thoughtId)) continue;
          this.emitter.emitThinkingArtifact(runId, item.thinking, thoughtId);
          existingHistoryNodeIds.add(thoughtId);
        }
      }
      if (
        assistant?.content.trim()
        && !existingHistoryNodeIds.has(`__final__:${runId}`)
        && status !== 'running'
      ) {
        this.emitter.emitFinalResponse(runId, assistant.content);
      }

      const profile = agentProfileRegistry.get(profileId);
      const nodes = traceTreeBuilder.build(this.eventStore.getEvents(runId), profile);
      runViewModels.push({
        run: agentRun,
        timeline: projectionBuilder.build(agentRun, nodes, profile),
      });
    }

    const projectId = storageAdapter.readSession(sessionId)?.projectId;
    if (!projectId) {
      throw new Error('Trace projection requires an owned project/session scope.');
    }

    const branchId = state.activeBranchId || 'branch-main';
    const rightPanel = await rightRailProjectionService.build({
      sessionId,
      branchId,
      runs,
      events,
      profileId,
    });

    return {
      projectId,
      sessionId,
      activeBranchId: state.activeBranchId || 'branch-main',
      profileId,
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

  private groupHistoryTurns(messages: ConversationMessage[]): HistoryTurn[] {
    const groups = new Map<string, HistoryTurn>();
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
