import { create } from 'zustand';
import type { WorkflowState } from '@shared/types/workflow';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';

interface WorkflowStoreState {
  workflowState: WorkflowState | null;
  tracePresentation: AgentRunPresentation | null;

  setWorkflowState: (workflowState: WorkflowState | null) => void;
  setTracePresentation: (presentation: AgentRunPresentation | null) => void;
  reset: () => void;
}

export const useWorkflowStore = create<WorkflowStoreState>((set) => ({
  workflowState: null,
  tracePresentation: null,

  setWorkflowState: (workflowState) => set({ workflowState }),
  setTracePresentation: (tracePresentation) => set({ tracePresentation }),
  reset: () => set({
    workflowState: null,
    tracePresentation: null,
  }),
}));
