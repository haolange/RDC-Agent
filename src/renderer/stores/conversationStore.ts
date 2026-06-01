import { create } from 'zustand';
import type { AgentTimelineEntry } from '@shared/types/agent';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ReasoningSummary } from '@shared/types/workflow';

const sortConversationMessages = (messages: ConversationMessage[]): ConversationMessage[] =>
  messages
    .slice()
    .sort((left, right) => {
      if (left.createdAt !== right.createdAt) {
        return left.createdAt - right.createdAt;
      }
      const leftUpdatedAt = left.updatedAt ?? left.createdAt;
      const rightUpdatedAt = right.updatedAt ?? right.createdAt;
      return leftUpdatedAt - rightUpdatedAt;
    });

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

interface ConversationState {
  conversationMessages: ConversationMessage[];
  timeline: AgentTimelineEntry[];
  reasoningSummaries: ReasoningSummary[];

  setConversationMessages: (messages: ConversationMessage[]) => void;
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
  conversationMessages: [],
  timeline: [],
  reasoningSummaries: [],

  setConversationMessages: (conversationMessages) => set({ conversationMessages: sortConversationMessages(conversationMessages) }),
  addConversationMessage: (message) => set((state) => ({
    conversationMessages: mergeConversationMessages(state.conversationMessages, [message]),
  })),
  upsertConversationMessage: (message) => set((state) => ({
    conversationMessages: mergeConversationMessages(state.conversationMessages, [message]),
  })),
  upsertConversationMessages: (messages) => set((state) => ({
    conversationMessages: mergeConversationMessages(state.conversationMessages, messages),
  })),
  patchAssistantMessageByTurnId: (turnId, patch) => set((state) => ({
    conversationMessages: sortConversationMessages(
      state.conversationMessages.map((message) => (
        message.turnId === turnId && message.role === 'assistant'
          ? { ...message, ...patch, updatedAt: Date.now() }
          : message
      )),
    ),
  })),
  updateAssistantMessageByTurnId: (turnId, updater) => set((state) => ({
    conversationMessages: sortConversationMessages(
      state.conversationMessages.map((message) => (
        message.turnId === turnId && message.role === 'assistant'
          ? updater(message)
          : message
      )),
    ),
  })),
  addTimelineEntry: (entry) => set((state) => ({ timeline: [...state.timeline, entry] })),
  setTimeline: (timeline) => set({ timeline }),
  setReasoningSummaries: (reasoningSummaries) => set({ reasoningSummaries }),
  reset: () => set({
    conversationMessages: [],
    timeline: [],
    reasoningSummaries: [],
  }),
}));
