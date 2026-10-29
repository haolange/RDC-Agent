import { useCallback, useEffect, useRef, useState } from 'react';
import { persistSessionModelOverride } from './sessionModelOverride';
import { useProjectStore } from '../../stores/projectStore';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type { SessionRecord } from '@shared/types/session';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useTurnControlsStore } from '../../stores/turnControlsStore';
import { buildInitialTurnControls, sanitizeTurnControls } from '../../lib/turnControlsUtils';
import {
  buildSessionTurnControlsKey,
  resolveTurnControlsForCapabilityChange,
} from '../../lib/turnControlHelpers';
import { resolvedCapability } from '../../lib/capabilityResolution';
import { useEffectiveModelCapability } from './useEffectiveModelCapability';
import { useComposerEffectiveModel } from '../../hooks/useComposerEffectiveModel';

const IDLE_SAVE: { saving: boolean; error?: string } = { saving: false };

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
  const [saveState, setSaveState] = useState<{ sessionId: string | null; saving: boolean; error?: string }>({ sessionId, saving: false });
  const pendingSaves = useRef(0);
  const saveRevision = useRef(0);
  const invalidateSave = useCallback(() => { saveRevision.current++; }, []);
  useEffect(() => {
    invalidateSave();
    setSaveState({ sessionId, saving: false });
    return invalidateSave;
  }, [sessionId, invalidateSave]);
  const saveControls = useCallback(async (controls: ConversationTurnControls) => {
    if (!sessionId) return;
    const revision = ++saveRevision.current;
    pendingSaves.current++;
    setSaveState({ sessionId, saving: true });
    try {
      const result = await persistSessionModelOverride(sessionId, currentSession?.modelOverride ?? null, controls);
      if (revision === saveRevision.current && useProjectStore.getState().currentSession?.sessionId === sessionId) {
        setSaveState({ sessionId, saving: false, error: result.ok ? undefined : result.error });
      }
    } finally { pendingSaves.current--; }
  }, [sessionId, currentSession?.modelOverride]);
  const sessionControls = currentSession?.turnControls ?? null;
  const capability = resolvedCapability(capabilityState);
  const lastSessionIdRef = useRef<string | null>(null);
  const lastCapabilityKeyRef = useRef<string | null>(null);
  const lastSessionControlsKeyRef = useRef<string>('none');
  const lastRouteIdentityRef = useRef<string | null>(null);
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
  const routeIdentity = capability ? `${capability.providerId}:${capability.modelId}:${capability.route.protocol}` : null;

  useEffect(() => {
    const sessionChanged = lastSessionIdRef.current !== sessionId;
    const sessionControlsChanged = lastSessionControlsKeyRef.current !== sessionControlsKey && pendingSaves.current === 0;
    const previousCapabilityKey = lastCapabilityKeyRef.current;
    const store = useTurnControlsStore.getState();

    if (sessionChanged) clearRememberedControls();
    if (!capability || !capabilityKey) {
      if (!sessionChanged && previousCapabilityKey) rememberControls(previousCapabilityKey, store.turnControls);
      lastCapabilityKeyRef.current = null;
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
      sameModelRoute: lastRouteIdentityRef.current === routeIdentity,
    }));

    lastSessionIdRef.current = sessionId;
    lastCapabilityKeyRef.current = capabilityKey;
    lastRouteIdentityRef.current = routeIdentity;
    lastSessionControlsKeyRef.current = sessionControlsKey;
  }, [
    sessionId,
    sessionControlsKey,
    sessionControls,
    capability,
    capabilityKey,
    routeIdentity,
    setTurnControls,
    rememberControls,
    clearRememberedControls,
  ]);

  useEffect(() => {
    if (capability) setTurnControls((current) => sanitizeTurnControls(current, capability));
  }, [capability, setTurnControls]);

  const updateTurnControls = useCallback((patch: Partial<ConversationTurnControls>) => {
    if (!capability || !capabilityKey) return;
    const next = sanitizeTurnControls({ ...useTurnControlsStore.getState().turnControls, ...patch }, capability);
    rememberControls(capabilityKey, next);
    setTurnControls(next);
    void saveControls(next);
  }, [capability, capabilityKey, rememberControls, setTurnControls, saveControls]);
  const retrySave = useCallback(() => { void saveControls(useTurnControlsStore.getState().turnControls); }, [saveControls]);

  return {
    turnControls,
    capability,
    capabilityState,
    retryCapability,
    saveState: saveState.sessionId === sessionId ? saveState : IDLE_SAVE,
    retrySave,
    updateTurnControls,
    setTurnControls: (next: ConversationTurnControls) => {
      if (!capability || !capabilityKey) return;
      const sanitized = sanitizeTurnControls(next, capability);
      rememberControls(capabilityKey, sanitized);
      setTurnControls(sanitized);
    },
  };
}
