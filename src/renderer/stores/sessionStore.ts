import { create } from 'zustand';
import type {
  RunSummary,
  RunContextUsageSummary,
  ContextSnapshot,
  CaptureDescriptor,
  OpenedCaptureState,
  ProjectInputRecord,
  ProjectRecord,
  SessionRecord,
} from '@shared/types/session';
import type { AgentTimelineEntry } from '@shared/types/agent';
import type { ActionEvent } from '@shared/types/evidence';
import type { ConversationMessage } from '@shared/types/conversation';
import type {
  AskUserPrompt,
  DebugPlan,
  ReasoningSummary,
  WorkflowState,
} from '@shared/types/workflow';

export type RightRailTarget = 'project' | 'session';

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

interface SessionState {
  projects: ProjectRecord[];
  sessions: SessionRecord[];
  currentProject: ProjectRecord | null;
  currentSession: SessionRecord | null;
  rightRailTarget: RightRailTarget;
  currentRun: RunSummary | null;
  currentRunUsage: RunContextUsageSummary | null;
  contextSnapshot: ContextSnapshot | null;
  captures: CaptureDescriptor[];
  projectInputs: ProjectInputRecord[];
  openedCapture: OpenedCaptureState | null;
  conversationMessages: ConversationMessage[];
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
  setRightRailTarget: (target: RightRailTarget) => void;
  setCurrentRun: (run: RunSummary | null) => void;
  setCurrentRunUsage: (usage: RunContextUsageSummary | null) => void;
  setContextSnapshot: (snapshot: ContextSnapshot | null) => void;
  setCaptures: (captures: CaptureDescriptor[]) => void;
  addCapture: (capture: CaptureDescriptor) => void;
  updateCapture: (captureId: string, patch: Partial<CaptureDescriptor>) => void;
  removeCapture: (captureId: string) => void;
  setProjectInputs: (inputs: ProjectInputRecord[]) => void;
  setOpenedCapture: (openedCapture: OpenedCaptureState | null) => void;
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
  rightRailTarget: 'project',
  currentRun: null,
  currentRunUsage: null,
  contextSnapshot: null,
  captures: [],
  projectInputs: [],
  openedCapture: null,
  conversationMessages: [],
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
  setRightRailTarget: (rightRailTarget) => set({ rightRailTarget }),
  setCurrentRun: (run) => set({ currentRun: run }),
  setCurrentRunUsage: (currentRunUsage) => set({ currentRunUsage }),
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
      rightRailTarget: 'project',
      currentRun: null,
      currentRunUsage: null,
      contextSnapshot: null,
      captures: [],
      openedCapture: null,
      conversationMessages: [],
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
