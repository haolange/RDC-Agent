import { create } from 'zustand';
import type { RunSummary, ContextSnapshot, CaptureDescriptor } from '@shared/types/session';
import type { AgentTimelineEntry } from '@shared/types/agent';

interface SessionState {
  currentRun: RunSummary | null;
  contextSnapshot: ContextSnapshot | null;
  captures: CaptureDescriptor[];
  timeline: AgentTimelineEntry[];
  recentRuns: RunSummary[];
  isLoading: boolean;

  // Actions
  setCurrentRun: (run: RunSummary | null) => void;
  setContextSnapshot: (snapshot: ContextSnapshot | null) => void;
  setCaptures: (captures: CaptureDescriptor[]) => void;
  addTimelineEntry: (entry: AgentTimelineEntry) => void;
  setTimeline: (timeline: AgentTimelineEntry[]) => void;
  setRecentRuns: (runs: RunSummary[]) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  currentRun: null,
  contextSnapshot: null,
  captures: [],
  timeline: [],
  recentRuns: [],
  isLoading: false,

  setCurrentRun: (run) => set({ currentRun: run }),
  setContextSnapshot: (snapshot) => set({ contextSnapshot: snapshot }),
  setCaptures: (captures) => set({ captures }),
  addTimelineEntry: (entry) => set((state) => ({ timeline: [...state.timeline, entry] })),
  setTimeline: (timeline) => set({ timeline }),
  setRecentRuns: (runs) => set({ recentRuns: runs }),
  setLoading: (loading) => set({ isLoading: loading }),
  reset: () =>
    set({
      currentRun: null,
      contextSnapshot: null,
      captures: [],
      timeline: [],
      recentRuns: [],
      isLoading: false,
    }),
}));
