import type { AgentEvent } from '@shared/types/agentRuntime';
import type { ActionEvent } from '@shared/types/evidence';
import type {
  TraceEvent,
  TaskFrameNode,
  ThoughtSummaryNode,
  ToolActionNode,
  SubAgentNode,
  FinalResponseNode,
  ErrorNode,
  ObservationNode,
  PlanNode,
  TraceStatus,
  VisibleReasoningPacket,
} from '@shared/types/agenticTrace';
import type { ConversationMessage } from '@shared/types/conversation';
import type { DebugPlan } from '@shared/types/workflow';
import { generateEventId, nowIso } from '@shared/utils/id';
import { toolManifestRegistry } from './manifests/ToolManifestRegistry';
import { toolResultNormalizer } from './ToolResultNormalizer';
import type { TraceEventStore } from './TraceEventStore';

const toIso = (value: number | string | undefined, fallback = nowIso()): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return fallback;
};

const traceStatusFromAction = (event: ActionEvent): TraceStatus => {
  if (event.status === 'error' || event.status === 'fail' || event.status === 'timeout') return 'failed';
  if (event.status === 'sent' || event.status === 'entered') return 'running';
  if (event.status === 'blocked') return 'skipped';
  return 'succeeded';
};

const parseReasoningPacket = (text: string): VisibleReasoningPacket | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as VisibleReasoningPacket;
    if (parsed.content) return parsed;
  } catch {
    return null;
  }
  return null;
};

export class TraceEventEmitter {
  constructor(private store: TraceEventStore) {}

  emitPhaseStarted(runId: string, phaseId: string, title: string): TraceEvent {
    return this.store.append(runId, 'phase.started', { phaseId, title });
  }

  emitPhaseCompleted(runId: string, phaseId: string): TraceEvent {
    return this.store.append(runId, 'phase.completed', { phaseId });
  }

  emitTaskFrame(runId: string, userRequest: string, constraints?: string[]): TraceEvent {
    const node: TaskFrameNode = {
      id: generateEventId('task'),
      runId,
      kind: 'task_frame',
      title: '本次任务',
      userRequest,
      constraints,
      seq: 0,
      createdAt: nowIso(),
      visibility: 'user',
      status: 'succeeded',
    };
    return this.store.append(runId, 'node.created', node);
  }

