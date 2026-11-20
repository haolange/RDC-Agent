import { InlineError } from '../../../../ui/InlineError';
import { AgentModelBindingFields } from './AgentModelBindingFields';
import type { AgentModelBinding, AppSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

/** The model and reasoning level every Agent without its own setting runs with. */
export function AgentDefaultModelSection({ settings, error, onChange, t }: {
  settings: AppSettings;
  error: string | null;
  onChange: (binding: AgentModelBinding) => void;
  t: Translate;
}) {
  return (
    <section className="settings-agent-defaults" data-testid="settings-agent-default-model" aria-labelledby="settings-agent-defaults-title">
      <div className="settings-agent-defaults-copy">
        <h3 id="settings-agent-defaults-title" className="settings-agent-defaults-title">{t('settings.agentDefaultModelTitle')}</h3>
        <p className="settings-help-text">{t('settings.agentDefaultModelHint')}</p>
      </div>
      <AgentModelBindingFields
        binding={settings.agentModels.default}
        options={settings.agents.modelOptions}
        onChange={onChange}
        testIdPrefix="settings-agent-default"
        t={t}
      />
      {error ? <InlineError>{error}</InlineError> : null}
    </section>
  );
}
