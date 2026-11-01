import type { SessionModelOverride } from '@shared/types/session';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { readCompiledComposerRoute, resolveComposerEffectiveModel } from '../../lib/composerEffectiveModel';
import { useComposerModelPickerOptions } from './useComposerModelPickerOptions';
import { catalogScopeKey, useEffectiveCatalogStore } from '../../stores/effectiveCatalogStore';
import { resolveCatalogCapability } from '../../lib/capabilityResolution';
import { isProviderExecutable } from '@shared/utils/providerExecutionAvailability';

/** A review without an override executes with the declared target's route. */
export function usePlanReviewModelAvailability(override: SessionModelOverride | null | undefined) {
  const settings = useAppSettingsStore((state) => state.settings);
  useComposerModelPickerOptions(settings.llm.providers);
  const entries = useEffectiveCatalogStore(state => state.entries);
  return (agentId: string): 'available' | 'loading' | 'unavailable' => {
    const route = resolveComposerEffectiveModel(override, null, readCompiledComposerRoute(settings, agentId));
    const provider = settings.llm.providers.find(entry => entry.id === route?.providerId);
    if (!route || !provider || !isProviderExecutable(provider)) return 'unavailable';
    const state = resolveCatalogCapability(route, entries[catalogScopeKey(provider)]);
    return state.status === 'ready' || state.status === 'refreshing' ? 'available'
      : state.status === 'loading' ? 'loading' : 'unavailable';
  };
}
