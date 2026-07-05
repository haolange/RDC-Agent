import React from 'react';
import type { LlmProviderEntry, LlmProviderModel } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import {
  buildCapabilityChips,
  findManagedCapabilityEntry,
} from '../modelCapabilitySummaryUtils';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProviderModelCapabilitySummaryProps {
  provider: Pick<LlmProviderEntry, 'id' | 'catalogOwnership'>;
  model: LlmProviderModel;
  t: Translate;
}

const getSourceKindLabel = (
  kind: NonNullable<ReturnType<typeof findManagedCapabilityEntry>>['source']['kind'],
  t: Translate,
): string => {
  if (kind === 'official') {
    return t('settings.providers.capability.sourceKind.official');
  }
  if (kind === 'observed') {
    return t('settings.providers.capability.sourceKind.observed');
  }
  return t('settings.providers.capability.sourceKind.conservative');
};

export const ProviderModelCapabilitySummary: React.FC<ProviderModelCapabilitySummaryProps> = ({
  provider,
  model,
  t,
}) => {
  const entry = findManagedCapabilityEntry(provider.id, provider.catalogOwnership, model.id);
  const chips = buildCapabilityChips(entry, t);

  if (provider.catalogOwnership === 'user-managed') {
    return (
      <div
        className="settings-model-capability-panel"
        data-testid={`settings-provider-model-capability-panel-${model.id}`}
      >
        <div className="settings-model-capability-note">
          {t('settings.providers.capability.userManagedDetail')}
        </div>
      </div>
    );
  }

  return (
    <div
      className="settings-model-capability-panel"
      data-testid={`settings-provider-model-capability-panel-${model.id}`}
    >
      <div className="settings-model-capability-grid">
        {chips.map((chip) => (
          <div
            key={chip.label}
            className="settings-model-capability-chip"
            data-tone={chip.tone ?? 'default'}
          >
            <span className="settings-model-capability-chip-label">{chip.label}</span>
            <span className="settings-model-capability-chip-value">{chip.value}</span>
          </div>
        ))}
      </div>
      <div className="settings-model-capability-source">
        {entry
          ? t('settings.providers.capability.source', {
            kind: getSourceKindLabel(entry.source.kind, t),
            date: entry.source.updatedAt,
          })
          : t('settings.providers.capability.conservativeDefault')}
      </div>
      {entry?.source.note ? (
        <div className="settings-model-capability-note">
          {entry.source.note}
        </div>
      ) : null}
    </div>
  );
};
