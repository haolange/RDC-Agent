import { useEffect, useMemo } from 'react';
import { isProviderExecutable } from '@shared/utils/providerExecutionAvailability';
import { catalogScopeKey, useEffectiveCatalogStore } from '../../stores/effectiveCatalogStore';
import { isComposerPickerModel, toComposerPickerOption, type ComposerModelPickerOption } from './composerModelPicker';
import type { LlmProviderEntry } from '@shared/types/settings';

/** Why a connected provider has no (or only cached) executable models right now. */
export type ComposerPickerProviderNotice =
  | { kind: 'loading' }
  | { kind: 'failed'; error: string }
  | { kind: 'empty' };

export interface ComposerPickerProviderState {
  id: string;
  label: string;
  /** Executable models in catalog order; cached models stay listed while a refresh fails. */
  models: ComposerModelPickerOption[];
  notice: ComposerPickerProviderNotice | null;
  retrying: boolean;
}

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

/** Every connected provider in settings order, each with its executable models and its own status. */
export function useComposerModelPickerOptions(providers: readonly LlmProviderEntry[]): {
  options: ComposerModelPickerOption[];
  providerStates: ComposerPickerProviderState[];
  loading: boolean;
  retry: (providerId: string) => void;
} {
  const entries = useEffectiveCatalogStore((state) => state.entries);
  const resolved = useMemo(() => providers.filter(isProviderExecutable), [providers]);
  useEffect(() => {
    for (const provider of resolved) void useEffectiveCatalogStore.getState().load(provider);
  }, [resolved]);
  const providerStates = resolved.map((provider): ComposerPickerProviderState => {
    const entry = entries[catalogScopeKey(provider)];
    const models = entry?.snapshot?.models.filter(isComposerPickerModel)
      .map((model) => toComposerPickerOption(provider.id, provider.label, model)) ?? [];
    const pending = !entry || entry.loading || entry.snapshot?.refreshing === true;
    const notice: ComposerPickerProviderNotice | null = entry?.error
      ? { kind: 'failed', error: entry.error }
      : models.length > 0 ? null : pending ? { kind: 'loading' } : { kind: 'empty' };
    return { id: provider.id, label: provider.label, models, notice, retrying: entry?.loading === true };
  });
  return {
    options: providerStates.flatMap((state) => state.models),
    providerStates,
    loading: resolved.some((provider) => !entries[catalogScopeKey(provider)] || entries[catalogScopeKey(provider)].loading),
    retry: (providerId) => {
      const provider = resolved.find((entry) => entry.id === providerId);
      if (provider) void useEffectiveCatalogStore.getState().load(provider, true);
    },
  };
}
