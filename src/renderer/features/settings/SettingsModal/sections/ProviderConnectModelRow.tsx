import React from 'react';
import type { LlmProviderEntry, LlmProviderModel } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { ProviderModelCapabilitySummary } from './ProviderModelCapabilitySummary';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProviderConnectModelRowProps {
  provider: Pick<LlmProviderEntry, 'id' | 'catalogOwnership'>;
  model: LlmProviderModel;
  expanded: boolean;
  disabled?: boolean;
  onToggleExpanded: (modelId: string) => void;
  t: Translate;
}

export const ProviderConnectModelRow: React.FC<ProviderConnectModelRowProps> = ({
  provider,
  model,
  expanded,
  disabled = false,
  onToggleExpanded,
  t,
}) => {
  const isUnavailable = model.enabled === false;
  const statusLabel = isUnavailable
    ? t('settings.providers.modelUnavailable')
    : t('settings.providers.modelAvailable');
  const statusTitle = isUnavailable
    ? (model.availabilityReason || t('settings.providers.modelUnavailableReason'))
    : undefined;

  return (
    <div
      className={`settings-model-row${expanded ? ' settings-model-row--expanded' : ''}${isUnavailable ? ' settings-model-row--disabled' : ''}`}
      data-testid={`settings-provider-model-row-${model.id}`}
      aria-disabled={isUnavailable}
    >
      <div className="settings-model-row-main">
        <span className="settings-model-row-check" title={statusTitle}>{statusLabel}</span>
        <span className="settings-model-row-label" title={model.label}>{model.label}</span>
        <span className="settings-model-capability-badge" data-testid={`settings-provider-model-capability-badge-${model.id}`}>
          {provider.catalogOwnership === 'app-managed'
            ? t('settings.providers.capability.appManagedBadge')
            : t('settings.providers.capability.userManagedBadge')}
        </span>
        <button
          type="button"
          className="button button-ghost button-sm settings-model-capability-toggle"
          aria-expanded={expanded}
          disabled={disabled}
          data-testid={`settings-provider-model-capability-toggle-${model.id}`}
          onClick={() => onToggleExpanded(model.id)}
        >
          <span className="settings-model-capability-toggle-label">{t('settings.providers.capability.toggle')}</span>
          <svg
            className={`settings-model-capability-chevron${expanded ? ' expanded' : ''}`}
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
      {expanded ? (
        <ProviderModelCapabilitySummary
          provider={provider}
          model={model}
          t={t}
        />
      ) : null}
    </div>
  );
};
