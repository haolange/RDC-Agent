import { useCallback, useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type { SessionRecord } from '@shared/types/session';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { buildInitialTurnControls, sanitizeTurnControls } from './turnControlsUtils';
import {
  buildSessionTurnControlsKey,
  resolveTurnControlsForCapabilityChange,
} from './turnControlHelpers';
import {
  type CapabilityResolutionState,
  resolvedCapability,
} from './capabilityResolution';
import { useEffectiveModelCapability } from './useEffectiveModelCapability';
import { useComposerEffectiveModel } from './useComposerEffectiveModel';

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

export function useTurnControls(agentId: string, currentSession: SessionRecord | null) {
  const turnControls = useTurnControlsStore((state) => state.turnControls);
  const capabilityState = useTurnControlsStore((state) => state.capabilityState);
  const setTurnControls = useTurnControlsStore((state) => state.setTurnControls);
  const setCapabilityState = useTurnControlsStore((state) => state.setCapabilityState);
  const rememberControls = useTurnControlsStore((state) => state.rememberControls);
  const clearRememberedControls = useTurnControlsStore((state) => state.clearRememberedControls);
  const settings = useAppSettingsStore((state) => state.settings);
  const { effective } = useComposerEffectiveModel(agentId, currentSession);
  const providerId = effective?.providerId;
  const modelId = effective?.modelId;
  const provider = providerId
    ? settings.llm.providers.find((entry) => entry.id === providerId)
    : null;
  const preference = provider?.models.find((entry) => entry.id === modelId);
  const routeFingerprint = providerId && modelId && provider
    ? [
        providerId,
        modelId,
        provider.activeAccountId ?? `anonymous:${provider.id}`,
        provider.protocol,
        preference?.preferredRouteOptionId ?? '',
      ].join('\u001f')
    : '';
  const routeSyncState = useAppSettingsStore((state) => state.agentRouteSyncById[agentId]);
  const settingsHydrated = useAppSettingsStore((state) => state.hydrated);
  const sessionId = currentSession?.sessionId ?? null;
  const sessionControls = currentSession?.turnControls ?? null;
  const capability = resolvedCapability(capabilityState);
  const lastSessionIdRef = useRef<string | null>(null);
  const lastCapabilityKeyRef = useRef<string | null>(null);
  const lastSessionControlsKeyRef = useRef<string>('none');
  const retryCapability = useEffectiveModelCapability(
    agentId,
    routeFingerprint,
    routeSyncState,
    settingsHydrated,
    setCapabilityState,
  );

  const capabilityKey = capability
    ? `${agentId}:${capability.providerId}:${capability.modelId}:${capability.route.protocol}:${capability.catalogRevision}:${capability.routeRevision}`
    : null;
  const sessionControlsKey = buildSessionTurnControlsKey(sessionControls);

  useEffect(() => {
    const sessionChanged = lastSessionIdRef.current !== sessionId;
    const sessionControlsChanged = lastSessionControlsKeyRef.current !== sessionControlsKey;
    const previousCapabilityKey = lastCapabilityKeyRef.current;
    const store = useTurnControlsStore.getState();

    if (sessionChanged) clearRememberedControls();
    if (!capability || !capabilityKey) {
      if (sessionChanged || sessionControlsChanged) {
        setTurnControls(buildInitialTurnControls(null, sessionControls));
      }
      lastSessionIdRef.current = sessionId;
      lastSessionControlsKeyRef.current = sessionControlsKey;
      return;
    }

    if (
      previousCapabilityKey
      && previousCapabilityKey !== capabilityKey
      && !sessionChanged
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
    sessionControlsKey,
    sessionControls,
    capability,
    capabilityKey,
    setTurnControls,
    rememberControls,
    clearRememberedControls,
  ]);

  useEffect(() => {
    if (capability) setTurnControls((current) => sanitizeTurnControls(current, capability));
  }, [capability, setTurnControls]);

  const updateTurnControls = useCallback((patch: Partial<ConversationTurnControls>) => {
    if (!capability || !capabilityKey) return;
    setTurnControls((current) => {
      const next = sanitizeTurnControls({ ...current, ...patch }, capability);
      rememberControls(capabilityKey, next);
      return next;
    });
  }, [capability, capabilityKey, rememberControls, setTurnControls]);

  return {
    turnControls,
    capability,
    capabilityState,
    retryCapability,
    updateTurnControls,
    setTurnControls: (next: ConversationTurnControls) => {
      if (!capability || !capabilityKey) return;
      const sanitized = sanitizeTurnControls(next, capability);
      rememberControls(capabilityKey, sanitized);
      setTurnControls(sanitized);
    },
  };
}
