import { create } from 'zustand';
import type { ActionEvent } from '@shared/types/evidence';

interface EvidenceState {
  actionEvents: ActionEvent[];

  setActionEvents: (events: ActionEvent[]) => void;
  addActionEvent: (event: ActionEvent) => void;
  reset: () => void;
}

export const useEvidenceStore = create<EvidenceState>((set) => ({
  actionEvents: [],

  setActionEvents: (events) => set({ actionEvents: events }),
  addActionEvent: (event) => set((state) => ({ actionEvents: [...state.actionEvents, event] })),
  reset: () => set({ actionEvents: [] }),
}));
