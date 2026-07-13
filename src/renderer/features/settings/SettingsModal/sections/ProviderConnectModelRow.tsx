import React from 'react';
import type { LlmProviderEntry, LlmProviderModel } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { Switch } from '../../../../ui/Switch';
import { ProviderModelCapabilitySummary } from './ProviderModelCapabilitySummary';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProviderConnectModelRowProps {
  provider: Pick<LlmProviderEntry, 'id' | 'catalogOwnership' | 'activeAccountId' | 'protocol' | 'isConfigured'>;
  model: LlmProviderModel;
  expanded: boolean;
  disabled?: boolean;
  onToggleExpanded: (modelId: string) => void;
  onModelChange: (modelId: string, patch: Partial<LlmProviderModel>) => void;
  t: Translate;
}

export const ProviderConnectModelRow: React.FC<ProviderConnectModelRowProps> = ({
  provider,
  model,
  expanded,
  disabled = false,
  onToggleExpanded,
  onModelChange,
  t,
}) => {
  const isUnavailable = model.availability === 'unavailable';
  const isUnverified = model.availability === 'unknown';
  const statusLabel = isUnavailable
    ? t('settings.providers.modelUnavailable')
    : !model.enabled
      ? t('settings.providers.modelDisabled')
      : isUnverified
        ? t('settings.providers.modelUnverified')
        : t('settings.providers.modelAvailable');
  const statusTitle = isUnavailable
    ? (model.availabilityReason || t('settings.providers.modelUnavailableReason'))
    : undefined;

  return (
    <div
      className={`settings-model-row${expanded ? ' settings-model-row--expanded' : ''}${isUnavailable || !model.enabled ? ' settings-model-row--disabled' : ''}${isUnverified ? ' settings-model-row--unverified' : ''}`}
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
        <Switch
          checked={model.enabled}
          disabled={disabled || isUnavailable}
          onCheckedChange={(enabled) => onModelChange(model.id, { enabled })}
          aria-label={t('settings.providers.capability.modelEnabled', { model: model.label })}
        />
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
          onModelChange={(patch) => onModelChange(model.id, patch)}
          t={t}
        />
      ) : null}
    </div>
  );
};
