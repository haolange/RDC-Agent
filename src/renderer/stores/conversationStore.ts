import { create } from 'zustand';
import type { ConversationMessage } from '@shared/types/conversation';
import {
  ACTIVE_ASSISTANT_STATUSES,
  initialConversationState,
  mergeConversationMessages,
  projectVisibleMessages,
  sortConversationMessages,
  type ConversationState,
} from './conversationStoreModel';

export { shouldRejectActivePatchForMonotonicStop } from './conversationStoreModel';

/** Visible active-branch messages, already sorted at the write boundary. */
export const selectOrderedConversationMessages = (state: ConversationState): ConversationMessage[] =>
  state.conversationMessages;

export const selectConversationMessageCount = (state: ConversationState): number =>
  state.conversationMessages.length;

export const selectLatestMessageActivityAt = (state: ConversationState): number =>
  state.conversationMessages.reduce<number>((max, message) => {
    const candidate = message.updatedAt ?? message.createdAt;
    return candidate > max ? candidate : max;
  }, 0);

const projectMessages = (
  allConversationMessages: ConversationMessage[],
  branchState: ConversationState['branchState'],
) => ({
  allConversationMessages,
  conversationMessages: projectVisibleMessages(allConversationMessages, branchState),
});

export const useConversationStore = create<ConversationState>((set, get) => ({
  ...initialConversationState,

  setConversationMessages: (messages) => set((state) => {
    const allConversationMessages = sortConversationMessages(messages);
    return projectMessages(allConversationMessages, state.branchState);
  }),
  setBranchState: (branchState) => set((state) => ({
    branchState,
    conversationMessages: projectVisibleMessages(state.allConversationMessages, branchState),
  })),
  setConversationSnapshot: (messages, branchState) => set((state) => {
    const nextBranchState = branchState === undefined ? state.branchState : branchState;
    const allConversationMessages = sortConversationMessages(messages);
    return { ...projectMessages(allConversationMessages, nextBranchState), branchState: nextBranchState };
  }),
  addConversationMessage: (message) => set((state) => {
    const allConversationMessages = mergeConversationMessages(
      state.allConversationMessages,
      [message],
      new Set(state.monotonicStoppedTurnIds),
      new Set(state.monotonicStoppedRequestIds),
    );
    return projectMessages(allConversationMessages, state.branchState);
  }),
  upsertConversationMessage: (message) => set((state) => {
    const allConversationMessages = mergeConversationMessages(
      state.allConversationMessages,
      [message],
      new Set(state.monotonicStoppedTurnIds),
      new Set(state.monotonicStoppedRequestIds),
    );
    return projectMessages(allConversationMessages, state.branchState);
  }),
  upsertConversationMessages: (messages) => set((state) => {
    const allConversationMessages = mergeConversationMessages(
      state.allConversationMessages,
      messages,
      new Set(state.monotonicStoppedTurnIds),
      new Set(state.monotonicStoppedRequestIds),
    );
    return projectMessages(allConversationMessages, state.branchState);
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
    ) return {};
    const allConversationMessages = sortConversationMessages(
      state.allConversationMessages.map((message) => (
        message.turnId === turnId && message.role === 'assistant'
          ? { ...message, ...patch, updatedAt: Date.now() }
          : message
      )),
    );
    return projectMessages(allConversationMessages, state.branchState);
  }),
  updateAssistantMessageByTurnId: (turnId, updater) => set((state) => {
    const allConversationMessages = sortConversationMessages(
      state.allConversationMessages.map((message) => (
        message.turnId === turnId && message.role === 'assistant' ? updater(message) : message
      )),
    );
    return projectMessages(allConversationMessages, state.branchState);
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
    if (!state.monotonicStoppedTurnIds.includes(fromTurnId)) return {};
    const withoutFrom = state.monotonicStoppedTurnIds.filter((id) => id !== fromTurnId);
    return withoutFrom.includes(toTurnId)
      ? { monotonicStoppedTurnIds: withoutFrom }
      : { monotonicStoppedTurnIds: [...withoutFrom, toTurnId] };
  }),
  markRequestRevoked: (requestId) => set((state) => (
    state.revokedRequestIds.includes(requestId)
      ? {}
      : { revokedRequestIds: [...state.revokedRequestIds, requestId] }
  )),
  consumeRevokedRequest: (requestId) => {
    const state = get();
    if (!state.revokedRequestIds.includes(requestId)) return false;
    set({ revokedRequestIds: state.revokedRequestIds.filter((id) => id !== requestId) });
    return true;
  },
  addTimelineEntry: (entry) => set((state) => ({ timeline: [...state.timeline, entry] })),
  setTimeline: (timeline) => set({ timeline }),
  setReasoningSummaries: (reasoningSummaries) => set({ reasoningSummaries }),
  reset: () => set({ ...initialConversationState }),
}));