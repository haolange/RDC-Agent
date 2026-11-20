import { create } from 'zustand';
import type { SettingsSection } from '../lib/settingsSections';

export interface AgentSettingsRequest { agentId: string; sequence: number }
export interface SettingsSectionRequest { section: SettingsSection; sequence: number }

interface SettingsNavigationState {
  agentRequest: AgentSettingsRequest | null;
  sectionRequest: SettingsSectionRequest | null;
  openAgent: (agentId: string) => void;
  /** Opens Settings on a section; the dialog consumes the request once. */
  openSection: (section: SettingsSection) => void;
  clearAgentRequest: (sequence?: number) => void;
  clearSectionRequest: (sequence: number) => void;
}

let sequence = 0;
export const useSettingsNavigationStore = create<SettingsNavigationState>((set) => ({
  agentRequest: null,
  sectionRequest: null,
  openAgent: (agentId) => set({ agentRequest: { agentId, sequence: ++sequence } }),
  openSection: (section) => set({ sectionRequest: { section, sequence: ++sequence } }),
  clearAgentRequest: (expected) => set((state) => expected === undefined || state.agentRequest?.sequence === expected
    ? { agentRequest: null } : state),
  clearSectionRequest: (expected) => set((state) => state.sectionRequest?.sequence === expected
    ? { sectionRequest: null } : state),
}));
