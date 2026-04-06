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
import type { ActionEvent } from '@shared/types/evidence';
import type {
  AskUserPrompt,
  DebugPlan,
  ReasoningSummary,
  WorkflowState,
} from '@shared/types/workflow';

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
  actionEvents: ActionEvent[];
  runs: RunSummary[];
  workflowState: WorkflowState | null;
  currentDebugPlan: DebugPlan | null;
  pendingQuestions: AskUserPrompt | null;
  reasoningSummaries: ReasoningSummary[];
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
  setActionEvents: (events: ActionEvent[]) => void;
  addActionEvent: (event: ActionEvent) => void;
  setRuns: (runs: RunSummary[]) => void;
  setWorkflowState: (workflowState: WorkflowState | null) => void;
  setCurrentDebugPlan: (debugPlan: DebugPlan | null) => void;
  setPendingQuestions: (prompt: AskUserPrompt | null) => void;
  setReasoningSummaries: (summaries: ReasoningSummary[]) => void;
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
  actionEvents: [],
  runs: [],
  workflowState: null,
  currentDebugPlan: null,
  pendingQuestions: null,
  reasoningSummaries: [],
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
  setActionEvents: (events) => set({ actionEvents: events }),
  addActionEvent: (event) => set((state) => ({ actionEvents: [...state.actionEvents, event] })),
  setRuns: (runs) => set({ runs }),
  setWorkflowState: (workflowState) => set({ workflowState }),
  setCurrentDebugPlan: (currentDebugPlan) => set({ currentDebugPlan }),
  setPendingQuestions: (pendingQuestions) => set({ pendingQuestions }),
  setReasoningSummaries: (reasoningSummaries) => set({ reasoningSummaries }),
  setLoading: (loading) => set({ isLoading: loading }),
  reset: () =>
    set({
      currentSession: null,
      currentRun: null,
      contextSnapshot: null,
      captures: [],
      openedCapture: null,
      timeline: [],
      actionEvents: [],
      runs: [],
      workflowState: null,
      currentDebugPlan: null,
      pendingQuestions: null,
      reasoningSummaries: [],
      isLoading: false,
    }),
}));
