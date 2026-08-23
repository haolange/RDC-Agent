import { useEffect, useRef, useState } from 'react';
import type { LlmProviderEntry } from '@shared/types/settings';
import { getElectronApi } from '../../../platform/getElectronApi';
import {
  isComposerPickerModel,
  toComposerPickerOption,
  type ComposerModelPickerOption,
} from './composerModelPicker';

function pickerProviderKey(
  providers: readonly LlmProviderEntry[],
  routeProviderId?: string,
): string {
  return providers
    .filter((provider) => provider.enabled !== false || provider.id === routeProviderId)
    .map((provider) => `${provider.id}:${provider.activeAccountId ?? ''}`)
    .sort()
    .join('|');
}

export function useComposerModelPickerOptions(
  providers: readonly LlmProviderEntry[],
  routeProviderId?: string,
): { options: ComposerModelPickerOption[]; loading: boolean } {
  const [options, setOptions] = useState<ComposerModelPickerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const providersRef = useRef(providers);
  providersRef.current = providers;
  const providerKey = pickerProviderKey(providers, routeProviderId);

  useEffect(() => {
    const api = getElectronApi();
    if (!api) {
      setOptions([]);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    void (async () => {
      const settings = await api.settings.get().catch(() => null);
      const source = settings?.llm.providers?.length ? settings.llm.providers : providersRef.current;
      const resolved = source.filter((provider) => (
        provider.enabled !== false || provider.id === routeProviderId
      ));
      const rows = await Promise.allSettled(resolved.map(async (provider) => {
        const catalog = await api.settings.getEffectiveCatalog(provider.id, provider.activeAccountId);
        if (!catalog) return [] as ComposerModelPickerOption[];
        return catalog.models
          .filter(isComposerPickerModel)
          .map((model) => toComposerPickerOption(provider.id, provider.label, model));
      }));
      if (cancelled) return;
      setOptions(rows.flatMap((row) => (row.status === 'fulfilled' ? row.value : [])));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [providerKey, routeProviderId]);

  return { options, loading };
}
