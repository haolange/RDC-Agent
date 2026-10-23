import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type { useI18n } from '../../../../i18n';
import { Input } from '../../../../ui/Input';
import { SettingsField } from '../parts';

export function AgentExecutionLimitField({ agent, onUpdateAgent, t }: {
  agent: AgentManifestDraft;
  onUpdateAgent: (patch: Partial<AgentManifestDraft>) => void;
  t: ReturnType<typeof useI18n>['t'];
}) {
  return (
    <SettingsField label={t('settings.agentMaxTurns')} help={t('settings.agentMaxTurnsHelp')}>
      <Input
        key={`${agent.id}:${agent.maxTurns ?? 'default'}`}
        type="number"
        min={1}
        step={1}
        aria-label={t('settings.agentMaxTurns')}
        placeholder={t('settings.agentMaxTurnsDefault')}
        defaultValue={agent.maxTurns ?? ''}
        onBlur={(event) => {
          const value = event.currentTarget.value;
          const count = Number(value);
          if (value === '') onUpdateAgent({ maxTurns: undefined });
          else if (Number.isSafeInteger(count) && count > 0) onUpdateAgent({ maxTurns: count });
          else event.currentTarget.value = String(agent.maxTurns ?? '');
        }}
      />
    </SettingsField>
  );
}
