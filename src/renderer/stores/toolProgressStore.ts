import { create } from 'zustand';
import type { AgentEvent, RdcOperationProgress } from '@shared/types/agentRuntime';

/**
 * Where each running tool call of the active session stands, from the ephemeral `tool.progress` events. Nothing here
 * is persisted: a call's entry goes when it settles, every entry goes when the run ends, and a reload starts empty.
 */
interface ToolProgressState {
  byToolCall: Record<string, RdcOperationProgress>;
  apply: (event: AgentEvent) => void;
  reset: () => void;
}

export const useToolProgressStore = create<ToolProgressState>((set) => ({
  byToolCall: {},
  apply: (event) =>
    set((state) => {
      switch (event.type) {
        case 'tool.progress':
          return { byToolCall: { ...state.byToolCall, [event.payload.toolCallId]: event.payload.progress } };
        case 'tool.completed':
        case 'tool.denied': {
          if (!(event.payload.toolCallId in state.byToolCall)) return state;
          const { [event.payload.toolCallId]: _settled, ...rest } = state.byToolCall;
          return { byToolCall: rest };
        }
        case 'run.completed':
        case 'run.failed':
        case 'run.cancelled':
          return Object.keys(state.byToolCall).length ? { byToolCall: {} } : state;
        default:
          return state;
      }
    }),
  reset: () => set({ byToolCall: {} }),
}));
