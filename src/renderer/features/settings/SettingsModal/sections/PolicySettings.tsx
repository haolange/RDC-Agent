import React from 'react';
import type { RdxRuntimeOverview } from '@shared/types/rdxRuntime';
import {
  CONTEXT_COMPACTION_PERCENT_MAX,
  CONTEXT_COMPACTION_PERCENT_MIN,
  CONTEXT_COMPACTION_PERCENT_STEP,
} from '@shared/types/modelCapability';
import { useI18n } from '../../../../i18n';
import { useAppSettingsStore } from '../../../../stores/appSettingsStore';
import { DEFAULT_SETTINGS } from '../../../../stores/defaultAppSettings';
import { RuntimeScopePanel } from './RuntimeScopePanel';

const COMPACTION_PERCENT_OPTIONS: number[] = (() => {
  const options: number[] = [];
  for (
    let percent = CONTEXT_COMPACTION_PERCENT_MIN;
    percent <= CONTEXT_COMPACTION_PERCENT_MAX;
    percent += CONTEXT_COMPACTION_PERCENT_STEP
  ) {
    options.push(percent);
  }
  return options;
})();

export const PolicySettings: React.FC<{
  overview: RdxRuntimeOverview | null;
  scope: 'user' | 'project';
  onScopeChange: (scope: 'user' | 'project') => void;
  onChanged: (overview: RdxRuntimeOverview) => void;
}> = ({ overview, scope, onScopeChange, onChanged }) => {
  const { t } = useI18n();
  const percent = useAppSettingsStore(
    (state) => state.settings.agentRuntime.context?.compactionThresholdPercent
      ?? DEFAULT_SETTINGS.agentRuntime.context.compactionThresholdPercent,
  );
  const setCompactionThresholdPercent = useAppSettingsStore(
    (state) => state.setCompactionThresholdPercent,
  );

  return (
    <section className="settings-page settings-page-policy" data-settings-search="policy">
      <div className="settings-browser-block settings-tool-card" data-testid="settings-agent-runtime-block">
        <div className="settings-browser-section-head">
          <div>
            <div className="settings-browser-section-title">{t('settings.agentRuntime')}</div>
            <div className="settings-help-text">{t('settings.compactionThresholdHint')}</div>
          </div>
        </div>
        <label className="settings-field" data-settings-search="compaction">
          <span className="settings-field-label">{t('settings.compactionThreshold')}</span>
          <select
            className="input"
            value={percent}
            data-testid="settings-compaction-threshold"
            onChange={(event) => {
              void setCompactionThresholdPercent(Number(event.currentTarget.value));
            }}
          >
            {COMPACTION_PERCENT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {t('settings.compactionThresholdPercent', { percent: option })}
              </option>
            ))}
          </select>
        </label>
      </div>
      <RuntimeScopePanel
        overview={overview}
        scope={scope}
        onScopeChange={onScopeChange}
        kinds={['policy']}
        onChanged={onChanged}
      />
    </section>
  );
};
