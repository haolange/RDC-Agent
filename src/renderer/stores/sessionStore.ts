import { create } from 'zustand';
import type {
  PreparedTurnContextSummary,
  RunContextUsageSummary,
  RunSummary,
} from '@shared/types/session';
import { useCaptureStore } from './captureStore';
import { useConversationStore } from './conversationStore';
import { useProjectStore } from './projectStore';
import { useWorkflowStore } from './workflowStore';
import { useEvidenceStore } from './evidenceStore';

interface SessionState {
  runs: RunSummary[];
  currentRun: RunSummary | null;
  currentRunUsage: RunContextUsageSummary | null;
  /** 最近一次已知用量，run 结束后保留用于灰显展示。 */
  lastKnownUsage: RunContextUsageSummary | null;
  /** lastKnownUsage 是否来自已结束的 run（UI 据此灰显）。 */
  usageStale: boolean;
  preparedTurnContext: PreparedTurnContextSummary | null;
  conversationPreparationPhase: 'idle' | 'preparing' | 'current' | 'actual';
  conversationTerminalTurnId: string | null;
  isLoading: boolean;

  setRuns: (runs: RunSummary[]) => void;
  setCurrentRun: (run: RunSummary | null) => void;
  setCurrentRunUsage: (usage: RunContextUsageSummary | null) => void;
  setPreparedTurnContext: (summary: PreparedTurnContextSummary | null) => void;
  setConversationPreparationPhase: (phase: 'idle' | 'preparing' | 'current' | 'actual') => void;
  markConversationTurnTerminal: (turnId: string, awaitLateUsage?: boolean) => void;
  clearUsageSnapshot: () => void;
  markRunUsageStale: () => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  runs: [],
  currentRun: null,
  currentRunUsage: null,
  lastKnownUsage: null,
  usageStale: false,
  preparedTurnContext: null,
  conversationPreparationPhase: 'idle',
  conversationTerminalTurnId: null,
  isLoading: false,

  setRuns: (runs) => set({ runs }),
  setCurrentRun: (run) => set({ currentRun: run }),
  setCurrentRunUsage: (usage) => set((state) => {
    if (!usage) return { currentRunUsage: null };
    const prepared = state.preparedTurnContext;
    const providerActualIsNewer = Boolean(
      prepared
      && usage.snapshotAt !== null
      && usage.snapshotAt >= prepared.preparedAt
      && usage.providerId === prepared.route.providerId
      && [
        prepared.route.selectedModelId,
        prepared.route.effectiveModelId,
      ].includes(usage.modelId),
    );
    const terminalAlreadyObserved = providerActualIsNewer
      && state.conversationTerminalTurnId === state.preparedTurnContext?.turnId;
    return {
      currentRunUsage: usage,
      lastKnownUsage: usage,
      usageStale: false,
      ...(providerActualIsNewer
        ? terminalAlreadyObserved
          ? {
              preparedTurnContext: null,
              conversationPreparationPhase: 'idle' as const,
              conversationTerminalTurnId: null,
            }
          : { conversationPreparationPhase: 'actual' as const }
        : {}),
    };
  }),
  setPreparedTurnContext: (preparedTurnContext) => set({
    preparedTurnContext,
    ...(preparedTurnContext ? { conversationTerminalTurnId: null } : {}),
  }),
  setConversationPreparationPhase: (conversationPreparationPhase) => set({
    conversationPreparationPhase,
    ...(conversationPreparationPhase === 'preparing' ? { conversationTerminalTurnId: null } : {}),
  }),
  markConversationTurnTerminal: (turnId, awaitLateUsage = true) => set((state) => {
    if (state.preparedTurnContext?.turnId !== turnId) return {};
    const actualAlreadyObserved = state.conversationPreparationPhase === 'actual';
    return {
      conversationPreparationPhase: 'idle' as const,
      conversationTerminalTurnId: actualAlreadyObserved || !awaitLateUsage ? null : turnId,
      ...(actualAlreadyObserved || !awaitLateUsage ? { preparedTurnContext: null } : {}),
    };
  }),
  clearUsageSnapshot: () => set({
    currentRunUsage: null,
    lastKnownUsage: null,
    usageStale: false,
    preparedTurnContext: null,
    conversationPreparationPhase: 'idle',
    conversationTerminalTurnId: null,
  }),
  markRunUsageStale: () => set({ currentRunUsage: null, usageStale: true }),
  setLoading: (loading) => set({ isLoading: loading }),
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
      currentRunUsage: null,
      lastKnownUsage: null,
      usageStale: false,
      preparedTurnContext: null,
      conversationPreparationPhase: 'idle',
      conversationTerminalTurnId: null,
      isLoading: false,
    });
  },
}));
