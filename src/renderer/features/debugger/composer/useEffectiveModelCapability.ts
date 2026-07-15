import { useLayoutEffect, useRef } from 'react';
import type { EffectiveModel } from '@shared/types/providerCapability';
import { getElectronApi } from '../../../platform/getElectronApi';

export function useEffectiveModelCapability(
  agentId: string,
  routeFingerprint: string,
  settingsHydrated: boolean,
  setCapability: (capability: EffectiveModel | null) => void,
): void {
  const requestRevisionRef = useRef(0);
  const [routeProviderId, routeModelId, routeAccountId, routeProtocol] = routeFingerprint.split('\u001f');

  useLayoutEffect(() => {
    let cancelled = false;
    setCapability(null);
    const loadCapability = async () => {
      const requestRevision = requestRevisionRef.current + 1;
      requestRevisionRef.current = requestRevision;
      const electronAPI = getElectronApi();
      if (!electronAPI || !agentId) {
        if (!cancelled) setCapability(null);
        return;
      }

      try {
        const resolved = await electronAPI.settings.getEffectiveModel(agentId);
        const revisionMatches = Boolean(resolved?.catalogRevision && resolved?.routeRevision);
        const routeMatches = Boolean(
          resolved
          && resolved.providerId === routeProviderId
          && resolved.modelId === routeModelId,
        );
        if (!cancelled && requestRevision === requestRevisionRef.current) {
          setCapability(revisionMatches && routeMatches ? resolved : null);
        }
      } catch {
        if (!cancelled && requestRevision === requestRevisionRef.current) setCapability(null);
      }
    };

    void loadCapability();
    const unsubscribe = getElectronApi()?.events.onEffectiveCatalogChanged((snapshot) => {
      if (
        routeProviderId === snapshot.providerId
        && routeAccountId === snapshot.accountId
        && routeProtocol === snapshot.protocol
      ) void loadCapability();
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [
    agentId,
    routeFingerprint,
    routeProviderId,
    routeModelId,
    routeAccountId,
    routeProtocol,
    settingsHydrated,
    setCapability,
  ]);
}
