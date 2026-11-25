import { useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { isProviderExecutable } from '@shared/utils/providerExecutionAvailability';
import { catalogScopeKey, useEffectiveCatalogStore } from '../../stores/effectiveCatalogStore';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { type CapabilityResolutionState, resolveCatalogCapability } from '../../lib/capabilityResolution';
import type { LlmProviderProtocol } from '@shared/types/settings';

export function useEffectiveModelCapability(
  agentId: string, routeFingerprint: string,
  settingsHydrated: boolean, setCapabilityState: (state: CapabilityResolutionState) => void,
): () => void {
  const [providerId, modelId, accountId, protocol] = routeFingerprint.split('\u001f');
  const provider = useAppSettingsStore((state) => state.settings.llm.providers.find((entry) => entry.id === providerId));
  // A fingerprint without a protocol (no route yet) has no catalog to load; the scope still keys the store lookup.
  const resolvedProtocol = protocol || provider?.protocol;
  const scope = useMemo(() => ({ id: providerId, activeAccountId: accountId || provider?.activeAccountId,
    protocol: (protocol || provider?.protocol) as LlmProviderProtocol }), [providerId, accountId, protocol, provider?.protocol, provider?.activeAccountId]);
  const entry = useEffectiveCatalogStore((state) => state.entries[catalogScopeKey(scope)]);
  useEffect(() => {
    if (settingsHydrated && providerId && modelId && resolvedProtocol) {
      void useEffectiveCatalogStore.getState().load(scope);
    }
  }, [settingsHydrated, providerId, modelId, resolvedProtocol, scope]);
  useLayoutEffect(() => {
    if (!settingsHydrated) return setCapabilityState({ status: 'loading' });
    if (!agentId || !providerId || !modelId) return setCapabilityState({ status: 'unconfigured' });
    if (!isProviderExecutable(provider)) return setCapabilityState({ status: 'unavailable', reason: 'provider-unavailable', message: 'Provider is disabled or disconnected.' });
    setCapabilityState(resolveCatalogCapability({ providerId, modelId }, entry));
  }, [agentId, providerId, modelId, provider, routeFingerprint, settingsHydrated, entry, setCapabilityState]);
  return useCallback(() => { if (scope.id && resolvedProtocol) void useEffectiveCatalogStore.getState().load(scope, true); }, [scope, resolvedProtocol]);
}
