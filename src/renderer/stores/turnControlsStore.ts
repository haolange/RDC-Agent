import { create } from 'zustand';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import { buildInitialTurnControls } from '../lib/turnControlsUtils';
import type { CapabilityResolutionState } from '../lib/capabilityResolution';

interface TurnControlsState {
  turnControls: ConversationTurnControls;
  capabilityState: CapabilityResolutionState;
  controlsByCapabilityKey: Record<string, ConversationTurnControls>;
  setTurnControls: (
    next: ConversationTurnControls | ((prev: ConversationTurnControls) => ConversationTurnControls),
  ) => void;
  setCapabilityState: (state: CapabilityResolutionState) => void;
  rememberControls: (capabilityKey: string, controls: ConversationTurnControls) => void;
  clearRememberedControls: () => void;
}

export const useTurnControlsStore = create<TurnControlsState>((set) => ({
  turnControls: buildInitialTurnControls(null),
  capabilityState: { status: 'loading' },
  controlsByCapabilityKey: {},
  setTurnControls: (next) => set((state) => ({
    turnControls: typeof next === 'function' ? next(state.turnControls) : next,
  })),
  setCapabilityState: (capabilityState) => set({ capabilityState }),
  rememberControls: (capabilityKey, controls) => set((state) => ({
    controlsByCapabilityKey: {
      ...state.controlsByCapabilityKey,
      [capabilityKey]: controls,
    },
  })),
  clearRememberedControls: () => set({ controlsByCapabilityKey: {} }),
}));
