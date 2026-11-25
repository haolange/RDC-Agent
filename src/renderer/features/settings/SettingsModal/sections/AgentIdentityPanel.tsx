import React from 'react';
import { useDynStyle } from '../../../../lib/useDynStyle';
import { ColorField } from '../../../../ui/ColorField';
import { Input } from '../../../../ui/Input';
import { Textarea } from '../../../../ui/Textarea';
import { SettingsField } from '../parts';
import { useI18n } from '../../../../i18n';
import { AgentIconPresetPicker } from './AgentIconPresetPicker';
import type { AgentManifestDraft } from '@shared/types/agentManifest';

interface AgentIdentityPanelProps {
  agent: AgentManifestDraft;
  onUpdateAgent: (patch: Partial<AgentManifestDraft>) => void;
}

/** Identity & description: icon → accent → short name → argument hint → description. Autosaved. */
export const AgentIdentityPanel: React.FC<AgentIdentityPanelProps> = ({ agent, onUpdateAgent }) => {
  const { t } = useI18n();
  const accentStyle = useDynStyle({ '--settings-agent-accent': agent.accent || '#33d1ff' });
  return (
    <div className="settings-agent-identity-grid" data-testid="settings-agent-identity">
      <SettingsField label={t('settings.agentIcon')} layout="row">
        <div className="settings-agent-look-row" {...accentStyle}>
          <AgentIconPresetPicker
            value={agent.icon ?? 'message-orbit'}
            onChange={(icon) => onUpdateAgent({ icon })}
          />
        </div>
      </SettingsField>
      <SettingsField label={t('settings.agentAccent')} layout="row" description={t('settings.agentAccentHelp')}>
        <ColorField
          className="settings-agent-accent-color"
          layout="inline"
          hideLabel
          label={t('settings.agentAccent')}
          areaLabel={t('settings.colorPickerArea')}
          hueLabel={t('settings.colorPickerHue')}
          pickerTitle={t('settings.colorPickerTitle')}
          currentLabel={t('settings.colorPickerCurrent')}
          value={agent.accent ?? '#33d1ff'}
          testId="settings-agent-accent"
          onChange={(accent) => onUpdateAgent({ accent })}
        />
      </SettingsField>
      <SettingsField label={t('settings.agentName')} htmlFor="settings-agent-name" layout="row">
        <Input id="settings-agent-name" className="settings-agent-name-input" value={agent.name} onChange={(event) => onUpdateAgent({ name: event.currentTarget.value })} />
      </SettingsField>
      <SettingsField label={t('settings.agentArgumentHint')} htmlFor="settings-agent-argument-hint" layout="row">
        <Textarea id="settings-agent-argument-hint" sizing="content" className="settings-agent-textarea-compact" value={agent.argumentHint} onChange={(event) => onUpdateAgent({ argumentHint: event.currentTarget.value })} />
      </SettingsField>
      <SettingsField label={t('settings.agentDescription')} htmlFor="settings-agent-description" layout="row">
        <Textarea id="settings-agent-description" sizing="content" className="settings-agent-textarea-compact settings-agent-description-field" value={agent.description} onChange={(event) => onUpdateAgent({ description: event.currentTarget.value })} />
      </SettingsField>
    </div>
  );
};
