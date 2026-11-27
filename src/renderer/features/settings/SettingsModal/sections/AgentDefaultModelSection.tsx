import { InlineError } from '../../../../ui/InlineError';
import { humanizeError } from '../../../../i18n/humanizeError';
import { SettingsField } from '../parts';
import { useI18n } from '../../../../i18n';
import { AgentModelBindingFields } from './AgentModelBindingFields';
import { DEFAULT_MODEL_TARGET, REVIEW_MODEL_TARGET, type useAgentModelControls } from './useAgentModelControls';
import type { AppSettings } from '@shared/types/settings';
import type { AgentModelOption } from '@shared/types/agentManifest';

/**
 * The model rows above the Agent list: the default every Agent without its own setting runs with, and the model the
 * auto-review runs with, which follows the default field by field until set.
 */
export function AgentDefaultModelSection({
  settings,
  modelOptions,
  models,
}: {
  settings: AppSettings;
  modelOptions: AgentModelOption[];
  models: Pick<ReturnType<typeof useAgentModelControls>, 'modelError' | 'setDefaultField' | 'setReviewField'>;
}) {
  const { t } = useI18n();
  const errorFor = (target: string) => (models.modelError?.target === target ? models.modelError.message : null);
  const error = errorFor(DEFAULT_MODEL_TARGET);
  const reviewError = errorFor(REVIEW_MODEL_TARGET);
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
          onChange={models.setDefaultField}
          testIdPrefix="settings-agent-default"
        />
      </SettingsField>
      {error ? (
        <InlineError detail={error}>{humanizeError(error, t, 'settings.agentModelSaveFailed')}</InlineError>
      ) : null}
      <SettingsField
        layout="row"
        label={t('settings.agentReviewModelTitle')}
        description={t('settings.agentReviewModelHint')}
      >
        <AgentModelBindingFields
          binding={settings.agentModels.review ?? {}}
          fallback={settings.agentModels.default}
          options={modelOptions}
          onChange={models.setReviewField}
          testIdPrefix="settings-agent-review"
        />
      </SettingsField>
      {reviewError ? (
        <InlineError detail={reviewError}>{humanizeError(reviewError, t, 'settings.agentModelSaveFailed')}</InlineError>
      ) : null}
    </div>
  );
}
