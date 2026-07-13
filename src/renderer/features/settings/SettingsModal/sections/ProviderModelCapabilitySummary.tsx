import React, { useEffect, useMemo, useState } from 'react';
import type { EffectiveCatalogSnapshot } from '@shared/types/providerCapability';
import type { LlmProviderEntry, LlmProviderModel } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { getElectronApi } from '../../../../platform/getElectronApi';
import { buildCapabilityChips, findEffectiveCapabilityModel } from '../modelCapabilitySummaryUtils';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProviderModelCapabilitySummaryProps {
  provider: Pick<LlmProviderEntry, 'id' | 'catalogOwnership'>;
  model: LlmProviderModel;
  t: Translate;
}

export const ProviderModelCapabilitySummary: React.FC<ProviderModelCapabilitySummaryProps> = ({ provider, model, t }) => {
  const [snapshot, setSnapshot] = useState<EffectiveCatalogSnapshot | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next = await getElectronApi()?.settings.getEffectiveCatalog(provider.id) ?? null;
      if (!cancelled) setSnapshot(next);
    };
    void load();
    const unsubscribe = getElectronApi()?.events.onEffectiveCatalogChanged((next) => {
      if (next.providerId === provider.id && !cancelled) setSnapshot(next);
    });
    return () => { cancelled = true; unsubscribe?.(); };
  }, [provider.id]);

  const effectiveModel = useMemo(() => findEffectiveCapabilityModel(snapshot, model.id), [snapshot, model.id]);
  const chips = buildCapabilityChips(effectiveModel, t);
  const evidence = effectiveModel?.provenance.at(-1);

  return (
    <div className="settings-model-capability-panel" data-testid={`settings-provider-model-capability-panel-${model.id}`}>
      <div className="settings-model-capability-grid">
        {chips.map((chip) => (
          <div key={chip.label} className="settings-model-capability-chip" data-tone={chip.tone ?? 'default'}>
            <span className="settings-model-capability-chip-label">{chip.label}</span>
            <span className="settings-model-capability-chip-value">{chip.value}</span>
          </div>
        ))}
      </div>
      <div className="settings-model-capability-source">
        {evidence
          ? t('settings.providers.capability.source', { kind: evidence.source, date: evidence.observedAt.slice(0, 10) })
          : t('settings.providers.capability.conservativeDefault')}
      </div>
      {effectiveModel?.unavailableReason ? (
        <div className="settings-model-capability-note">{effectiveModel.unavailableReason}</div>
      ) : provider.catalogOwnership === 'user-managed' && !effectiveModel ? (
        <div className="settings-model-capability-note">{t('settings.providers.capability.userManagedDetail')}</div>
      ) : null}
    </div>
  );
};
