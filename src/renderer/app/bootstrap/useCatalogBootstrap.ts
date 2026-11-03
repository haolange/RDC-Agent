import { useEffect } from 'react';
import { reconcileCatalogProviders, startCatalogProjection, useEffectiveCatalogStore } from '../../stores/effectiveCatalogStore';
import { usePlanReviewStore } from '../../stores/planReviewStore';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useProjectStore } from '../../stores/projectStore';

export function useCatalogBootstrap(): void {
  const settings = useAppSettingsStore((state) => state.settings);
  const currentSessionId = useProjectStore((state) => state.currentSession?.sessionId);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI?.events?.onEffectiveCatalogChanged) return undefined;
    let debounceTimer: number | undefined;
    const unsubscribe = electronAPI.events.onEffectiveCatalogChanged(() => {
      if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = undefined;
        void useAppSettingsStore.getState().reloadSettings().catch(() => undefined);
      }, 250);
    });
    return () => {
      if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
      unsubscribe?.();
    };
  }, []);

  useEffect(() => startCatalogProjection(), []);

  useEffect(() => {
    if (!currentSessionId) return;
    for (const provider of useAppSettingsStore.getState().settings.llm.providers) {
      if (provider.enabled !== false && provider.isConfigured) void useEffectiveCatalogStore.getState().load(provider, false, true);
    }
  }, [currentSessionId]);

  useEffect(() => window.electronAPI?.events.onPlanReviewChanged(projection => usePlanReviewStore.getState().accept(projection)), []);

  useEffect(() => {
    if (useAppSettingsStore.getState().hydrated) {
      const active = settings.llm.providers.filter((provider) => provider.enabled !== false
        || settings.llm.agentRoutes.some((route) => route.providerId === provider.id));
      reconcileCatalogProviders(active);
    }
  }, [settings.llm.providers, settings.llm.agentRoutes]);
}
