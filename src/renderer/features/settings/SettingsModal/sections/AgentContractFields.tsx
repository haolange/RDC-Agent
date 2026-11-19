import React from 'react';
import {
  AGENT_ACCESS_CEILINGS,
  AGENT_COMPLETION_CONTRACTS,
  agentAccessCeiling,
  agentCompletionContract,
  type AgentAccessCeiling,
  type AgentCompletionContract,
  type AgentManifestDraft,
} from '@shared/types/agentManifest';
import type { useI18n } from '../../../../i18n';
import { REASONING_SELECTIONS, type ReasoningSelection } from '@shared/types/modelCapability';
import { Select } from '../../../../ui/Select';
import { SettingsField } from '../parts';

type Translate = ReturnType<typeof useI18n>['t'];

export const AgentContractFields: React.FC<{
  agent: AgentManifestDraft;
  onChange: (patch: Partial<AgentManifestDraft>) => void;
  t: Translate;
}> = ({ agent, onChange, t }) => (
  <div className="settings-agent-route-grid">
    <SettingsField label={t('settings.agentReasoningLevel')}>
      <Select
        ariaLabel={t('settings.agentReasoningLevel')}
        dataTestId="settings-agent-reasoning-level"
        value={agent.reasoningLevel ?? ''}
        onChange={(value) => onChange({ reasoningLevel: value ? value as ReasoningSelection : undefined })}
        options={[{ value: '', label: t('settings.agentReasoningDefault') }, ...REASONING_SELECTIONS.map((value) => ({ value, label: value }))]}
      />
    </SettingsField>
    <SettingsField label={t('settings.agentAccessCeiling')}>
      <Select
        ariaLabel={t('settings.agentAccessCeiling')}
        dataTestId="settings-agent-access-ceiling"
        value={agentAccessCeiling(agent)}
        onChange={(value) => onChange({ accessCeiling: value as AgentAccessCeiling })}
        options={AGENT_ACCESS_CEILINGS.map((value) => ({
          value,
          label: t(value === 'read-only'
            ? 'settings.agentAccessCeilingReadOnly'
            : value === 'workspace-write'
              ? 'settings.agentAccessCeilingWorkspaceWrite'
              : 'settings.agentAccessCeilingFull'),
        }))}
      />
    </SettingsField>
    <SettingsField label={t('settings.agentCompletionContract')}>
      <Select
        ariaLabel={t('settings.agentCompletionContract')}
        dataTestId="settings-agent-completion-contract"
        value={agentCompletionContract(agent)}
        onChange={(value) => onChange({ completionContract: value as AgentCompletionContract })}
        options={AGENT_COMPLETION_CONTRACTS.map((value) => ({
          value,
          label: t(value === 'investigation-report'
            ? 'settings.agentCompletionContractInvestigationReport'
            : 'settings.agentCompletionContractFinalAnswer'),
        }))}
      />
    </SettingsField>
  </div>
);
