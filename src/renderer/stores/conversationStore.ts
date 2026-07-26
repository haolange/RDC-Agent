import { create } from 'zustand';
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

const ACTIVE_ASSISTANT_STATUSES = new Set<ConversationMessage['status']>([
  'draft',
  'streaming',
]);

const sortConversationMessages = (messages: ConversationMessage[]): ConversationMessage[] =>
  messages.slice().sort(compareConversationMessages);

const projectVisibleMessages = (
  allMessages: ConversationMessage[],
  branchState: ConversationBranchState | null,
): ConversationMessage[] => (
  resolveVisibleConversationMessages(allMessages, branchState)
);

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

const mergeConversationMessages = (
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
    if (!existing || nextUpdatedAt >= existingUpdatedAt) {
      byId.set(message.id, message);
    }
  }
  return sortConversationMessages(Array.from(byId.values()));
};

interface ConversationState {
  /** Full merge of every known message id (may include inactive branch siblings). */
  allConversationMessages: ConversationMessage[];
  /** Active-branch projection used by the transcript UI. */
  conversationMessages: ConversationMessage[];
  branchState: ConversationBranchState | null;
  timeline: AgentTimelineEntry[];
  reasoningSummaries: ReasoningSummary[];
  /**
   * Turns the user stopped after commit/stream started. Late draft/streaming IPC
   * patches for these turnIds are discarded until reset.
   */
  monotonicStoppedTurnIds: string[];
  /** Request-scoped stop guard while optimistic ids are still in flight (committing). */
  monotonicStoppedRequestIds: string[];
  /** Request ids already clean-revoked during preparing; send catch must stay idempotent. */
  revokedRequestIds: string[];

  setConversationMessages: (messages: ConversationMessage[]) => void;
  setBranchState: (branchState: ConversationBranchState | null) => void;
  /** Atomically replace the message set and branch state (rewrite / history load). */
  setConversationSnapshot: (
    messages: ConversationMessage[],
    branchState?: ConversationBranchState | null,
  ) => void;
  addConversationMessage: (message: ConversationMessage) => void;
  upsertConversationMessage: (message: ConversationMessage) => void;
  upsertConversationMessages: (messages: ConversationMessage[]) => void;
  patchAssistantMessageByTurnId: (turnId: string, patch: Partial<ConversationMessage>) => void;
  updateAssistantMessageByTurnId: (
    turnId: string,
    updater: (message: ConversationMessage) => ConversationMessage
  ) => void;
  markTurnMonotonicallyStopped: (turnId: string) => void;
  markRequestMonotonicallyStopped: (requestId: string) => void;
  /** Migrate monotonic turn guard from optimistic id to committed turn id. */
  migrateMonotonicStoppedTurn: (fromTurnId: string, toTurnId: string) => void;
  markRequestRevoked: (requestId: string) => void;
  consumeRevokedRequest: (requestId: string) => boolean;
  addTimelineEntry: (entry: AgentTimelineEntry) => void;
  setTimeline: (timeline: AgentTimelineEntry[]) => void;
  setReasoningSummaries: (summaries: ReasoningSummary[]) => void;
  reset: () => void;
}

/** Visible branch messages — already sorted on the write side. */
export const selectOrderedConversationMessages = (
  state: ConversationState,
): ConversationMessage[] => state.conversationMessages;

export const selectConversationMessageCount = (state: ConversationState): number =>
  state.conversationMessages.length;

export const selectLatestMessageActivityAt = (state: ConversationState): number =>
  state.conversationMessages.reduce<number>((max, message) => {
    const candidate = message.updatedAt ?? message.createdAt;
    return candidate > max ? candidate : max;
  }, 0);

