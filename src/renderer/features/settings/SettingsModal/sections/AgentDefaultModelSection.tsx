import { useId } from 'react';
import { InlineError } from '../../../../ui/InlineError';
import { humanizeError } from '../../../../i18n/humanizeError';
import { SettingsFieldCopy } from '../parts';
import { useI18n } from '../../../../i18n';
import { AgentModelSelect, AgentReasoningSelect, type AgentModelControlProps } from './AgentModelBindingFields';
import { DEFAULT_MODEL_TARGET, REVIEW_MODEL_TARGET, type useAgentModelControls } from './useAgentModelControls';
import type { AppSettings } from '@shared/types/settings';
import type { AgentModelOption } from '@shared/types/agentManifest';

/**
 * The model routes above the Agent list: the default every Agent without its own setting runs with, and the model the
 * auto-review runs with, which follows the default field by field until set. Both rows share one grid, so their
 * pickers line up under a single pair of column labels.
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
  return (
    <div className="settings-agent-defaults" data-testid="settings-agent-default-model">
      <div className="settings-agent-defaults-head" aria-hidden="true">
        <span>{t('settings.modelFieldLabel')}</span>
        <span>{t('settings.agentReasoningLevel')}</span>
      </div>
      <AgentModelRouteRow
        title={t('settings.agentDefaultModelTitle')}
        description={t('settings.agentDefaultModelHint')}
        binding={settings.agentModels.default}
        options={modelOptions}
        onChange={models.setDefaultField}
        error={errorFor(DEFAULT_MODEL_TARGET)}
        testIdPrefix="settings-agent-default"
      />
      <AgentModelRouteRow
        title={t('settings.agentReviewModelTitle')}
        description={t('settings.agentReviewModelHint')}
        binding={settings.agentModels.review ?? {}}
        fallback={settings.agentModels.default}
        options={modelOptions}
        onChange={models.setReviewField}
        error={errorFor(REVIEW_MODEL_TARGET)}
        testIdPrefix="settings-agent-review"
      />
    </div>
  );
}

/** One route: its label and description, then its model and reasoning level in the shared columns. */
function AgentModelRouteRow({
  title,
  description,
  error,
  testIdPrefix,
  ...control
}: AgentModelControlProps & { title: string; description: string; error: string | null; testIdPrefix: string }) {
  const { t } = useI18n();
  const titleId = useId();
  return (
    <div className="settings-agent-defaults-row" role="group" aria-labelledby={titleId}>
      <SettingsFieldCopy labelId={titleId} label={title} description={description} />
      <AgentModelSelect {...control} />
      <AgentReasoningSelect {...control} testId={`${testIdPrefix}-reasoning-level`} />
      {error ? (
        <InlineError className="settings-agent-defaults-error" detail={error}>
          {humanizeError(error, t, 'settings.agentModelSaveFailed')}
        </InlineError>
      ) : null}
    </div>
  );
}
