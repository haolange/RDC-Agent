import { InlineError } from '../../../../ui/InlineError';
import { humanizeError } from '../../../../i18n/humanizeError';
import { SettingsField } from '../parts';
import { useI18n } from '../../../../i18n';
import { AgentModelBindingFields, type AgentModelFieldChange } from './AgentModelBindingFields';
import type { AppSettings } from '@shared/types/settings';
import type { AgentModelOption } from '@shared/types/agentManifest';

/** The model and reasoning level every Agent without its own setting runs with: an ordinary settings row. */
export function AgentDefaultModelSection({
  settings,
  modelOptions,
  error,
  onChange,
}: {
  settings: AppSettings;
  modelOptions: AgentModelOption[];
  error: string | null;
  onChange: (change: AgentModelFieldChange) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="settings-agent-defaults" data-testid="settings-agent-default-model">
      <SettingsField
        layout="row"
        label={t('settings.agentDefaultModelTitle')}
        description={t('settings.agentDefaultModelHint')}
      >
        <AgentModelBindingFields
          binding={settings.agentModels.default}
          options={modelOptions}
          onChange={onChange}
          testIdPrefix="settings-agent-default"
        />
      </SettingsField>
      {error ? (
        <InlineError detail={error}>{humanizeError(error, t, 'settings.agentModelSaveFailed')}</InlineError>
      ) : null}
    </div>
  );
}
