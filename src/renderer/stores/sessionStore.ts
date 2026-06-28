import { create } from 'zustand';
import type { RunContextUsageSummary, RunSummary } from '@shared/types/session';
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
  isLoading: boolean;

  setRuns: (runs: RunSummary[]) => void;
  setCurrentRun: (run: RunSummary | null) => void;
  setCurrentRunUsage: (usage: RunContextUsageSummary | null) => void;
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
  isLoading: false,

  setRuns: (runs) => set({ runs }),
  setCurrentRun: (run) => set({ currentRun: run }),
  setCurrentRunUsage: (usage) =>
    set(usage
      ? { currentRunUsage: usage, lastKnownUsage: usage, usageStale: false }
      : { currentRunUsage: null }),
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
      isLoading: false,
    });
  },
}));
