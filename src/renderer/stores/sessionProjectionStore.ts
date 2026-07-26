import { create } from 'zustand';
import type { AgentTimelineEntry } from '@shared/types/agent';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';
import type { WorkflowState } from '@shared/types/workflow';
import type { ReasoningSummary } from '@shared/types/workflow';
import { compareConversationMessages } from '@shared/conversation/conversationBranchResolver';
import { useConversationStore } from './conversationStore';
import { useWorkflowStore } from './workflowStore';

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
  lastHydratedAt: number;
}

const emptyProjection = (): SessionProjection => ({
  allMessages: [],
  branchState: null,
  timeline: [],
  reasoningSummaries: [],
  monotonicStoppedTurnIds: [],
  monotonicStoppedRequestIds: [],
  revokedRequestIds: [],
  workflowState: null,
  tracePresentation: null,
  lastHydratedAt: 0,
});

const sortMessages = (messages: ConversationMessage[]): ConversationMessage[] =>
  messages.slice().sort(compareConversationMessages);

const upsertMessage = (
  messages: ConversationMessage[],
  next: ConversationMessage,
): ConversationMessage[] => {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const existing = byId.get(next.id);
  const existingUpdatedAt = existing?.updatedAt ?? existing?.createdAt ?? 0;
  const nextUpdatedAt = next.updatedAt ?? next.createdAt;
  if (!existing || nextUpdatedAt >= existingUpdatedAt) {
    byId.set(next.id, next);
  }
  return sortMessages(Array.from(byId.values()));
};

interface SessionProjectionStoreState {
  bySessionId: Record<string, SessionProjection>;

  ensure: (sessionId: string) => SessionProjection;
  captureActiveSession: (sessionId: string) => void;
  projectConversationMessage: (sessionId: string, message: ConversationMessage) => void;
  projectTrace: (sessionId: string, presentation: AgentRunPresentation) => void;
  projectWorkflow: (sessionId: string, state: WorkflowState) => void;
  projectTimelineEntry: (sessionId: string, entry: AgentTimelineEntry) => void;
  /** Hydrate active UI stores from cache. Returns true when cache existed. */
  activateSession: (sessionId: string) => boolean;
  evictSession: (sessionId: string) => void;
  reset: () => void;
}

export const useSessionProjectionStore = create<SessionProjectionStoreState>((set, get) => ({
  bySessionId: {},

  ensure: (sessionId) => {
    const existing = get().bySessionId[sessionId];
    if (existing) return existing;
    const created = emptyProjection();
    set((state) => ({
      bySessionId: { ...state.bySessionId, [sessionId]: created },
    }));
    return created;
  },

  captureActiveSession: (sessionId) => {
    if (!sessionId) return;
    const conversation = useConversationStore.getState();
    const workflow = useWorkflowStore.getState();
    set((state) => ({
      bySessionId: {
        ...state.bySessionId,
        [sessionId]: {
          allMessages: conversation.allConversationMessages,
          branchState: conversation.branchState,
          timeline: conversation.timeline,
          reasoningSummaries: conversation.reasoningSummaries,
          monotonicStoppedTurnIds: conversation.monotonicStoppedTurnIds,
          monotonicStoppedRequestIds: conversation.monotonicStoppedRequestIds,
          revokedRequestIds: conversation.revokedRequestIds,
          workflowState: workflow.workflowState,
          tracePresentation: workflow.tracePresentation,
          lastHydratedAt: Date.now(),
        },
      },
    }));
  },

  projectConversationMessage: (sessionId, message) => {
    if (!sessionId) return;
    set((state) => {
      const current = state.bySessionId[sessionId] ?? emptyProjection();
      return {
        bySessionId: {
          ...state.bySessionId,
          [sessionId]: {
            ...current,
            allMessages: upsertMessage(current.allMessages, message),
            lastHydratedAt: Date.now(),
          },
        },
      };
    });
  },

  projectTrace: (sessionId, presentation) => {
    if (!sessionId) return;
    set((state) => {
      const current = state.bySessionId[sessionId] ?? emptyProjection();
      return {
        bySessionId: {
          ...state.bySessionId,
          [sessionId]: {
            ...current,
            tracePresentation: presentation,
            lastHydratedAt: Date.now(),
          },
        },
      };
    });
  },

  projectWorkflow: (sessionId, workflowState) => {
    if (!sessionId) return;
    set((state) => {
      const current = state.bySessionId[sessionId] ?? emptyProjection();
      return {
        bySessionId: {
          ...state.bySessionId,
          [sessionId]: {
            ...current,
            workflowState,
            reasoningSummaries: workflowState.reasoningSummaries ?? current.reasoningSummaries,
            lastHydratedAt: Date.now(),
          },
        },
      };
    });
  },

  projectTimelineEntry: (sessionId, entry) => {
    if (!sessionId) return;
    set((state) => {
      const current = state.bySessionId[sessionId] ?? emptyProjection();
      if (current.timeline.some((item) => item.id === entry.id)) {
        return state;
      }
      return {
        bySessionId: {
          ...state.bySessionId,
          [sessionId]: {
            ...current,
            timeline: [...current.timeline, entry],
            lastHydratedAt: Date.now(),
          },
        },
      };
    });
  },

  activateSession: (sessionId) => {
    const projection = get().bySessionId[sessionId];
    if (!projection || projection.lastHydratedAt === 0) {
      return false;
    }
    useConversationStore.setState({
      timeline: projection.timeline,
      reasoningSummaries: projection.reasoningSummaries,
      monotonicStoppedTurnIds: projection.monotonicStoppedTurnIds,
      monotonicStoppedRequestIds: projection.monotonicStoppedRequestIds,
      revokedRequestIds: projection.revokedRequestIds,
    });
    useConversationStore.getState().setConversationSnapshot(
      projection.allMessages,
      projection.branchState,
    );
    useWorkflowStore.getState().setWorkflowState(projection.workflowState);
    useWorkflowStore.getState().setTracePresentation(projection.tracePresentation);
    return true;
  },

  evictSession: (sessionId) => {
    if (!sessionId) return;
    set((state) => {
      if (!(sessionId in state.bySessionId)) return state;
      const next = { ...state.bySessionId };
      delete next[sessionId];
      return { bySessionId: next };
    });
  },

  reset: () => set({ bySessionId: {} }),
}));
