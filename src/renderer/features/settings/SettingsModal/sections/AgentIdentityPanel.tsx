import React from 'react';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type { useI18n } from '../../../../i18n';
import { useDynStyle } from '../../../../lib/useDynStyle';
import { ColorField } from '../../../../ui/ColorField';
import { Input } from '../../../../ui/Input';
import { Textarea } from '../../../../ui/Textarea';
import { SettingsField } from '../parts';
import { AgentIconPresetPicker } from './AgentIconPresetPicker';

type Translate = ReturnType<typeof useI18n>['t'];

interface AgentIdentityPanelProps {
  agent: AgentManifestDraft;
  onUpdateAgent: (patch: Partial<AgentManifestDraft>) => void;
  t: Translate;
}

/** Identity & description: icon → accent → short name → argument hint → description. Autosaved. */
export const AgentIdentityPanel: React.FC<AgentIdentityPanelProps> = ({ agent, onUpdateAgent, t }) => {
  const accentStyle = useDynStyle({ '--settings-agent-accent': agent.accent || '#33d1ff' });
  return (
    <div className="settings-agent-identity-grid" data-testid="settings-agent-identity">
      <SettingsField label={t('settings.agentIcon')} layout="row">
        <div className="settings-agent-look-row" {...accentStyle}>
          <AgentIconPresetPicker
            value={agent.icon ?? 'message-orbit'}
            onChange={(icon) => onUpdateAgent({ icon })}
            t={t}
          />
        </div>
      </SettingsField>
      <SettingsField label={t('settings.agentAccent')} layout="row" help={t('settings.agentAccentHelp')}>
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
      <SettingsField label={t('settings.agentName')} layout="row">
        <Input className="settings-agent-name-input" value={agent.name} onChange={(event) => onUpdateAgent({ name: event.currentTarget.value })} />
      </SettingsField>
      <SettingsField label={t('settings.agentArgumentHint')} layout="row">
        <Textarea sizing="content" className="settings-agent-textarea-compact" value={agent.argumentHint} onChange={(event) => onUpdateAgent({ argumentHint: event.currentTarget.value })} />
      </SettingsField>
      <SettingsField label={t('settings.agentDescription')} layout="row">
        <Textarea sizing="content" className="settings-agent-textarea-compact settings-agent-description-field" value={agent.description} onChange={(event) => onUpdateAgent({ description: event.currentTarget.value })} />
      </SettingsField>
    </div>
  );
};