export const useConversationStore = create<ConversationState>((set, get) => ({
  allConversationMessages: [],
  conversationMessages: [],
  branchState: null,
  timeline: [],
  reasoningSummaries: [],
  monotonicStoppedTurnIds: [],
  monotonicStoppedRequestIds: [],
  revokedRequestIds: [],

  setConversationMessages: (messages) => set((state) => {
    const allConversationMessages = sortConversationMessages(messages);
    return {
      allConversationMessages,
      conversationMessages: projectVisibleMessages(allConversationMessages, state.branchState),
    };
  }),
  setBranchState: (branchState) => set((state) => ({
    branchState,
    conversationMessages: projectVisibleMessages(state.allConversationMessages, branchState),
  })),
  setConversationSnapshot: (messages, branchState) => set((state) => {
    const nextBranchState = branchState === undefined ? state.branchState : branchState;
    const allConversationMessages = sortConversationMessages(messages);
    return {
      allConversationMessages,
      branchState: nextBranchState,
      conversationMessages: projectVisibleMessages(allConversationMessages, nextBranchState),
    };
  }),
  addConversationMessage: (message) => set((state) => {
    const allConversationMessages = mergeConversationMessages(
      state.allConversationMessages,
      [message],
      new Set(state.monotonicStoppedTurnIds),
      new Set(state.monotonicStoppedRequestIds),
    );
    return {
      allConversationMessages,
      conversationMessages: projectVisibleMessages(allConversationMessages, state.branchState),
    };
  }),
  upsertConversationMessage: (message) => set((state) => {
    const allConversationMessages = mergeConversationMessages(
      state.allConversationMessages,
      [message],
      new Set(state.monotonicStoppedTurnIds),
      new Set(state.monotonicStoppedRequestIds),
    );
    return {
      allConversationMessages,
      conversationMessages: projectVisibleMessages(allConversationMessages, state.branchState),
    };
  }),
  upsertConversationMessages: (messages) => set((state) => {
    const allConversationMessages = mergeConversationMessages(
      state.allConversationMessages,
      messages,
      new Set(state.monotonicStoppedTurnIds),
      new Set(state.monotonicStoppedRequestIds),
    );
    return {
      allConversationMessages,
      conversationMessages: projectVisibleMessages(allConversationMessages, state.branchState),
    };
  }),
  patchAssistantMessageByTurnId: (turnId, patch) => set((state) => {
    const assistant = state.allConversationMessages.find(
      (message) => message.turnId === turnId && message.role === 'assistant',
    );
    const requestStopped = Boolean(
      assistant?.requestId && state.monotonicStoppedRequestIds.includes(assistant.requestId),
    );
    if (
      (state.monotonicStoppedTurnIds.includes(turnId) || requestStopped)
      && patch.status
      && ACTIVE_ASSISTANT_STATUSES.has(patch.status)
    ) {
      return {};
    }
    const allConversationMessages = sortConversationMessages(
      state.allConversationMessages.map((message) => (
        message.turnId === turnId && message.role === 'assistant'
          ? { ...message, ...patch, updatedAt: Date.now() }
          : message
      )),
    );
    return {
      allConversationMessages,
      conversationMessages: projectVisibleMessages(allConversationMessages, state.branchState),
    };
  }),
  updateAssistantMessageByTurnId: (turnId, updater) => set((state) => {
    const allConversationMessages = sortConversationMessages(
      state.allConversationMessages.map((message) => (
        message.turnId === turnId && message.role === 'assistant'
          ? updater(message)
          : message
      )),
    );
    return {
      allConversationMessages,
      conversationMessages: projectVisibleMessages(allConversationMessages, state.branchState),
    };
  }),
  markTurnMonotonicallyStopped: (turnId) => set((state) => (
    state.monotonicStoppedTurnIds.includes(turnId)
      ? {}
      : { monotonicStoppedTurnIds: [...state.monotonicStoppedTurnIds, turnId] }
  )),
  markRequestMonotonicallyStopped: (requestId) => set((state) => (
    state.monotonicStoppedRequestIds.includes(requestId)
      ? {}
      : { monotonicStoppedRequestIds: [...state.monotonicStoppedRequestIds, requestId] }
  )),
  migrateMonotonicStoppedTurn: (fromTurnId, toTurnId) => set((state) => {
    if (!state.monotonicStoppedTurnIds.includes(fromTurnId)) {
      return {};
    }
    const withoutFrom = state.monotonicStoppedTurnIds.filter((id) => id !== fromTurnId);
    if (withoutFrom.includes(toTurnId)) {
      return { monotonicStoppedTurnIds: withoutFrom };
    }
    return { monotonicStoppedTurnIds: [...withoutFrom, toTurnId] };
  }),
  markRequestRevoked: (requestId) => set((state) => (
    state.revokedRequestIds.includes(requestId)
      ? {}
      : { revokedRequestIds: [...state.revokedRequestIds, requestId] }
  )),
  consumeRevokedRequest: (requestId) => {
    const state = get();
    if (!state.revokedRequestIds.includes(requestId)) return false;
    set({
      revokedRequestIds: state.revokedRequestIds.filter((id) => id !== requestId),
    });
    return true;
  },
  addTimelineEntry: (entry) => set((state) => ({ timeline: [...state.timeline, entry] })),
  setTimeline: (timeline) => set({ timeline }),
  setReasoningSummaries: (reasoningSummaries) => set({ reasoningSummaries }),
  reset: () => set({
    allConversationMessages: [],
    conversationMessages: [],
    branchState: null,
    timeline: [],
    reasoningSummaries: [],
    monotonicStoppedTurnIds: [],
    monotonicStoppedRequestIds: [],
    revokedRequestIds: [],
  }),
}));
