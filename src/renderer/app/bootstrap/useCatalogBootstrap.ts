import { useEffect } from 'react';
import { reconcileCatalogProviders, startCatalogProjection, useEffectiveCatalogStore } from '../../stores/effectiveCatalogStore';
import { usePlanReviewStore } from '../../stores/planReviewStore';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useProjectStore } from '../../stores/projectStore';

export function useCatalogBootstrap(): void {
  const settings = useAppSettingsStore((state) => state.settings);
  const currentSessionId = useProjectStore((state) => state.currentSession?.sessionId);

  // Model choices follow the effective catalog in the renderer; a catalog change needs no settings read.
  useEffect(() => startCatalogProjection(), []);

  useEffect(() => window.electronAPI?.events.onSettingsChanged(
    (change) => useAppSettingsStore.getState().adoptSettingsChange(change),
  ), []);

  useEffect(() => {
    if (!currentSessionId) return;
    for (const provider of useAppSettingsStore.getState().settings.llm.providers) {
      if (provider.enabled !== false && provider.isConfigured) void useEffectiveCatalogStore.getState().load(provider, false, true);
    }
  }, [currentSessionId]);

  useEffect(() => window.electronAPI?.events.onPlanReviewChanged(projection => usePlanReviewStore.getState().accept(projection)), []);

  useEffect(() => {
    if (useAppSettingsStore.getState().hydrated) {
      const active = new Set(settings.llm.agentRoutes.map((route) => route.providerId));
      for (const provider of settings.llm.providers) {
        if (provider.enabled !== false) active.add(provider.id);
      }
      reconcileCatalogProviders(settings.llm.providers, active);
    }
  }, [settings.llm.providers, settings.llm.agentRoutes]);
}
