import React from 'react';
import { EFFORT_LEVELS, type EffortLevel, type ModelCapabilityProfile } from '@shared/types/modelCapability';
import type { LlmProviderModel } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import {
  formatSeedContextPlaceholder,
  formatSeedEffortPlaceholder,
  formatSeedFastPlaceholder,
  getEffortLabelKey,
  hasActiveCapabilityOverride,
  normalizeCapabilityOverride,
} from '../modelCapabilityOverrideUtils';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProviderModelCapabilityEditorProps {
  model: LlmProviderModel;
  disabled?: boolean;
  onChange: (modelId: string, capabilityOverride: ModelCapabilityProfile | undefined) => void;
  t: Translate;
}

export const ProviderModelCapabilityEditor: React.FC<ProviderModelCapabilityEditorProps> = ({
  model,
  disabled = false,
  onChange,
  t,
}) => {
  const override = model.capabilityOverride;
  const contextValue = override?.nominalContextWindowTokens?.toString() ?? '';
  const fastValue = override?.fastVariantModelId ?? '';
  const selectedEffortLevels = new Set(override?.supportedEffortLevels ?? []);
  const seedEffortHint = formatSeedEffortPlaceholder(model.id, t);

  const updateOverride = (patch: Partial<ModelCapabilityProfile>) => {
    onChange(model.id, normalizeCapabilityOverride({ ...override, ...patch }));
  };

  const toggleEffortLevel = (level: EffortLevel) => {
    const nextLevels = new Set(selectedEffortLevels);
    if (nextLevels.has(level)) {
      nextLevels.delete(level);
    } else {
      nextLevels.add(level);
    }
    const supportedEffortLevels = EFFORT_LEVELS.filter((entry) => nextLevels.has(entry));
    updateOverride({
      supportedEffortLevels: supportedEffortLevels.length > 0 ? supportedEffortLevels : undefined,
    });
  };

  const handleClear = () => {
    onChange(model.id, undefined);
  };

  return (
    <div
      className="settings-model-capability-panel"
      data-testid={`settings-provider-model-capability-panel-${model.id}`}
    >
      <label className="settings-field settings-model-capability-field">
        <span className="settings-field-label">{t('settings.providers.capability.nominalContext')}</span>
        <input
          className="input"
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          disabled={disabled}
          value={contextValue}
          placeholder={formatSeedContextPlaceholder(model.id, t)}
          data-testid={`settings-provider-model-capability-context-${model.id}`}
          onChange={(event) => {
            const raw = event.target.value.trim();
            updateOverride({
              nominalContextWindowTokens: raw ? Number.parseInt(raw, 10) : undefined,
            });
          }}
        />
        <span className="settings-help-text">{t('settings.providers.capability.nominalContextHint')}</span>
      </label>

      <div className="settings-model-capability-field">
        <span className="settings-field-label">{t('settings.providers.capability.effortLevels')}</span>
        <div className="settings-model-capability-effort-list" role="group" aria-label={t('settings.providers.capability.effortLevels')}>
          {EFFORT_LEVELS.map((level) => {
            const checked = selectedEffortLevels.has(level);
            return (
              <label
                key={level}
                className={`settings-model-capability-effort-chip${checked ? ' selected' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  data-testid={`settings-provider-model-capability-effort-${level}-${model.id}`}
                  onChange={() => toggleEffortLevel(level)}
                />
                <span>{t(getEffortLabelKey(level))}</span>
              </label>
            );
          })}
        </div>
        <span className="settings-help-text">
          {t('settings.providers.capability.effortSeedHint', { levels: seedEffortHint })}
        </span>
      </div>

      <label className="settings-field settings-model-capability-field">
        <span className="settings-field-label">{t('settings.providers.capability.fastVariant')}</span>
        <input
          className="input"
          type="text"
          disabled={disabled}
          value={fastValue}
          placeholder={formatSeedFastPlaceholder(model.id, t)}
          data-testid={`settings-provider-model-capability-fast-${model.id}`}
          onChange={(event) => {
            const nextValue = event.target.value;
            updateOverride({
              fastVariantModelId: nextValue.trim() ? nextValue : undefined,
            });
          }}
        />
        <span className="settings-help-text">{t('settings.providers.capability.fastVariantHint')}</span>
      </label>

      {hasActiveCapabilityOverride(model) ? (
        <div className="settings-model-capability-actions">
          <button
            type="button"
            className="button button-ghost button-sm"
            disabled={disabled}
            data-testid={`settings-provider-model-capability-clear-${model.id}`}
            onClick={handleClear}
          >
            {t('settings.providers.capability.clearOverride')}
          </button>
        </div>
      ) : null}
    </div>
  );
};