  emitThoughtFromText(runId: string, text: string, nodeId?: string): TraceEvent | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const packet = parseReasoningPacket(trimmed);
    const node: ThoughtSummaryNode = {
      id: nodeId ?? generateEventId('thought'),
      runId,
      kind: 'thought_summary',
      mode: packet?.mode,
      intent: packet?.content ?? trimmed,
      rationale: packet?.hypothesis,
      nextAction: packet?.nextAction,
      confidence: packet?.confidence,
      seq: 0,
      createdAt: nowIso(),
      visibility: 'user',
      status: 'succeeded',
    };
    return this.store.append(runId, 'node.created', node);
  }

  emitToolFromActionEvent(runId: string, event: ActionEvent): TraceEvent {
    const toolName = String(event.payload.tool_name || event.payload.toolName || 'tool');
    const manifest = toolManifestRegistry.get(toolName);
    const normalized = toolResultNormalizer.fromActionEvent(event);
    const node: ToolActionNode = {
      id: event.event_id,
      runId,
      kind: 'tool_action',
      toolCallId: event.event_id,
      toolName,
      displayName: manifest.displayName,
      category: manifest.category,
      purpose: typeof event.payload.purpose === 'string' ? event.payload.purpose : undefined,
      inputPreview: typeof event.payload.target === 'string' ? event.payload.target : undefined,
      outputPreview: normalized.summary,
      preview: normalized.preview,
      rawInput: event.payload,
      rawOutput: normalized.raw,
      durationMs: event.duration_ms,
      status: traceStatusFromAction(event),
      seq: 0,
      createdAt: toIso(event.ts_ms),
      visibility: 'user',
    };
    const type = node.status === 'failed' ? 'tool.failed' : 'tool.completed';
    const traceEvent = this.store.append(runId, type, node);
    if (normalized.observations?.length) {
      for (const obs of normalized.observations) {
        this.store.append(runId, 'node.created', { ...obs, runId });
      }
    }
    return traceEvent;
  }

  emitSubAgent(runId: string, event: ActionEvent): TraceEvent {
    const node: SubAgentNode = {
      id: event.event_id,
      runId,
      kind: 'sub_agent',
      subRunId: String(event.payload.subRunId || event.event_id),
      agentName: String(event.payload.targetAgent || event.agent_id || 'Sub Agent'),
      title: String(event.payload.targetAgent || event.agent_id || '子 Agent'),
      inputSummary: typeof event.payload.objective === 'string' ? event.payload.objective : undefined,
      status: traceStatusFromAction(event),
      seq: 0,
      createdAt: toIso(event.ts_ms),
      visibility: 'user',
    };
    return this.store.append(runId, 'node.created', node);
  }

  emitPlan(runId: string, debugPlan: DebugPlan): TraceEvent {
    const node: PlanNode = {
      id: `plan-${debugPlan.planId}`,
      runId,
      kind: 'plan',
      title: debugPlan.presentation?.title || 'Debugger Plan',
      steps: (debugPlan.presentation?.sections ?? []).map((section, index) => ({
        id: section.id || `step-${index}`,
        title: section.title,
        description: section.body.join('\n'),
        status: 'pending' as TraceStatus,
      })),
      seq: 0,
      createdAt: debugPlan.createdAt,
      visibility: 'user',
      status: 'succeeded',
    };
    if (node.steps.length === 0) {
      node.steps = [
        { id: 'goal', title: '目标', description: debugPlan.userGoal, status: 'pending' },
        { id: 'scope', title: '执行路线', description: debugPlan.scope, status: 'pending' },
      ];
    }
    return this.store.append(runId, 'node.created', node);
  }

  emitFinalResponse(runId: string, content: string, format: 'markdown' | 'plain' = 'markdown'): TraceEvent {
    const node: FinalResponseNode = {
      id: generateEventId('final'),
      runId,
      kind: 'final_response',
      content,
      format,
      seq: 0,
      createdAt: nowIso(),
      visibility: 'user',
      status: 'succeeded',
    };
    return this.store.append(runId, 'run.completed', node);
  }

  emitObservation(runId: string, title: string, facts: ObservationNode['facts']): TraceEvent {
    const node: ObservationNode = {
      id: generateEventId('obs'),
      runId,
      kind: 'observation',
      title,
      facts,
      seq: 0,
      createdAt: nowIso(),
      visibility: 'user',
      status: 'succeeded',
    };
    return this.store.append(runId, 'node.created', node);
  }

  emitFromAgentEvent(runId: string, event: AgentEvent): TraceEvent | null {
    if (event.type === 'assistant.completed') {
      const payload = event.payload as { text?: string };
      return payload.text ? this.emitThoughtFromText(runId, payload.text) : null;
    }
    if (event.type === 'tool.completed') {
      const payload = event.payload as { toolName?: string; result?: { ok?: boolean; data?: unknown; error?: unknown } };
      if (!payload.toolName) return null;
      const manifest = toolManifestRegistry.get(payload.toolName);
      const node: ToolActionNode = {
        id: event.id,
        runId,
        kind: 'tool_action',
        toolCallId: event.id,
        toolName: payload.toolName,
        displayName: manifest.displayName,
        category: manifest.category,
        outputPreview: typeof payload.result?.data === 'string' ? payload.result.data.slice(0, 120) : undefined,
        status: payload.result?.ok === false ? 'failed' : 'succeeded',
        seq: 0,
        createdAt: toIso(event.timestamp),
        visibility: 'user',
      };
      return this.store.append(runId, 'tool.completed', node);
    }
    if (event.type === 'run.failed') {
      const payload = event.payload as { error?: string };
      const node: ErrorNode = {
        id: generateEventId('error'),
        runId,
        kind: 'error',
        title: '执行失败',
        message: payload.error || '未知错误',
        recoverable: true,
        seq: 0,
        createdAt: toIso(event.timestamp),
        visibility: 'user',
        status: 'failed',
      };
      return this.store.append(runId, 'run.failed', node);
    }
    return null;
  }

  synthesizeFromConversation(runId: string, messages: ConversationMessage[]): TraceEvent[] {
    const events: TraceEvent[] = [];
    for (const message of messages) {
      if (message.role === 'assistant' && message.content.trim()) {
        const evt = this.emitThoughtFromText(runId, message.content);
        if (evt) events.push(evt);
      }
    }
    return events;
  }
}
