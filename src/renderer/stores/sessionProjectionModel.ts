import type { AgentTimelineEntry } from '@shared/types/agent';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type { ContextSnapshot, OpenedCaptureState } from '@shared/types/session';
import type { ReasoningSummary, WorkflowState } from '@shared/types/workflow';
import { compareConversationMessages } from '@shared/conversation/conversationBranchResolver';
import {
  createEmptyContextUsageProjection,
  type ContextUsageProjectionState,
} from './contextUsageProjectionModel';

export interface SessionProjection {
  allMessages: ConversationMessage[];
  branchState: ConversationBranchState | null;
  timeline: AgentTimelineEntry[];
  reasoningSummaries: ReasoningSummary[];
  monotonicStoppedTurnIds: string[];
  monotonicStoppedRequestIds: string[];
  revokedRequestIds: string[];
  workflowState: WorkflowState | null;
  tracePresentation: AgentRunPresentation | null;
  contextSnapshot: ContextSnapshot | null;
  openedCapture: OpenedCaptureState | null;
  activeRunId: string | null;
  contextUsage: ContextUsageProjectionState;
  lastHydratedAt: number;
}

export const createEmptySessionProjection = (): SessionProjection => ({
  allMessages: [],
  branchState: null,
  timeline: [],
  reasoningSummaries: [],
  monotonicStoppedTurnIds: [],
  monotonicStoppedRequestIds: [],
  revokedRequestIds: [],
  workflowState: null,
  tracePresentation: null,
  contextSnapshot: null,
  openedCapture: null,
  activeRunId: null,
  contextUsage: createEmptyContextUsageProjection(),
  lastHydratedAt: 0,
});

export function updateProjectionMessages(
  messages: ConversationMessage[],
  next: ConversationMessage,
): ConversationMessage[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const existing = byId.get(next.id);
  const previousTime = existing?.updatedAt ?? existing?.createdAt ?? 0;
  const nextTime = next.updatedAt ?? next.createdAt;
  if (!existing || nextTime >= previousTime) byId.set(next.id, next);
  return Array.from(byId.values()).sort(compareConversationMessages);
}

export function updateSessionProjectionMap(
  bySessionId: Record<string, SessionProjection>,
  sessionId: string,
  update: (projection: SessionProjection) => SessionProjection,
): Record<string, SessionProjection> {
  const current = bySessionId[sessionId] ?? createEmptySessionProjection();
  return {
    ...bySessionId,
    [sessionId]: { ...update(current), lastHydratedAt: Date.now() },
  };
}
