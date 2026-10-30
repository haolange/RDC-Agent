import { create } from 'zustand';
import { useRuntimePermissionStore } from './runtimePermissionStore';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';
import type { RightPanelViewModel } from '@shared/types/trace';
import type { WorkflowState } from '@shared/types/workflow';

interface WorkflowStoreState {
  workflowState: WorkflowState | null;
  tracePresentation: AgentRunPresentation | null;

  setWorkflowState: (workflowState: WorkflowState | null) => void;
  setTracePresentation: (presentation: AgentRunPresentation | null) => void;
  reset: () => void;
}

function sameRightPanel(current: RightPanelViewModel, next: RightPanelViewModel): boolean {
  return current === next
    || (current.progress === next.progress
      && current.artifacts === next.artifacts
      && current.outputs === next.outputs
      && current.context === next.context);
}

function sameTracePresentation(current: AgentRunPresentation | null, next: AgentRunPresentation | null): boolean {
  if (current === next) return true;
  if (!current || !next) return false;
  return current.sessionId === next.sessionId
    && current.updatedAt === next.updatedAt
    && sameRightPanel(current.rightPanel, next.rightPanel);
}

export const useWorkflowStore = create<WorkflowStoreState>((set) => ({
  workflowState: null,
  tracePresentation: null,

  setWorkflowState: (workflowState) => set({ workflowState }),
  setTracePresentation: (presentation) => set((state) => {
    const mode = useRuntimePermissionStore.getState().snapshot?.mode;
    const tracePresentation = presentation && mode && presentation.rightPanel.context.task.permission !== mode
      ? { ...presentation, rightPanel: { ...presentation.rightPanel, context: {
        ...presentation.rightPanel.context, task: { ...presentation.rightPanel.context.task, permission: mode },
      } } } : presentation;
    return sameTracePresentation(state.tracePresentation, tracePresentation) ? state : { tracePresentation };
  }),
  reset: () => set({
    workflowState: null,
    tracePresentation: null,
  }),
}));
