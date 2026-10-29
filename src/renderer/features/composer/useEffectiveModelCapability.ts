import { useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import type { LlmProviderProtocol } from '@shared/types/settings';
import { isProviderExecutable } from '@shared/utils/providerExecutionAvailability';
import type { AgentRouteSyncState } from '../../stores/agentRouteSyncState';
import { catalogScopeKey, useEffectiveCatalogStore } from '../../stores/effectiveCatalogStore';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { type CapabilityResolutionState, validateCapabilityResolution } from '../../lib/capabilityResolution';

export function useEffectiveModelCapability(
  agentId: string, routeFingerprint: string, routeSyncState: AgentRouteSyncState | undefined,
  settingsHydrated: boolean, setCapabilityState: (state: CapabilityResolutionState) => void,
): () => void {
  const [providerId, modelId, accountId, protocol] = routeFingerprint.split('\u001f');
  const routeCommitKey = routeSyncState
    ? `${routeSyncState.status}:${routeSyncState.clientRevision}:${routeSyncState.commitHash ?? 'none'}`
    : 'committed:initial:none';
  const provider = useAppSettingsStore((state) => state.settings.llm.providers.find((entry) => entry.id === providerId));
  const scope = useMemo(() => ({ id: providerId, activeAccountId: accountId || provider?.activeAccountId,
    protocol: (protocol || provider?.protocol) as LlmProviderProtocol }), [providerId, accountId, protocol, provider?.protocol, provider?.activeAccountId]);
  const entry = useEffectiveCatalogStore((state) => state.entries[catalogScopeKey(scope)]);
  useEffect(() => {
    if (settingsHydrated && providerId && modelId && scope.protocol && routeSyncState?.status !== 'saving') {
      void useEffectiveCatalogStore.getState().load(scope);
    }
  }, [settingsHydrated, providerId, modelId, scope, routeSyncState?.status]);
  useLayoutEffect(() => {
    if (!settingsHydrated) return setCapabilityState({ status: 'loading' });
    if (routeSyncState?.status === 'saving') return setCapabilityState({ status: 'syncing-route' });
    if (!agentId || !providerId || !modelId) return setCapabilityState({ status: 'unconfigured' });
    if (!isProviderExecutable(provider)) return setCapabilityState({ status: 'unavailable', reason: 'provider-unavailable', message: 'Provider is disabled or disconnected.' });
    const model = entry?.snapshot?.models.find((item) => item.modelId === modelId) ?? null;
    if (!entry || (entry.loading && !model)) return setCapabilityState({ status: 'loading' });
    if (entry.error && !model) return setCapabilityState({ status: 'error', message: entry.error });
    const next = validateCapabilityResolution({ providerId, modelId }, model);
    setCapabilityState(next.status === 'ready' && (entry.loading || entry.snapshot?.refreshing)
      ? { status: 'refreshing', model: next.model } : next);
  }, [agentId, providerId, modelId, provider, routeFingerprint, routeCommitKey, settingsHydrated, routeSyncState?.status, entry, setCapabilityState]);
  return useCallback(() => { if (scope.id && scope.protocol) void useEffectiveCatalogStore.getState().load(scope, true); }, [scope]);
}
