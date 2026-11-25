import { compareConversationMessages, resolveVisibleConversationMessages } from '@shared/conversation/conversationBranchResolver';
import type { AgentTimelineEntry } from '@shared/types/agent';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type { ReasoningSummary } from '@shared/types/workflow';

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

/** Optimistic placeholders (send and rewrite) carry the `optimistic-` id prefix until main answers the request. */
const isOptimisticMessage = (message: ConversationMessage): boolean => message.id.startsWith('optimistic-');
const requestRole = (message: ConversationMessage): string => `${message.requestId}\u0000${message.role}`;

/**
 * Main's message for a request replaces its optimistic placeholder, whichever arrives first (a stream event or the send
 * result), so the transcript never shows both and the row keeps its identity across the swap.
 */
const dropAnsweredOptimisticMessages = (messages: ConversationMessage[]): ConversationMessage[] => {
  if (!messages.some(isOptimisticMessage)) return messages;
  const answered = new Set(messages.filter((message) => message.requestId && !isOptimisticMessage(message)).map(requestRole));
  const kept = messages.filter((message) => !isOptimisticMessage(message) || !answered.has(requestRole(message)));
  return kept.length === messages.length ? messages : kept;
};

/** The active branch as the transcript shows it: a placeholder whose answer is visible already gives way to it. */
export const projectVisibleMessages = (
  allMessages: ConversationMessage[],
  branchState: ConversationBranchState | null,
): ConversationMessage[] => dropAnsweredOptimisticMessages(resolveVisibleConversationMessages(allMessages, branchState));

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
  latestMessageActivityAt: number;
  /** The session whose saved history is being read; the transcript shows a placeholder, not the empty home. */
  historyLoadingSessionId: string | null;
  /** The session whose history and trace this renderer last loaded from main (cleared on every switch). */
  surfaceSessionId: string | null;
  setHistoryLoadingSessionId: (sessionId: string | null) => void;
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
  latestMessageActivityAt: 0,
  historyLoadingSessionId: null as string | null,
  surfaceSessionId: null as string | null,
};