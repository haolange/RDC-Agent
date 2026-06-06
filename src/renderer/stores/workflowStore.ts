import { create } from 'zustand';
import type {
  AskUserPrompt,
  DebugPlan,
  WorkflowState,
} from '@shared/types/workflow';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';

interface WorkflowStoreState {
  workflowState: WorkflowState | null;
  tracePresentation: AgentRunPresentation | null;
  currentDebugPlan: DebugPlan | null;
  pendingQuestions: AskUserPrompt | null;

  setWorkflowState: (workflowState: WorkflowState | null) => void;
  setTracePresentation: (presentation: AgentRunPresentation | null) => void;
  setCurrentDebugPlan: (debugPlan: DebugPlan | null) => void;
  setPendingQuestions: (prompt: AskUserPrompt | null) => void;
  reset: () => void;
}

export const useWorkflowStore = create<WorkflowStoreState>((set) => ({
  workflowState: null,
  tracePresentation: null,
  currentDebugPlan: null,
  pendingQuestions: null,

  setWorkflowState: (workflowState) => set({ workflowState }),
  setTracePresentation: (tracePresentation) => set({ tracePresentation }),
  setCurrentDebugPlan: (currentDebugPlan) => set({ currentDebugPlan }),
  setPendingQuestions: (pendingQuestions) => set({ pendingQuestions }),
  reset: () => set({
    workflowState: null,
    tracePresentation: null,
    currentDebugPlan: null,
    pendingQuestions: null,
  }),
}));
