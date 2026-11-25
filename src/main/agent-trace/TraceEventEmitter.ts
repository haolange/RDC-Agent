import { z } from 'zod';
import { generateEventId, nowIso } from '@shared/utils/id';
import { toolManifestRegistry } from './manifests/ToolManifestRegistry';
import { toolResultNormalizer } from './ToolResultNormalizer';
import type { ActionEvent } from '@shared/types/evidence';
import type { TraceStatus } from '@shared/types/agenticTrace';
import type { TraceEvent } from './TraceEventStore';
import type { ObservationNode } from './traceNodes';
import type { TaskFrameNode, ThoughtSummaryNode, ToolActionNode, SubAgentNode, FinalResponseNode } from './traceNodes';
import type { ThinkingArtifact } from '@shared/types/reasoning';
import type { TraceEventStore } from './TraceEventStore';
import type { EvidenceRef } from './traceNodes';
import type { ReasoningConfidence } from './traceNodes';
import type { VisibleReasoningMode } from './traceNodes';

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

/** The packet fields this emitter reads; a model may add others. */
const VisibleReasoningPacketSchema = z.object({
  mode: z.enum(['task_understanding', 'planning', 'intent', 'hypothesis', 'evidence_need', 'observation_summary',
    'decision_update', 'next_action', 'risk_note', 'summary']),
  content: z.string().min(1),
  hypothesis: z.string().optional(),
  nextAction: z.string().optional(),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
}).passthrough();

/** Model thinking text that is a structured packet; any other text is shown as written. */
const parseReasoningPacket = (text: string): Pick<VisibleReasoningPacket, 'mode' | 'content' | 'hypothesis' | 'nextAction' | 'confidence'> | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const packet = VisibleReasoningPacketSchema.safeParse(value);
  return packet.success ? packet.data : null;
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

  emitThinkingArtifact(runId: string, thinking: ThinkingArtifact, nodeId?: string): TraceEvent | null {
    if (thinking.visibility === 'hidden') return null;
    const trimmed = thinking.text?.trim() ?? '';
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

}

export interface VisibleReasoningPacket {
  mode: VisibleReasoningMode;
  title?: string;
  content: string;
  hypothesis?: string;
  evidenceRefs?: EvidenceRef[];
  nextAction?: string;
  confidence?: ReasoningConfidence;
}
