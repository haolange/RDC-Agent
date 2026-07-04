import { useCallback, useEffect, useRef } from 'react';
import { create } from 'zustand';
import type {
  ConversationTurnControls,
  ResolvedModelCapability,
} from '@shared/types/modelCapability';
import type { SessionRecord } from '@shared/types/session';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { getElectronApi } from '../../../platform/getElectronApi';
import {
  buildInitialTurnControls,
  sanitizeTurnControls,
} from './turnControlsUtils';

interface TurnControlsState {
  turnControls: ConversationTurnControls;
  capability: ResolvedModelCapability | null;
  setTurnControls: (
    next: ConversationTurnControls | ((prev: ConversationTurnControls) => ConversationTurnControls),
  ) => void;
  setCapability: (capability: ResolvedModelCapability | null) => void;
}

export const useTurnControlsStore = create<TurnControlsState>((set) => ({
  turnControls: buildInitialTurnControls(null),
  capability: null,
  setTurnControls: (next) => set((state) => ({
    turnControls: typeof next === 'function' ? next(state.turnControls) : next,
  })),
  setCapability: (capability) => set({ capability }),
}));

export function useTurnControls(agentId: string, currentSession: SessionRecord | null) {
  const turnControls = useTurnControlsStore((state) => state.turnControls);
  const capability = useTurnControlsStore((state) => state.capability);
  const setTurnControls = useTurnControlsStore((state) => state.setTurnControls);
  const setCapability = useTurnControlsStore((state) => state.setCapability);
  const llmSettings = useAppSettingsStore((state) => state.settings.llm);
  const settingsHydrated = useAppSettingsStore((state) => state.hydrated);
  const sessionId = currentSession?.sessionId ?? null;
  const lastSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadCapability = async () => {
      const electronAPI = getElectronApi();
      if (!electronAPI || !agentId) {
        if (!cancelled) {
          setCapability(null);
        }
        return;
      }

      try {
        const resolved = await electronAPI.settings.getModelCapability(agentId);
        if (cancelled) {
          return;
        }
        setCapability(resolved);
      } catch {
        if (!cancelled) {
          setCapability(null);
        }
      }
    };

    void loadCapability();
    return () => {
      cancelled = true;
    };
  }, [agentId, llmSettings, settingsHydrated, setCapability]);

  useEffect(() => {
    if (sessionId === lastSessionIdRef.current) {
      return;
    }
    lastSessionIdRef.current = sessionId;
    setTurnControls(buildInitialTurnControls(capability, currentSession?.turnControls));
  }, [sessionId, currentSession?.turnControls, capability, setTurnControls]);

  useEffect(() => {
    if (!capability) {
      return;
    }
    setTurnControls((current) => sanitizeTurnControls(current, capability));
  }, [capability, setTurnControls]);

  const updateTurnControls = useCallback((patch: Partial<ConversationTurnControls>) => {
    setTurnControls((current) => sanitizeTurnControls({ ...current, ...patch }, capability));
  }, [capability, setTurnControls]);

  return {
    turnControls,
    capability,
    updateTurnControls,
    setTurnControls: (next: ConversationTurnControls) => {
      setTurnControls(sanitizeTurnControls(next, capability));
    },
  };
}
