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
import { Select } from '../../../../ui/Select';
import { SettingsField, SettingsSection } from '../parts';
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
      <SettingsSection
        title={t('settings.agentRuntime')}
        description={t('settings.compactionThresholdHint')}
        data-testid="settings-agent-runtime-block"
      >
        <SettingsField label={t('settings.compactionThreshold')} search="compaction" testId="settings-compaction-threshold">
          <Select
            dataTestId="settings-compaction-threshold"
            ariaLabel={t('settings.compactionThreshold')}
            value={String(percent)}
            onChange={(value) => {
              void setCompactionThresholdPercent(Number(value));
            }}
            options={COMPACTION_PERCENT_OPTIONS.map((option) => ({
              value: String(option),
              label: t('settings.compactionThresholdPercent', { percent: option }),
            }))}
          />
        </SettingsField>
      </SettingsSection>
      <RuntimeScopePanel
        overview={overview}
        scope={scope}
        onScopeChange={onScopeChange}
        kinds={['policy']}
        onChanged={onChanged}
        editorPresentation="dialog"
      />
    </section>
  );
};
