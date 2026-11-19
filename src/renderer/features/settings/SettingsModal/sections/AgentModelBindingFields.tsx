import React from 'react';
import { REASONING_SELECTIONS, type ReasoningSelection } from '@shared/types/modelCapability';
import { Select } from '../../../../ui/Select';
import { SettingsField } from '../parts';
import { AgentModelCascadeSelect } from './AgentModelCascadeSelect';
import { modelOptionLabel } from './agentConfigStatus';
import type { useI18n } from '../../../../i18n';
import type { AgentModelBinding } from '@shared/types/settings';
import type { AgentModelOption } from '@shared/types/agentManifest';

type Translate = ReturnType<typeof useI18n>['t'];

/** The binding an Agent falls back to field by field when it has no value of its own. */
export interface AgentModelFallback {
  model?: string;
  reasoningLevel?: ReasoningSelection;
}

interface AgentModelBindingFieldsProps {
  binding: AgentModelBinding;
  options: AgentModelOption[];
  /** Present for one Agent: an empty field means "use the default". Absent for the default itself. */
  fallback?: AgentModelFallback;
  onChange: (binding: AgentModelBinding) => void;
  testIdPrefix: string;
  t: Translate;
}

/** Model and reasoning level, edited together so each field can be set or left to the fallback. */
export const AgentModelBindingFields: React.FC<AgentModelBindingFieldsProps> = ({
  binding,
  options,
  fallback,
  onChange,
  testIdPrefix,
  t,
}) => {
  const effectiveModel = binding.model ?? fallback?.model;
  const supported = options.find((option) => option.canonicalId === effectiveModel)?.reasoningSelections;
  // A saved level the current model does not list stays selectable; the status row reports it.
  const reasoningChoices = [...new Set([
    ...(supported && supported.length > 0 ? supported : REASONING_SELECTIONS),
    ...(binding.reasoningLevel ? [binding.reasoningLevel] : []),
  ])];
  const fallbackModelLabel = modelOptionLabel(fallback?.model, options) ?? t('settings.agentModelNotSet');
  const fallbackReasoningLabel = fallback?.reasoningLevel ?? t('settings.agentReasoningDefault');
  const update = (patch: AgentModelBinding) => {
    const next = { ...binding, ...patch };
    onChange({
      ...(next.model ? { model: next.model } : {}),
      ...(next.reasoningLevel ? { reasoningLevel: next.reasoningLevel } : {}),
    });
  };

  return (
    <div className="settings-agent-route-grid">
      <SettingsField label={t('settings.modelFieldLabel')} className="settings-model-route-row">
        <AgentModelCascadeSelect
          value={binding.model ?? ''}
          options={options}
          inherit={fallback ? {
            label: t('settings.agentModelUseDefault', { model: fallbackModelLabel }),
            description: t('settings.agentModelUseDefaultHint'),
          } : undefined}
          onChange={(model) => update({ model: model || undefined })}
          t={t}
        />
      </SettingsField>
      <SettingsField label={t('settings.agentReasoningLevel')}>
        <Select
          ariaLabel={t('settings.agentReasoningLevel')}
          dataTestId={`${testIdPrefix}-reasoning-level`}
          value={binding.reasoningLevel ?? ''}
          onChange={(value) => update({ reasoningLevel: value ? value as ReasoningSelection : undefined })}
          options={[
            {
              value: '',
              label: fallback
                ? t('settings.agentReasoningUseDefault', { level: fallbackReasoningLabel })
                : t('settings.agentReasoningDefault'),
            },
            ...reasoningChoices.map((value) => ({ value, label: value })),
          ]}
        />
      </SettingsField>
    </div>
  );
};
