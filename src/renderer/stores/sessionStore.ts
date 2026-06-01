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
  isLoading: boolean;

  setRuns: (runs: RunSummary[]) => void;
  setCurrentRun: (run: RunSummary | null) => void;
  setCurrentRunUsage: (usage: RunContextUsageSummary | null) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  runs: [],
  currentRun: null,
  currentRunUsage: null,
  isLoading: false,

  setRuns: (runs) => set({ runs }),
  setCurrentRun: (run) => set({ currentRun: run }),
  setCurrentRunUsage: (currentRunUsage) => set({ currentRunUsage }),
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
      isLoading: false,
    });
  },
}));
