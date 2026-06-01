import { create } from 'zustand';
import type {
  AskUserPrompt,
  DebugPlan,
  WorkflowState,
} from '@shared/types/workflow';
import type { AgentWorkstreamPresentation } from '@shared/types/workstream';

interface WorkflowStoreState {
  workflowState: WorkflowState | null;
  workstreamPresentation: AgentWorkstreamPresentation | null;
  currentDebugPlan: DebugPlan | null;
  pendingQuestions: AskUserPrompt | null;

  setWorkflowState: (workflowState: WorkflowState | null) => void;
  setWorkstreamPresentation: (presentation: AgentWorkstreamPresentation | null) => void;
  setCurrentDebugPlan: (debugPlan: DebugPlan | null) => void;
  setPendingQuestions: (prompt: AskUserPrompt | null) => void;
  reset: () => void;
}

export const useWorkflowStore = create<WorkflowStoreState>((set) => ({
  workflowState: null,
  workstreamPresentation: null,
  currentDebugPlan: null,
  pendingQuestions: null,

  setWorkflowState: (workflowState) => set({ workflowState }),
  setWorkstreamPresentation: (workstreamPresentation) => set({ workstreamPresentation }),
  setCurrentDebugPlan: (currentDebugPlan) => set({ currentDebugPlan }),
  setPendingQuestions: (pendingQuestions) => set({ pendingQuestions }),
  reset: () => set({
    workflowState: null,
    workstreamPresentation: null,
    currentDebugPlan: null,
    pendingQuestions: null,
  }),
}));
