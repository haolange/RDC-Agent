import { useEffect, useState } from 'react';
import type { LlmProviderEntry } from '@shared/types/settings';
import { getElectronApi } from '../../../platform/getElectronApi';
import {
  isComposerPickerModel,
  toComposerPickerOption,
  type ComposerModelPickerOption,
} from './composerModelPicker';

export function useComposerModelPickerOptions(
  providers: readonly LlmProviderEntry[],
  routeProviderId?: string,
): { options: ComposerModelPickerOption[]; loading: boolean } {
  const [options, setOptions] = useState<ComposerModelPickerOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const api = getElectronApi();
    if (!api) {
      setOptions([]);
      setLoading(false);
      return undefined;
    }
    const targets = providers.filter((provider) => (
      provider.enabled !== false || provider.id === routeProviderId
    ));
    if (targets.length === 0) {
      setOptions([]);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    void Promise.all(targets.map(async (provider) => {
      const catalog = await api.settings.getEffectiveCatalog(provider.id, provider.activeAccountId);
      if (!catalog) return [] as ComposerModelPickerOption[];
      return catalog.models
        .filter(isComposerPickerModel)
        .map((model) => toComposerPickerOption(provider.id, provider.label, model));
    })).then((rows) => {
      if (cancelled) return;
      setOptions(rows.flat());
      setLoading(false);
    }).catch(() => {
      if (!cancelled) {
        setOptions([]);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [providers, routeProviderId]);

  return { options, loading };
}
