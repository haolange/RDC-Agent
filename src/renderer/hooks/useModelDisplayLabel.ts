import { useEffectiveCatalogStore } from '../stores/effectiveCatalogStore';

/** The catalog's display name for a provider model ("GPT-6.1 Sol"), or the model id's last segment before the catalog loads. */
export function useModelDisplayLabel(providerId: string | undefined, modelId: string | undefined): string | undefined {
  return useEffectiveCatalogStore((state) => {
    if (!providerId || !modelId) return undefined;
    for (const entry of Object.values(state.entries)) {
      if (entry.snapshot?.providerId !== providerId) continue;
      const model = entry.snapshot.models.find((candidate) => candidate.modelId === modelId || candidate.aliases.includes(modelId));
      if (model?.label) return model.label;
    }
    return modelId.split('/').at(-1);
  });
}
