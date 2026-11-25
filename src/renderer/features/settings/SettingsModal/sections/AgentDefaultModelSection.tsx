import { InlineError } from '../../../../ui/InlineError';
import { humanizeError } from '../../../../i18n/humanizeError';
import { SettingsField } from '../parts';
import { AgentModelBindingFields, type AgentModelFieldChange } from './AgentModelBindingFields';
import type { AppSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

/** The model and reasoning level every Agent without its own setting runs with: an ordinary settings row. */
export function AgentDefaultModelSection({ settings, error, onChange, t }: {
  settings: AppSettings;
  error: string | null;
  onChange: (change: AgentModelFieldChange) => void;
  t: Translate;
}) {
  return (
    <div className="settings-agent-defaults" data-testid="settings-agent-default-model">
      <SettingsField layout="row" label={t('settings.agentDefaultModelTitle')} description={t('settings.agentDefaultModelHint')}>
        <AgentModelBindingFields
          binding={settings.agentModels.default}
          options={settings.agents.modelOptions}
          onChange={onChange}
          testIdPrefix="settings-agent-default"
          t={t}
        />
      </SettingsField>
      {error ? <InlineError detail={error}>{humanizeError(error, t, 'settings.agentModelSaveFailed')}</InlineError> : null}
    </div>
  );
}
