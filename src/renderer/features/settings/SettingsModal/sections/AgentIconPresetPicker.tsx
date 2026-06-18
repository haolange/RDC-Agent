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

const VISIBLE_ICON_COUNT = 9;

export const AgentIconPresetPicker: React.FC<AgentIconPresetPickerProps> = ({
  value,
  onChange,
  t,
}) => {
  const [open, setOpen] = useState(false);
  const pinned = AGENT_ICON_PRESETS.slice(0, VISIBLE_ICON_COUNT);
  const selectedPreset = AGENT_ICON_PRESETS.find((preset) => preset.id === value);
  const visiblePresets = selectedPreset && !pinned.some((preset) => preset.id === value)
    ? [...pinned.slice(0, VISIBLE_ICON_COUNT - 1), selectedPreset]
    : pinned;
  const visibleIds = new Set(visiblePresets.map((preset) => preset.id));
  const overflowPresets = AGENT_ICON_PRESETS.filter((preset) => !visibleIds.has(preset.id));

  const chooseIcon = (icon: ModeIconKey) => {
    onChange(icon);
    setOpen(false);
  };

  return (
    <div className="settings-agent-icon-picker" aria-label={t('settings.agentIcon')}>
      <span className="settings-agent-icon-picker-label">{t('settings.agentIcon')}</span>
      <div className="settings-agent-icon-row" role="radiogroup" aria-label={t('settings.agentIcon')}>
        {visiblePresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`settings-agent-icon-option ${value === preset.id ? 'active' : ''}`}
            role="radio"
            aria-checked={value === preset.id}
            title={preset.label}
            onClick={() => chooseIcon(preset.id)}
          >
            <ModeGlyph mode="ask" icon={preset.id} size={18} strokeWidth={1.9} />
          </button>
        ))}
        {overflowPresets.length > 0 ? (
          <div className="settings-agent-icon-more">
            <button
              type="button"
              className={`settings-agent-icon-option settings-agent-icon-more-trigger ${open ? 'active' : ''}`}
              aria-haspopup="menu"
              aria-expanded={open}
              title="More icons"
              onClick={() => setOpen((current) => !current)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {open ? (
              <div className="settings-agent-icon-popover" role="menu">
                {overflowPresets.map((preset) => (
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
        ) : null}
      </div>
    </div>
  );
};
