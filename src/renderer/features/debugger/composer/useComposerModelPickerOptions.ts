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

export async function loadComposerModelPickerOptions(
  providers: readonly LlmProviderEntry[],
  routeProviderId?: string,
): Promise<ComposerModelPickerOption[]> {
  const api = getElectronApi();
  if (!api) return [];
  const settings = await api.settings.get().catch(() => null);
  const source = settings?.llm.providers?.length ? settings.llm.providers : providers;
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
  return rows.flatMap((row) => (row.status === 'fulfilled' ? row.value : []));
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
    let cancelled = false;
    setLoading(true);
    void loadComposerModelPickerOptions(providersRef.current, routeProviderId).then((next) => {
      if (cancelled) return;
      setOptions(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [providerKey, routeProviderId]);

  return { options, loading };
}
