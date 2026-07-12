import { create } from 'zustand';
import type { AgentTimelineEntry } from '@shared/types/agent';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type { ReasoningSummary } from '@shared/types/workflow';
import { compareConversationMessages, resolveVisibleConversationMessages } from '@shared/conversation/conversationBranchResolver';

const sortConversationMessages = (messages: ConversationMessage[]): ConversationMessage[] =>
  messages.slice().sort(compareConversationMessages);

const mergeConversationMessages = (
  currentMessages: ConversationMessage[],
  nextMessages: ConversationMessage[],
): ConversationMessage[] => {
  const byId = new Map(currentMessages.map((message) => [message.id, message]));
  for (const message of nextMessages) {
    const existing = byId.get(message.id);
    const existingUpdatedAt = existing?.updatedAt ?? existing?.createdAt ?? 0;
    const nextUpdatedAt = message.updatedAt ?? message.createdAt;
    if (!existing || nextUpdatedAt >= existingUpdatedAt) {
      byId.set(message.id, message);
    }
  }
  return sortConversationMessages(Array.from(byId.values()));
};

const projectVisibleMessages = (
  allMessages: ConversationMessage[],
  branchState: ConversationBranchState | null,
): ConversationMessage[] => (
  resolveVisibleConversationMessages(allMessages, branchState)
);

interface ConversationState {
  /** Full merge of every known message id (may include inactive branch siblings). */
  allConversationMessages: ConversationMessage[];
  /** Active-branch projection used by the transcript UI. */
  conversationMessages: ConversationMessage[];
  branchState: ConversationBranchState | null;
  timeline: AgentTimelineEntry[];
  reasoningSummaries: ReasoningSummary[];

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
  addTimelineEntry: (entry: AgentTimelineEntry) => void;
  setTimeline: (timeline: AgentTimelineEntry[]) => void;
  setReasoningSummaries: (summaries: ReasoningSummary[]) => void;
  reset: () => void;
}

export const useConversationStore = create<ConversationState>((set) => ({
  allConversationMessages: [],
  conversationMessages: [],
  branchState: null,
  timeline: [],
  reasoningSummaries: [],

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
    const allConversationMessages = mergeConversationMessages(state.allConversationMessages, [message]);
    return {
      allConversationMessages,
      conversationMessages: projectVisibleMessages(allConversationMessages, state.branchState),
    };
  }),
  upsertConversationMessage: (message) => set((state) => {
    const allConversationMessages = mergeConversationMessages(state.allConversationMessages, [message]);
    return {
      allConversationMessages,
      conversationMessages: projectVisibleMessages(allConversationMessages, state.branchState),
    };
  }),
  upsertConversationMessages: (messages) => set((state) => {
    const allConversationMessages = mergeConversationMessages(state.allConversationMessages, messages);
    return {
      allConversationMessages,
      conversationMessages: projectVisibleMessages(allConversationMessages, state.branchState),
    };
  }),
  patchAssistantMessageByTurnId: (turnId, patch) => set((state) => {
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
  addTimelineEntry: (entry) => set((state) => ({ timeline: [...state.timeline, entry] })),
  setTimeline: (timeline) => set({ timeline }),
  setReasoningSummaries: (reasoningSummaries) => set({ reasoningSummaries }),
  reset: () => set({
    allConversationMessages: [],
    conversationMessages: [],
    branchState: null,
    timeline: [],
    reasoningSummaries: [],
  }),
}));
