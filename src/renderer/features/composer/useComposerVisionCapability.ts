import { useEffect } from 'react';
import type { SessionRecord } from '@shared/types/session';
import { useComposerEffectiveModel } from '../../hooks/useComposerEffectiveModel';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { catalogScopeKey, useEffectiveCatalogStore } from '../../stores/effectiveCatalogStore';

export function useComposerVisionCapability(agentId: string, currentSession: SessionRecord | null): boolean {
  const { effective } = useComposerEffectiveModel(agentId, currentSession);
  const provider = useAppSettingsStore((state) => state.settings.llm.providers.find((entry) => entry.id === effective?.providerId));
  const entry = useEffectiveCatalogStore((state) => provider ? state.entries[catalogScopeKey(provider)] : undefined);
  useEffect(() => { if (provider) void useEffectiveCatalogStore.getState().load(provider); }, [provider]);
  return entry?.snapshot?.models.find((model) => model.modelId === effective?.modelId)?.visionInput.state === 'supported';
}
