import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { getElectronApi } from '../../platform/getElectronApi';
import type { AgentRouteSyncState } from '../../stores/agentRouteSyncState';
import {
  type CapabilityResolutionState,
  CapabilityRequestGate,
  resolvedCapability,
  validateCapabilityResolution,
} from '../../lib/capabilityResolution';

export function useEffectiveModelCapability(
  agentId: string,
  routeFingerprint: string,
  routeSyncState: AgentRouteSyncState | undefined,
  settingsHydrated: boolean,
  setCapabilityState: (state: CapabilityResolutionState) => void,
): () => void {
  const requestGateRef = useRef(new CapabilityRequestGate());
  const lastReadyRef = useRef<{ routeFingerprint: string; state: CapabilityResolutionState } | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  const retry = useCallback(() => setRetryRevision((revision) => revision + 1), []);
  const [routeProviderId, routeModelId, routeAccountId, routeProtocol] = routeFingerprint.split('\u001f');
  const routeCommitKey = routeSyncState
    ? `${routeSyncState.status}:${routeSyncState.clientRevision}:${routeSyncState.commitHash ?? 'none'}`
    : 'committed:initial:none';

  useLayoutEffect(() => {
    let cancelled = false;
    if (!settingsHydrated) {
      setCapabilityState({ status: 'loading' });
      return () => { cancelled = true; };
    }
    if (routeSyncState?.status === 'saving') {
      requestGateRef.current.invalidate();
      setCapabilityState({ status: 'syncing-route' });
      return () => { cancelled = true; };
    }
    if (!agentId || !routeProviderId || !routeModelId) {
      requestGateRef.current.invalidate();
      lastReadyRef.current = null;
      setCapabilityState({ status: 'unconfigured' });
      return () => { cancelled = true; };
    }

    const loadCapability = async (refresh: boolean) => {
      const requestRevision = requestGateRef.current.begin();
      const previous = lastReadyRef.current;
      if (refresh && previous?.routeFingerprint === routeFingerprint) {
        const model = resolvedCapability(previous.state);
        setCapabilityState(model ? { status: 'refreshing', model } : { status: 'loading' });
      } else {
        lastReadyRef.current = null;
        setCapabilityState({ status: 'loading' });
      }

      const electronAPI = getElectronApi();
      if (!electronAPI) {
        if (!cancelled && requestGateRef.current.isCurrent(requestRevision)) {
          setCapabilityState({ status: 'error', message: 'The application bridge is unavailable.' });
        }
        return;
      }

      try {
        let resolved = await electronAPI.settings.getEffectiveModel(agentId);
        if (
          !resolved
          || resolved.providerId !== routeProviderId
          || resolved.modelId !== routeModelId
        ) {
          const catalog = await electronAPI.settings.getEffectiveCatalog(routeProviderId);
          resolved = catalog?.models.find((model) => model.modelId === routeModelId) ?? null;
        }
        if (cancelled || !requestGateRef.current.isCurrent(requestRevision)) return;
        const next = validateCapabilityResolution(
          { providerId: routeProviderId, modelId: routeModelId },
          resolved,
        );
        if (next.status === 'unavailable' && next.reason === 'route-mismatch') {
          console.warn('[capability-resolution] committed route mismatch', {
            agentId,
            expectedProviderId: routeProviderId,
            expectedModelId: routeModelId,
            resolvedProviderId: resolved?.providerId ?? null,
            resolvedModelId: resolved?.modelId ?? null,
            routeCommitKey,
          });
        }
        if (next.status === 'ready') {
          lastReadyRef.current = { routeFingerprint, state: next };
        }
        setCapabilityState(next);
      } catch (error) {
        if (cancelled || !requestGateRef.current.isCurrent(requestRevision)) return;
        console.error('[capability-resolution] request failed', {
          agentId,
          providerId: routeProviderId,
          modelId: routeModelId,
          routeCommitKey,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        });
        setCapabilityState({ status: 'error', message: 'The model capability request failed.' });
      }
    };

    void loadCapability(false);
    const unsubscribe = getElectronApi()?.events.onEffectiveCatalogChanged((snapshot) => {
      if (
        routeProviderId === snapshot.providerId
        && routeAccountId === snapshot.accountId
        && routeProtocol === snapshot.protocol
      ) void loadCapability(true);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [
    agentId,
    retryRevision,
    routeAccountId,
    routeCommitKey,
    routeFingerprint,
    routeModelId,
    routeProtocol,
    routeProviderId,
    routeSyncState?.status,
    settingsHydrated,
    setCapabilityState,
  ]);

  return retry;
}
