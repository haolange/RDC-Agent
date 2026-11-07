import { create } from 'zustand';

export interface AgentSettingsRequest { agentId: string; sequence: number }

interface SettingsNavigationState {
  agentRequest: AgentSettingsRequest | null;
  openAgent: (agentId: string) => void;
  clearAgentRequest: (sequence?: number) => void;
}

let sequence = 0;
export const useSettingsNavigationStore = create<SettingsNavigationState>((set) => ({
  agentRequest: null,
  openAgent: (agentId) => set({ agentRequest: { agentId, sequence: ++sequence } }),
  clearAgentRequest: (expected) => set((state) => expected === undefined || state.agentRequest?.sequence === expected
    ? { agentRequest: null } : state),
}));
