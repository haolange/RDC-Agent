import { create } from 'zustand';
import type {
  RunSummary,
  ContextSnapshot,
  CaptureDescriptor,
  OpenedCaptureState,
  ProjectInputRecord,
  ProjectRecord,
  SessionRecord,
} from '@shared/types/session';
import type { AgentTimelineEntry } from '@shared/types/agent';

interface SessionState {
  projects: ProjectRecord[];
  sessions: SessionRecord[];
  currentProject: ProjectRecord | null;
  currentSession: SessionRecord | null;
  currentRun: RunSummary | null;
  contextSnapshot: ContextSnapshot | null;
  captures: CaptureDescriptor[];
  projectInputs: ProjectInputRecord[];
  openedCapture: OpenedCaptureState | null;
  timeline: AgentTimelineEntry[];
  runs: RunSummary[];
  isLoading: boolean;

  // Actions
  setProjects: (projects: ProjectRecord[]) => void;
  setSessions: (sessions: SessionRecord[]) => void;
  setCurrentProject: (project: ProjectRecord | null) => void;
  setCurrentSession: (session: SessionRecord | null) => void;
  setCurrentRun: (run: RunSummary | null) => void;
  setContextSnapshot: (snapshot: ContextSnapshot | null) => void;
  setCaptures: (captures: CaptureDescriptor[]) => void;
  addCapture: (capture: CaptureDescriptor) => void;
  updateCapture: (captureId: string, patch: Partial<CaptureDescriptor>) => void;
  removeCapture: (captureId: string) => void;
  setProjectInputs: (inputs: ProjectInputRecord[]) => void;
  setOpenedCapture: (openedCapture: OpenedCaptureState | null) => void;
  addTimelineEntry: (entry: AgentTimelineEntry) => void;
  setTimeline: (timeline: AgentTimelineEntry[]) => void;
  setRuns: (runs: RunSummary[]) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  projects: [],
  sessions: [],
  currentProject: null,
  currentSession: null,
  currentRun: null,
  contextSnapshot: null,
  captures: [],
  projectInputs: [],
  openedCapture: null,
  timeline: [],
  runs: [],
  isLoading: false,

  setProjects: (projects) => set({ projects }),
  setSessions: (sessions) => set({ sessions }),
  setCurrentProject: (project) => set({ currentProject: project }),
  setCurrentSession: (session) => set({ currentSession: session }),
  setCurrentRun: (run) => set({ currentRun: run }),
  setContextSnapshot: (snapshot) => set({ contextSnapshot: snapshot }),
  setCaptures: (captures) => set({ captures }),
  addCapture: (capture) => set((state) => ({
    captures: state.captures.some((entry) => entry.id === capture.id)
      ? state.captures.map((entry) => entry.id === capture.id ? { ...entry, ...capture } : entry)
      : [...state.captures, capture],
  })),
  updateCapture: (captureId, patch) => set((state) => ({
    captures: state.captures.map((entry) => entry.id === captureId ? { ...entry, ...patch } : entry),
  })),
  removeCapture: (captureId) => set((state) => ({
    captures: state.captures.filter((entry) => entry.id !== captureId),
  })),
  setProjectInputs: (inputs) => set({ projectInputs: inputs }),
  setOpenedCapture: (openedCapture) => set({ openedCapture }),
  addTimelineEntry: (entry) => set((state) => ({ timeline: [...state.timeline, entry] })),
  setTimeline: (timeline) => set({ timeline }),
  setRuns: (runs) => set({ runs }),
  setLoading: (loading) => set({ isLoading: loading }),
  reset: () =>
    set({
      currentSession: null,
      currentRun: null,
      contextSnapshot: null,
      captures: [],
      openedCapture: null,
      timeline: [],
      runs: [],
      isLoading: false,
    }),
}));
