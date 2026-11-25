import { useMemo } from 'react';
import { buildAgentModelOptions, modelOptionCatalogProviderIds } from '@shared/utils/agentModelOptions';
import { catalogScopeKey, useEffectiveCatalogStore } from '../../../../stores/effectiveCatalogStore';
import type { AgentModelOption } from '@shared/types/agentManifest';
import type { EffectiveCatalogSnapshot } from '@shared/types/providerCapability';
import type { AppSettings } from '@shared/types/settings';

/** The Agent model choices from the effective catalogs the renderer holds; a catalog change updates them in place. */
export function useAgentModelOptions(settings: AppSettings): AgentModelOption[] {
  const entries = useEffectiveCatalogStore((state) => state.entries);
  const { providers, agentRoutes } = settings.llm;
  const { agentModels } = settings;
  return useMemo(() => {
    const catalogProviderIds = modelOptionCatalogProviderIds(providers, agentRoutes);
    const catalogs = providers.flatMap((provider): EffectiveCatalogSnapshot[] => {
      const snapshot = catalogProviderIds.has(provider.id) ? entries[catalogScopeKey(provider)]?.snapshot : null;
      return snapshot ? [snapshot] : [];
    });
    return buildAgentModelOptions({ providers, routes: agentRoutes, agentModels, catalogs });
  }, [entries, providers, agentRoutes, agentModels]);
}
