import React from 'react';
import { REASONING_SELECTIONS, type ReasoningSelection } from '@shared/types/modelCapability';
import { EFFORT_LABEL_KEYS, isReasoningLevelLabel } from '../../../../lib/reasoningLabels';
import { Select } from '../../../../ui/Select';
import { SettingsField } from '../parts';
import { useI18n } from '../../../../i18n';
import { AgentModelCascadeSelect } from './AgentModelCascadeSelect';
import { modelOptionLabel } from './agentConfigStatus';
import type { AgentModelBinding } from '@shared/types/settings';
import type { AgentModelOption } from '@shared/types/agentManifest';

/** The binding an Agent falls back to field by field when it has no value of its own. */
export interface AgentModelFallback {
  model?: string;
  reasoningLevel?: ReasoningSelection;
}

/** One field set (or cleared, with no value) on a binding. */
export type AgentModelFieldChange =
  { field: 'model'; value?: string } | { field: 'reasoningLevel'; value?: ReasoningSelection };

export interface AgentModelControlProps {
  binding: AgentModelBinding;
  options: AgentModelOption[];
  /** Present when an empty field means "use the default". Absent for the default itself. */
  fallback?: AgentModelFallback;
  onChange: (change: AgentModelFieldChange) => void;
}

/** The binding's model; with a fallback, the first choice follows the fallback model and clears the field. */
export const AgentModelSelect: React.FC<AgentModelControlProps> = ({ binding, options, fallback, onChange }) => {
  const { t } = useI18n();
  const fallbackModelLabel = modelOptionLabel(fallback?.model, options) ?? t('settings.agentModelNotSet');
  return (
    <AgentModelCascadeSelect
      value={binding.model ?? ''}
      options={options}
      followDefaultLabel={fallback ? t('settings.agentModelUseDefault', { model: fallbackModelLabel }) : undefined}
      onChange={(model) => onChange({ field: 'model', value: model || undefined })}
    />
  );
};

/** The binding's reasoning level, offering the levels its effective model lists. */
export const AgentReasoningSelect: React.FC<AgentModelControlProps & { testId: string }> = ({
  binding,
  options,
  fallback,
  onChange,
  testId,
}) => {
  const { t } = useI18n();
  const effectiveModel = binding.model ?? fallback?.model;
  const supported = options.find((option) => option.canonicalId === effectiveModel)?.reasoningSelections;
  // A saved level the current model does not list stays selectable; the status row reports it.
  const reasoningChoices = [
    ...new Set([
      ...(supported && supported.length > 0 ? supported : REASONING_SELECTIONS),
      ...(binding.reasoningLevel ? [binding.reasoningLevel] : []),
    ]),
  ];
  const levelLabel = (level: string): string => (isReasoningLevelLabel(level) ? t(EFFORT_LABEL_KEYS[level]) : level);
  return (
    <Select
      ariaLabel={t('settings.agentReasoningLevel')}
      dataTestId={testId}
      value={binding.reasoningLevel ?? ''}
      onChange={(value) =>
        onChange({ field: 'reasoningLevel', value: value ? (value as ReasoningSelection) : undefined })
      }
      options={[
        {
          value: '',
          label: !fallback
            ? t('settings.agentReasoningDefault')
            : fallback.reasoningLevel
              ? t('settings.agentReasoningUseDefault', { level: levelLabel(fallback.reasoningLevel) })
              : t('settings.agentReasoningFollowDefault'),
        },
        ...reasoningChoices.map((value) => ({ value, label: levelLabel(value) })),
      ]}
    />
  );
};

/** One Agent's model and reasoning level, each under its own label; an empty field uses the default. */
export const AgentModelBindingFields: React.FC<
  AgentModelControlProps & { fallback: AgentModelFallback; testIdPrefix: string }
> = ({ testIdPrefix, ...control }) => {
  const { t } = useI18n();
  return (
    <div className="settings-agent-route-grid">
      <SettingsField label={t('settings.modelFieldLabel')} className="settings-model-route-row">
        <AgentModelSelect {...control} />
      </SettingsField>
      <SettingsField label={t('settings.agentReasoningLevel')}>
        <AgentReasoningSelect {...control} testId={`${testIdPrefix}-reasoning-level`} />
      </SettingsField>
    </div>
  );
};
