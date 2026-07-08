import React, { useState } from 'react';
import { AGENT_ICON_PRESETS } from '@shared/constants/agents';
import type { ModeIconKey } from '@shared/types/layout';
import { ModeGlyph } from '../../../../ui/ModeGlyph';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

interface AgentIconPresetPickerProps {
  value: ModeIconKey;
  onChange: (value: ModeIconKey) => void;
  t: Translate;
}

export const AgentIconPresetPicker: React.FC<AgentIconPresetPickerProps> = ({
  value,
  onChange,
  t,
}) => {
  const [open, setOpen] = useState(false);

  const chooseIcon = (icon: ModeIconKey) => {
    onChange(icon);
    setOpen(false);
  };

  return (
    <div className="settings-agent-icon-picker" aria-label={t('settings.agentIcon')}>
      <button
        type="button"
        className="button button-secondary settings-agent-icon-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ModeGlyph mode="ask" icon={value} size={16} strokeWidth={1.9} />
        <span>{t('settings.changeAgentIcon')}</span>
      </button>
      {open ? (
        <div className="settings-agent-icon-popover" role="menu" aria-label={t('settings.agentIcon')}>
          {AGENT_ICON_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`settings-agent-icon-option ${value === preset.id ? 'active' : ''}`}
            role="menuitemradio"
            aria-checked={value === preset.id}
            title={preset.label}
            onClick={() => chooseIcon(preset.id)}
          >
            <ModeGlyph mode="ask" icon={preset.id} size={18} strokeWidth={1.9} />
          </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
