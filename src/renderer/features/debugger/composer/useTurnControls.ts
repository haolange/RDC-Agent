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

type SessionTurnControlsInput = Parameters<typeof buildInitialTurnControls>[1];

interface TurnControlsSyncFingerprint {
  sessionId: string | null;
  capabilityKey: string;
  sessionControlsKey: string;
}

export function buildSessionTurnControlsKey(sessionControls: SessionTurnControlsInput): string {
  if (!sessionControls) {
    return 'none';
  }
  return JSON.stringify({
    reasoningLevel: sessionControls.reasoningLevel ?? null,
    effort: sessionControls.effort ?? null,
    maxContextMode: sessionControls.maxContextMode === true,
    fastModel: sessionControls.fastModel === true,
  });
}

export function shouldResyncTurnControls(
  previous: TurnControlsSyncFingerprint,
  next: TurnControlsSyncFingerprint,
): boolean {
  return previous.sessionId !== next.sessionId
    || previous.capabilityKey !== next.capabilityKey
    || previous.sessionControlsKey !== next.sessionControlsKey;
}

export function isPendingCapabilityKey(capabilityKey: string): boolean {
  return capabilityKey.endsWith(':pending');
}

export function resolveTurnControlsForCapabilityChange(input: {
  previousCapabilityKey: string | null;
  nextCapabilityKey: string;
  sessionChanged: boolean;
  sessionControlsChanged: boolean;
  capability: ResolvedModelCapability | null;
  sessionControls: SessionTurnControlsInput;
  currentControls: ConversationTurnControls;
  rememberedControls: ConversationTurnControls | undefined;
}): ConversationTurnControls {
  const {
    previousCapabilityKey,
    nextCapabilityKey,
    sessionChanged,
    sessionControlsChanged,
    capability,
    sessionControls,
    rememberedControls,
  } = input;

  if (sessionChanged || sessionControlsChanged || isPendingCapabilityKey(previousCapabilityKey ?? '')) {
    return buildInitialTurnControls(capability, sessionControls);
  }

  if (previousCapabilityKey !== nextCapabilityKey) {
    if (rememberedControls) {
      return sanitizeTurnControls(rememberedControls, capability);
    }
    return buildInitialTurnControls(capability, null);
  }

  return sanitizeTurnControls(input.currentControls, capability);
}

interface TurnControlsState {
  turnControls: ConversationTurnControls;
  capability: ResolvedModelCapability | null;
  controlsByCapabilityKey: Record<string, ConversationTurnControls>;
  setTurnControls: (
    next: ConversationTurnControls | ((prev: ConversationTurnControls) => ConversationTurnControls),
  ) => void;
  setCapability: (capability: ResolvedModelCapability | null) => void;
  rememberControls: (capabilityKey: string, controls: ConversationTurnControls) => void;
  clearRememberedControls: () => void;
}

export const useTurnControlsStore = create<TurnControlsState>((set) => ({
  turnControls: buildInitialTurnControls(null),
  capability: null,
  controlsByCapabilityKey: {},
  setTurnControls: (next) => set((state) => ({
    turnControls: typeof next === 'function' ? next(state.turnControls) : next,
  })),
  setCapability: (capability) => set({ capability }),
  rememberControls: (capabilityKey, controls) => set((state) => ({
    controlsByCapabilityKey: {
      ...state.controlsByCapabilityKey,
      [capabilityKey]: controls,
    },
  })),
  clearRememberedControls: () => set({ controlsByCapabilityKey: {} }),
}));

export function useTurnControls(agentId: string, currentSession: SessionRecord | null) {
  const turnControls = useTurnControlsStore((state) => state.turnControls);
  const capability = useTurnControlsStore((state) => state.capability);
  const setTurnControls = useTurnControlsStore((state) => state.setTurnControls);
  const setCapability = useTurnControlsStore((state) => state.setCapability);
  const rememberControls = useTurnControlsStore((state) => state.rememberControls);
  const clearRememberedControls = useTurnControlsStore((state) => state.clearRememberedControls);
  const llmSettings = useAppSettingsStore((state) => state.settings.llm);
  const settingsHydrated = useAppSettingsStore((state) => state.hydrated);
  const sessionId = currentSession?.sessionId ?? null;
  const sessionControls = currentSession?.turnControls ?? null;
  const lastSessionIdRef = useRef<string | null>(null);
  const lastCapabilityKeyRef = useRef<string | null>(null);
  const lastSessionControlsKeyRef = useRef<string>('none');

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

  const capabilityKey = capability
    ? `${agentId}:${capability.providerId}:${capability.modelId}`
    : `${agentId}:pending`;
  const sessionControlsKey = buildSessionTurnControlsKey(sessionControls);

  useEffect(() => {
    const nextFingerprint: TurnControlsSyncFingerprint = {
      sessionId,
      capabilityKey,
      sessionControlsKey,
    };
    const previousFingerprint: TurnControlsSyncFingerprint = {
      sessionId: lastSessionIdRef.current,
      capabilityKey: lastCapabilityKeyRef.current ?? '',
      sessionControlsKey: lastSessionControlsKeyRef.current,
    };
    if (!shouldResyncTurnControls(previousFingerprint, nextFingerprint)) {
      return;
    }

    const sessionChanged = previousFingerprint.sessionId !== nextFingerprint.sessionId;
    const sessionControlsChanged = previousFingerprint.sessionControlsKey !== nextFingerprint.sessionControlsKey;
    const previousCapabilityKey = lastCapabilityKeyRef.current;
    const store = useTurnControlsStore.getState();

    if (sessionChanged) {
      clearRememberedControls();
    } else if (
      previousCapabilityKey
      && previousCapabilityKey !== capabilityKey
      && !isPendingCapabilityKey(previousCapabilityKey)
      && previousFingerprint.sessionId === sessionId
    ) {
      rememberControls(previousCapabilityKey, store.turnControls);
    }

    const rememberedControls = useTurnControlsStore.getState().controlsByCapabilityKey[capabilityKey];

    setTurnControls(resolveTurnControlsForCapabilityChange({
      previousCapabilityKey,
      nextCapabilityKey: capabilityKey,
      sessionChanged,
      sessionControlsChanged,
      capability,
      sessionControls,
      currentControls: store.turnControls,
      rememberedControls,
    }));

    lastSessionIdRef.current = sessionId;
    lastCapabilityKeyRef.current = capabilityKey;
    lastSessionControlsKeyRef.current = sessionControlsKey;
  }, [
    sessionId,
    capabilityKey,
    sessionControlsKey,
    sessionControls,
    capability,
    setTurnControls,
    rememberControls,
    clearRememberedControls,
  ]);

  useEffect(() => {
    if (!capability) {
      return;
    }
    setTurnControls((current) => sanitizeTurnControls(current, capability));
  }, [capability, setTurnControls]);

  const updateTurnControls = useCallback((patch: Partial<ConversationTurnControls>) => {
    setTurnControls((current) => {
      const next = sanitizeTurnControls({ ...current, ...patch }, capability);
      if (!isPendingCapabilityKey(capabilityKey)) {
        rememberControls(capabilityKey, next);
      }
      return next;
    });
  }, [capability, capabilityKey, rememberControls, setTurnControls]);

  return {
    turnControls,
    capability,
    updateTurnControls,
    setTurnControls: (next: ConversationTurnControls) => {
      const sanitized = sanitizeTurnControls(next, capability);
      if (!isPendingCapabilityKey(capabilityKey)) {
        rememberControls(capabilityKey, sanitized);
      }
      setTurnControls(sanitized);
    },
  };
}
