import React from 'react';
import type { ModelCapabilityProfile } from '@shared/types/modelCapability';
import type { LlmProviderModel } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { hasActiveCapabilityOverride } from '../modelCapabilityOverrideUtils';
import { ProviderModelCapabilityEditor } from './ProviderModelCapabilityEditor';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProviderConnectModelRowProps {
  model: LlmProviderModel;
  expanded: boolean;
  disabled?: boolean;
  onToggleExpanded: (modelId: string) => void;
  onCapabilityChange: (modelId: string, capabilityOverride: ModelCapabilityProfile | undefined) => void;
  t: Translate;
}

export const ProviderConnectModelRow: React.FC<ProviderConnectModelRowProps> = ({
  model,
  expanded,
  disabled = false,
  onToggleExpanded,
  onCapabilityChange,
  t,
}) => {
  const overrideActive = hasActiveCapabilityOverride(model);

  return (
    <div
      className={`settings-model-row${expanded ? ' settings-model-row--expanded' : ''}`}
      data-testid={`settings-provider-model-row-${model.id}`}
    >
      <div className="settings-model-row-main">
        <span className="settings-model-row-check">OK</span>
        <span className="settings-model-row-label">{model.label}</span>
        {overrideActive ? (
          <span className="settings-model-capability-badge" data-testid={`settings-provider-model-capability-badge-${model.id}`}>
            {t('settings.providers.capability.overrideActive')}
          </span>
        ) : null}
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
        <ProviderModelCapabilityEditor
          model={model}
          disabled={disabled}
          onChange={onCapabilityChange}
          t={t}
        />
      ) : null}
    </div>
  );
};
