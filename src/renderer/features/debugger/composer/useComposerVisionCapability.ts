import { useEffect, useState } from 'react';
import type { SessionRecord } from '@shared/types/session';
import { getElectronApi } from '../../../platform/getElectronApi';
import { useComposerEffectiveModel } from './useComposerEffectiveModel';

export function useComposerVisionCapability(
  agentId: string,
  currentSession: SessionRecord | null,
): boolean {
  const { effective } = useComposerEffectiveModel(agentId, currentSession);
  const providerId = effective?.providerId;
  const modelId = effective?.modelId;
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    const api = getElectronApi();
    if (!api || !providerId || !modelId) {
      setSupported(false);
      return undefined;
    }
    let cancelled = false;
    void api.settings.getEffectiveCatalog(providerId).then((catalog) => {
      if (cancelled) return;
      const model = catalog?.models.find((entry) => entry.modelId === modelId);
      setSupported(model?.visionInput.state === 'supported');
    }).catch(() => {
      if (!cancelled) setSupported(false);
    });
    return () => {
      cancelled = true;
    };
  }, [providerId, modelId]);

  return supported;
}
