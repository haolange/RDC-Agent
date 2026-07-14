import { useEffect, useRef } from 'react';
import type { EffectiveModel } from '@shared/types/providerCapability';
import { getElectronApi } from '../../../platform/getElectronApi';

export function useEffectiveModelCapability(
  agentId: string,
  routeFingerprint: string,
  settingsHydrated: boolean,
  setCapability: (capability: EffectiveModel | null) => void,
): void {
  const requestRevisionRef = useRef(0);
  const routeProviderId = routeFingerprint.split(':', 1)[0] ?? '';

  useEffect(() => {
    let cancelled = false;
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
        if (!cancelled && requestRevision === requestRevisionRef.current) setCapability(resolved);
      } catch {
        if (!cancelled && requestRevision === requestRevisionRef.current) setCapability(null);
      }
    };

    void loadCapability();
    const unsubscribe = getElectronApi()?.events.onEffectiveCatalogChanged((snapshot) => {
      if (routeProviderId === snapshot.providerId) void loadCapability();
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [agentId, routeFingerprint, routeProviderId, settingsHydrated, setCapability]);
}
