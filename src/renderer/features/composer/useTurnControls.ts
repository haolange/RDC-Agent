import { useCallback, useEffect, useRef } from 'react';
import { clampReasoningSelection } from '@shared/types/modelCapability';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useTurnControlsStore } from '../../stores/turnControlsStore';
import { buildInitialTurnControls, sanitizeTurnControls } from '../../lib/turnControlsUtils';
import {
  buildSessionTurnControlsKey,
  capabilityKeys,
  resolveTurnControlsForCapabilityChange,
  routeFingerprint,
} from '../../lib/turnControlHelpers';
import { resolvedCapability } from '../../lib/capabilityResolution';
import { useComposerEffectiveModel } from '../../hooks/useComposerEffectiveModel';
import { useEffectiveModelCapability } from './useEffectiveModelCapability';
import { isSessionTurnControlsSaving } from './sessionModelOverride';
import { useTurnControlsSave } from './useTurnControlsSave';
import type { SessionRecord } from '@shared/types/session';
import type { ConversationTurnControls } from '@shared/types/modelCapability';

export function useTurnControls(agentId: string, currentSession: SessionRecord | null) {
  const turnControls = useTurnControlsStore((state) => state.turnControls);
  const capabilityState = useTurnControlsStore((state) => state.capabilityState);
  const setTurnControls = useTurnControlsStore((state) => state.setTurnControls);
  const setCapabilityState = useTurnControlsStore((state) => state.setCapabilityState);
  const rememberControls = useTurnControlsStore((state) => state.rememberControls);
  const clearRememberedControls = useTurnControlsStore((state) => state.clearRememberedControls);
  const settings = useAppSettingsStore((state) => state.settings);
  const agentReasoning = settings.agents.definitions.find((definition) => definition.id === agentId)?.reasoningLevel;
  const { effective } = useComposerEffectiveModel(agentId, currentSession);
  const route = routeFingerprint(settings.llm.providers, effective?.providerId, effective?.modelId);
  const settingsHydrated = useAppSettingsStore((state) => state.hydrated);
  const sessionId = currentSession?.sessionId ?? null;
  const { saveState, saveControls } = useTurnControlsSave(sessionId);
  const sessionControls = currentSession?.turnControls ?? null;
  const capability = resolvedCapability(capabilityState);
  const lastSessionIdRef = useRef<string | null>(null);
  const lastCapabilityKeyRef = useRef<string | null>(null);
  const lastSessionControlsKeyRef = useRef<string>('none');
  const lastRouteIdentityRef = useRef<string | null>(null);
  const pendingSessionRestoreRef = useRef(false);
  const lastAgentRef = useRef<string | null>(null);
  const lastAgentReasoningRef = useRef(agentReasoning);
  const explicitReasoningRef = useRef(false);
  const retryCapability = useEffectiveModelCapability(agentId, route, settingsHydrated, setCapabilityState);

  const { capabilityKey, routeIdentity } = capabilityKeys(agentId, capability);
  const sessionControlsKey = buildSessionTurnControlsKey(sessionControls);
  const preserveUnavailableAgentReasoning = useCallback(
    (requested: ConversationTurnControls, normalized: ConversationTurnControls) => {
      const control = capability?.controls.reasoning;
      return agentReasoning &&
        requested.reasoningLevel === agentReasoning &&
        control &&
        (control.kind === 'unknown' || clampReasoningSelection(agentReasoning, control) !== agentReasoning)
        ? { ...normalized, reasoningLevel: agentReasoning }
        : normalized;
    },
    [agentReasoning, capability],
  );
  useEffect(() => {
    const sessionChanged = lastSessionIdRef.current !== sessionId;
    const agentChanged = lastAgentRef.current !== agentId;
    const agentReasoningChanged = lastAgentReasoningRef.current !== agentReasoning;
    const sessionControlsChanged =
      lastSessionControlsKeyRef.current !== sessionControlsKey &&
      !(sessionId && isSessionTurnControlsSaving(sessionId));
    const previousCapabilityKey = lastCapabilityKeyRef.current;
    const store = useTurnControlsStore.getState();

    if (sessionChanged) {
      clearRememberedControls();
      explicitReasoningRef.current = false;
    }
    if (!capability || !capabilityKey) {
      if (!sessionChanged && previousCapabilityKey) rememberControls(previousCapabilityKey, store.turnControls);
      lastCapabilityKeyRef.current = null;
      if (sessionChanged || sessionControlsChanged) {
        pendingSessionRestoreRef.current = true;
        setTurnControls(sessionControls ?? buildInitialTurnControls(null));
      }
      lastSessionIdRef.current = sessionId;
      lastSessionControlsKeyRef.current = sessionControlsKey;
      return;
    }

    if (previousCapabilityKey && previousCapabilityKey !== capabilityKey && !sessionChanged) {
      rememberControls(previousCapabilityKey, store.turnControls);
    }
    const rememberedControls = useTurnControlsStore.getState().controlsByCapabilityKey[capabilityKey];
    let nextControls = resolveTurnControlsForCapabilityChange({
      previousCapabilityKey,
      nextCapabilityKey: capabilityKey,
      sessionChanged,
      sessionControlsChanged: sessionControlsChanged || pendingSessionRestoreRef.current,
      capability,
      sessionControls,
      currentControls: store.turnControls,
      rememberedControls,
      sameModelRoute: lastRouteIdentityRef.current === routeIdentity,
    });
    if (
      !sessionControls &&
      !explicitReasoningRef.current &&
      (agentChanged || agentReasoningChanged || sessionChanged || pendingSessionRestoreRef.current) &&
      agentReasoning
    ) {
      nextControls = { ...nextControls, reasoningLevel: agentReasoning };
    }
    const originallyRequested =
      sessionChanged || sessionControlsChanged || pendingSessionRestoreRef.current
        ? (sessionControls ?? nextControls)
        : store.turnControls;
    nextControls = preserveUnavailableAgentReasoning(originallyRequested, nextControls);
    setTurnControls(nextControls);
    pendingSessionRestoreRef.current = false;

    lastSessionIdRef.current = sessionId;
    lastCapabilityKeyRef.current = capabilityKey;
    lastRouteIdentityRef.current = routeIdentity;
    lastAgentRef.current = agentId;
    lastAgentReasoningRef.current = agentReasoning;
    lastSessionControlsKeyRef.current = sessionControlsKey;
  }, [
    sessionId,
    agentId,
    agentReasoning,
    preserveUnavailableAgentReasoning,
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
    if (capability)
      setTurnControls((current) =>
        preserveUnavailableAgentReasoning(current, sanitizeTurnControls(current, capability)),
      );
  }, [capability, preserveUnavailableAgentReasoning, setTurnControls]);

  const updateTurnControls = useCallback(
    (patch: Partial<ConversationTurnControls>) => {
      if (!capability || !capabilityKey) return;
      if (patch.reasoningLevel !== undefined) explicitReasoningRef.current = true;
      const requested = { ...useTurnControlsStore.getState().turnControls, ...patch };
      const next = preserveUnavailableAgentReasoning(requested, sanitizeTurnControls(requested, capability));
      rememberControls(capabilityKey, next);
      setTurnControls(next);
      void saveControls(next);
    },
    [capability, capabilityKey, preserveUnavailableAgentReasoning, rememberControls, setTurnControls, saveControls],
  );
  const retrySave = useCallback(() => {
    void saveControls(useTurnControlsStore.getState().turnControls);
  }, [saveControls]);

  return {
    turnControls,
    agentReasoning,
    capability,
    capabilityState,
    retryCapability,
    saveState,
    retrySave,
    updateTurnControls,
    setTurnControls: (next: ConversationTurnControls) => {
      if (!capability || !capabilityKey) return;
      explicitReasoningRef.current = true;
      const sanitized = preserveUnavailableAgentReasoning(next, sanitizeTurnControls(next, capability));
      rememberControls(capabilityKey, sanitized);
      setTurnControls(sanitized);
    },
  };
}
