import { create } from 'zustand';
import type { AgentTimelineEntry } from '@shared/types/agent';
import type { ConversationMessage } from '@shared/types/conversation';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';
import type { WorkflowState } from '@shared/types/workflow';
import type { ContextSnapshot, OpenedCaptureState, RunContextUsageSummary } from '@shared/types/session';
import { useConversationStore } from './conversationStore';
import { useWorkflowStore } from './workflowStore';
import { useCaptureStore } from './captureStore';
import { useSessionStore } from './sessionStore';
import {
  acceptsContextUsage,
  applyContextUsage,
  markContextTurnTerminal,
} from './contextUsageProjectionModel';
import {
  createEmptySessionProjection,
  updateProjectionMessages,
  updateSessionProjectionMap,
} from './sessionProjectionModel';
import { hydrateSessionProjection } from './sessionProjectionHydration';

interface SessionProjectionStoreState {
  bySessionId: Record<string, import('./sessionProjectionModel').SessionProjection>;
  ensure: (sessionId: string) => import('./sessionProjectionModel').SessionProjection;
  captureActiveSession: (sessionId: string) => void;
  projectConversationMessage: (sessionId: string, message: ConversationMessage) => void;
  projectConversationTerminal: (sessionId: string, turnId: string, awaitLateUsage: boolean) => void;
  projectRunUsage: (sessionId: string, usage: RunContextUsageSummary, activeRunId: string | null) => void;
  projectTrace: (sessionId: string, presentation: AgentRunPresentation) => void;
  projectContextSnapshot: (sessionId: string, snapshot: ContextSnapshot | null) => void;
  projectOpenedCapture: (sessionId: string, openedCapture: OpenedCaptureState | null) => void;
  projectWorkflow: (sessionId: string, state: WorkflowState) => void;
  projectTimelineEntry: (sessionId: string, entry: AgentTimelineEntry) => void;
  activateSession: (sessionId: string) => boolean;
  evictSession: (sessionId: string) => void;
  reset: () => void;
}

export const useSessionProjectionStore = create<SessionProjectionStoreState>((set, get) => ({
  bySessionId: {},

  ensure: (sessionId) => {
    const existing = get().bySessionId[sessionId];
    if (existing) return existing;
    const created = createEmptySessionProjection();
    set((state) => ({ bySessionId: { ...state.bySessionId, [sessionId]: created } }));
    return created;
  },

  captureActiveSession: (sessionId) => {
    if (!sessionId) return;
    const conversation = useConversationStore.getState();
    const workflow = useWorkflowStore.getState();
    const capture = useCaptureStore.getState();
    const session = useSessionStore.getState();
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
          contextSnapshot: capture.contextSnapshot,
          openedCapture: capture.openedCapture,
          activeRunId: session.currentRun?.runId ?? null,
          contextUsage: {
            currentRunUsage: session.currentRunUsage,
            lastKnownUsage: session.lastKnownUsage,
            usageStale: session.usageStale,
            preparedTurnContext: session.preparedTurnContext,
            conversationPreparationPhase: session.conversationPreparationPhase,
            conversationTerminalTurnId: session.conversationTerminalTurnId,
          },
          lastHydratedAt: Date.now(),
        },
      },
    }));
  },

  projectConversationMessage: (sessionId, message) => {
    if (!sessionId) return;
    set((state) => ({
      bySessionId: updateSessionProjectionMap(state.bySessionId, sessionId, (projection) => ({
        ...projection,
        allMessages: updateProjectionMessages(projection.allMessages, message),
      })),
    }));
  },

  projectConversationTerminal: (sessionId, turnId, awaitLateUsage) => {
    if (!sessionId) return;
    set((state) => ({
      bySessionId: updateSessionProjectionMap(state.bySessionId, sessionId, (projection) => ({
        ...projection,
        contextUsage: markContextTurnTerminal(projection.contextUsage, turnId, awaitLateUsage),
      })),
    }));
  },

  projectRunUsage: (sessionId, usage, activeRunId) => {
    if (!sessionId) return;
    set((state) => ({
      bySessionId: updateSessionProjectionMap(state.bySessionId, sessionId, (projection) => {
        const expectedRunId = activeRunId ?? projection.activeRunId;
        if (!acceptsContextUsage(projection.contextUsage, usage, expectedRunId)) return projection;
        return {
          ...projection,
          activeRunId: expectedRunId,
          contextUsage: applyContextUsage(projection.contextUsage, usage, false),
        };
      }),
    }));
  },

  projectTrace: (sessionId, presentation) => {
    if (!sessionId) return;
    set((state) => ({
      bySessionId: updateSessionProjectionMap(state.bySessionId, sessionId, (projection) => ({
        ...projection,
        tracePresentation: presentation,
      })),
    }));
  },

  projectContextSnapshot: (sessionId, snapshot) => {
    if (!sessionId) return;
    set((state) => ({
      bySessionId: updateSessionProjectionMap(state.bySessionId, sessionId, (projection) => ({
        ...projection,
        contextSnapshot: snapshot,
      })),
    }));
  },

  projectOpenedCapture: (sessionId, openedCapture) => {
    if (!sessionId) return;
    set((state) => ({
      bySessionId: updateSessionProjectionMap(state.bySessionId, sessionId, (projection) => ({
        ...projection,
        openedCapture,
      })),
    }));
  },

  projectWorkflow: (sessionId, workflowState) => {
    if (!sessionId) return;
    set((state) => ({
      bySessionId: updateSessionProjectionMap(state.bySessionId, sessionId, (projection) => ({
        ...projection,
        workflowState,
        reasoningSummaries: workflowState.reasoningSummaries ?? projection.reasoningSummaries,
      })),
    }));
  },

  projectTimelineEntry: (sessionId, entry) => {
    if (!sessionId) return;
    set((state) => ({
      bySessionId: updateSessionProjectionMap(state.bySessionId, sessionId, (projection) => (
        projection.timeline.some((item) => item.id === entry.id)
          ? projection
          : { ...projection, timeline: [...projection.timeline, entry] }
      )),
    }));
  },

  activateSession: (sessionId) => {
    const projection = get().bySessionId[sessionId];
    return Boolean(projection && projection.lastHydratedAt && hydrateSessionProjection(projection));
  },

  evictSession: (sessionId) => {
    if (!sessionId) return;
    set((state) => {
      if (!(sessionId in state.bySessionId)) return state;
      const bySessionId = { ...state.bySessionId };
      delete bySessionId[sessionId];
      return { bySessionId };
    });
  },

  reset: () => set({ bySessionId: {} }),
}));
