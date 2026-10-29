import { useEffect, useMemo } from 'react';
import type { LlmProviderEntry } from '@shared/types/settings';
import { isProviderExecutable } from '@shared/utils/providerExecutionAvailability';
import { catalogScopeKey, useEffectiveCatalogStore } from '../../stores/effectiveCatalogStore';
import { isComposerPickerModel, toComposerPickerOption, type ComposerModelPickerOption } from './composerModelPicker';

export async function loadComposerModelPickerOptions(
  providers: readonly LlmProviderEntry[],
): Promise<ComposerModelPickerOption[]> {
  const rows = await Promise.all(providers
    .filter(isProviderExecutable)
    .map(async (provider) => {
      const catalog = await useEffectiveCatalogStore.getState().load(provider);
      return catalog?.models.filter(isComposerPickerModel)
        .map((model) => toComposerPickerOption(provider.id, provider.label, model)) ?? [];
    }));
  return rows.flat();
}

export function useComposerModelPickerOptions(
  providers: readonly LlmProviderEntry[],
): { options: ComposerModelPickerOption[]; loading: boolean; failedProviders: { id: string; label: string; error: string }[]; retry: (providerId: string) => void } {
  const entries = useEffectiveCatalogStore((state) => state.entries);
  const resolved = useMemo(() => providers.filter(isProviderExecutable), [providers]);
  useEffect(() => {
    for (const provider of resolved) void useEffectiveCatalogStore.getState().load(provider);
  }, [resolved]);
  return {
    options: resolved.flatMap((provider) => entries[catalogScopeKey(provider)]?.snapshot?.models
      .filter(isComposerPickerModel).map((model) => toComposerPickerOption(provider.id, provider.label, model)) ?? []),
    loading: resolved.some((provider) => !entries[catalogScopeKey(provider)] || entries[catalogScopeKey(provider)].loading),
    failedProviders: resolved.flatMap((provider) => {
      const error = entries[catalogScopeKey(provider)]?.error;
      return error ? [{ id: provider.id, label: provider.label, error }] : [];
    }),
    retry: (providerId) => {
      const provider = resolved.find((entry) => entry.id === providerId);
      if (provider) void useEffectiveCatalogStore.getState().load(provider, true);
    },
  };
}
