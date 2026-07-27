import type { AgentTimelineEntry } from '@shared/types/agent';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type { ReasoningSummary } from '@shared/types/workflow';
import { compareConversationMessages, resolveVisibleConversationMessages } from '@shared/conversation/conversationBranchResolver';

const TERMINAL_ASSISTANT_STATUSES = new Set<ConversationMessage['status']>([
  'complete',
  'error',
  'stopped',
]);

export const ACTIVE_ASSISTANT_STATUSES = new Set<ConversationMessage['status']>([
  'draft',
  'streaming',
]);

export const sortConversationMessages = (messages: ConversationMessage[]): ConversationMessage[] =>
  messages.slice().sort(compareConversationMessages);

export const projectVisibleMessages = (
  allMessages: ConversationMessage[],
  branchState: ConversationBranchState | null,
): ConversationMessage[] => resolveVisibleConversationMessages(allMessages, branchState);

/** True when a late streaming/draft patch must not reopen a monotonically stopped turn. */
export function shouldRejectActivePatchForMonotonicStop(
  next: ConversationMessage,
  monotonicStoppedTurnIds: ReadonlySet<string>,
  monotonicStoppedRequestIds: ReadonlySet<string> = new Set(),
): boolean {
  const turnStopped = monotonicStoppedTurnIds.has(next.turnId);
  const requestStopped = Boolean(next.requestId && monotonicStoppedRequestIds.has(next.requestId));
  if (!turnStopped && !requestStopped) return false;
  if (next.role !== 'assistant') return false;
  if (TERMINAL_ASSISTANT_STATUSES.has(next.status)) return false;
  return ACTIVE_ASSISTANT_STATUSES.has(next.status);
}

export const mergeConversationMessages = (
  currentMessages: ConversationMessage[],
  nextMessages: ConversationMessage[],
  monotonicStoppedTurnIds: ReadonlySet<string> = new Set(),
  monotonicStoppedRequestIds: ReadonlySet<string> = new Set(),
): ConversationMessage[] => {
  const byId = new Map(currentMessages.map((message) => [message.id, message]));
  for (const message of nextMessages) {
    const existing = byId.get(message.id);
    if (shouldRejectActivePatchForMonotonicStop(message, monotonicStoppedTurnIds, monotonicStoppedRequestIds)) {
      continue;
    }
    const existingUpdatedAt = existing?.updatedAt ?? existing?.createdAt ?? 0;
    const nextUpdatedAt = message.updatedAt ?? message.createdAt;
    if (!existing || nextUpdatedAt >= existingUpdatedAt) byId.set(message.id, message);
  }
  return sortConversationMessages(Array.from(byId.values()));
};

export interface ConversationState {
  allConversationMessages: ConversationMessage[];
  conversationMessages: ConversationMessage[];
  branchState: ConversationBranchState | null;
  timeline: AgentTimelineEntry[];
  reasoningSummaries: ReasoningSummary[];
  monotonicStoppedTurnIds: string[];
  monotonicStoppedRequestIds: string[];
  revokedRequestIds: string[];
  setConversationMessages: (messages: ConversationMessage[]) => void;
  setBranchState: (branchState: ConversationBranchState | null) => void;
  setConversationSnapshot: (messages: ConversationMessage[], branchState?: ConversationBranchState | null) => void;
  addConversationMessage: (message: ConversationMessage) => void;
  upsertConversationMessage: (message: ConversationMessage) => void;
  upsertConversationMessages: (messages: ConversationMessage[]) => void;
  patchAssistantMessageByTurnId: (turnId: string, patch: Partial<ConversationMessage>) => void;
  updateAssistantMessageByTurnId: (turnId: string, updater: (message: ConversationMessage) => ConversationMessage) => void;
  markTurnMonotonicallyStopped: (turnId: string) => void;
  markRequestMonotonicallyStopped: (requestId: string) => void;
  migrateMonotonicStoppedTurn: (fromTurnId: string, toTurnId: string) => void;
  markRequestRevoked: (requestId: string) => void;
  consumeRevokedRequest: (requestId: string) => boolean;
  addTimelineEntry: (entry: AgentTimelineEntry) => void;
  setTimeline: (timeline: AgentTimelineEntry[]) => void;
  setReasoningSummaries: (summaries: ReasoningSummary[]) => void;
  reset: () => void;
}

export const initialConversationState = {
  allConversationMessages: [] as ConversationMessage[],
  conversationMessages: [] as ConversationMessage[],
  branchState: null as ConversationBranchState | null,
  timeline: [] as AgentTimelineEntry[],
  reasoningSummaries: [] as ReasoningSummary[],
  monotonicStoppedTurnIds: [] as string[],
  monotonicStoppedRequestIds: [] as string[],
  revokedRequestIds: [] as string[],
};