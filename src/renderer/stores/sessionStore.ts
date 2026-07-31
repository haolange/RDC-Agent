import { create } from 'zustand';
import type { RunContextUsageSummary, RunSummary } from '@shared/types/session';
import {
  applyContextUsage,
  createEmptyContextUsageProjection,
  markContextTurnTerminal,
  setContextPreparationPhase,
  setPreparedContext,
  type ContextUsageProjectionState,
  type ConversationPreparationPhase,
} from './contextUsageProjectionModel';
import { useCaptureStore } from './captureStore';
import { useConversationStore } from './conversationStore';
import { useProjectStore } from './projectStore';
import { useWorkflowStore } from './workflowStore';
import { useEvidenceStore } from './evidenceStore';

interface SessionState extends ContextUsageProjectionState {
  runs: RunSummary[];
  currentRun: RunSummary | null;
  isLoading: boolean;

  setRuns: (runs: RunSummary[]) => void;
  setCurrentRun: (run: RunSummary | null) => void;
  setCurrentRunUsage: (usage: RunContextUsageSummary | null, stale?: boolean) => void;
  setPreparedTurnContext: (summary: ContextUsageProjectionState['preparedTurnContext']) => void;
  setConversationPreparationPhase: (phase: ConversationPreparationPhase) => void;
  markConversationTurnTerminal: (turnId: string, awaitLateUsage?: boolean) => void;
  clearUsageSnapshot: () => void;
  hydrateContextUsage: (contextUsage: ContextUsageProjectionState) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  runs: [],
  currentRun: null,
  ...createEmptyContextUsageProjection(),
  isLoading: false,

  setRuns: (runs) => set({ runs }),
  setCurrentRun: (currentRun) => set({ currentRun }),
  setCurrentRunUsage: (usage, stale = false) => set((state) => applyContextUsage(state, usage, stale)),
  setPreparedTurnContext: (preparedTurnContext) => set((state) => setPreparedContext(state, preparedTurnContext)),
  setConversationPreparationPhase: (conversationPreparationPhase) => set((state) => (
    setContextPreparationPhase(state, conversationPreparationPhase)
  )),
  markConversationTurnTerminal: (turnId, awaitLateUsage = true) => set((state) => (
    markContextTurnTerminal(state, turnId, awaitLateUsage)
  )),
  clearUsageSnapshot: () => set(createEmptyContextUsageProjection()),
  hydrateContextUsage: (contextUsage) => set(contextUsage),
  setLoading: (isLoading) => set({ isLoading }),
  reset: () => {
    useProjectStore.getState().setCurrentSession(null);
    useProjectStore.getState().setRightRailTarget('project');
    useCaptureStore.getState().reset();
    useConversationStore.getState().reset();
    useEvidenceStore.getState().reset();
    useWorkflowStore.getState().reset();
    set({
      runs: [],
      currentRun: null,
      ...createEmptyContextUsageProjection(),
      isLoading: false,
    });
  },
}));
