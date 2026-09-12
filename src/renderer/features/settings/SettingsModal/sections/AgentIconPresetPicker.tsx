import React, { useRef, useState, type KeyboardEvent } from 'react';
import { AGENT_ICON_PRESETS } from '@shared/constants/agents';
import type { ModeIconKey } from '@shared/types/layout';
import { Button } from '../../../../ui/Button';
import { Icon } from '../../../../ui/Icon';
import { ModeGlyph } from '../../../../ui/ModeGlyph';
import { Popover } from '../../../../ui/Popover';
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
  const gridRef = useRef<HTMLDivElement>(null);

  const chooseIcon = (icon: ModeIconKey) => {
    onChange(icon);
    setOpen(false);
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : ['ArrowDown', 'ArrowRight'].includes(event.key) ? (current + 1 + items.length) % items.length
          : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? (current - 1 + items.length) % items.length
            : null;
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      className="settings-agent-icon-popover"
      trigger={(
        <Button variant="secondary" className="settings-agent-icon-trigger" aria-haspopup="menu">
          <ModeGlyph mode="ask" icon={value} size={16} strokeWidth={1.9} />
          <span>{t('settings.changeAgentIcon')}</span>
          <Icon name="chevron-down" size={14} />
        </Button>
      )}
    >
      <div className="settings-agent-icon-popover-title">{t('settings.chooseAgentIcon')}</div>
      <div
        ref={gridRef}
        className="settings-agent-icon-grid"
        role="menu"
        aria-label={t('settings.agentIcon')}
        onKeyDown={onGridKeyDown}
      >
        {AGENT_ICON_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`settings-agent-icon-option${value === preset.id ? ' is-selected' : ''}`}
            role="menuitemradio"
            aria-checked={value === preset.id}
            title={preset.label}
            onClick={() => chooseIcon(preset.id)}
          >
            <ModeGlyph mode="ask" icon={preset.id} size={18} strokeWidth={1.9} />
            {value === preset.id ? (
              <span className="settings-agent-icon-option-check" aria-hidden="true">
                <Icon name="check" size={12} />
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </Popover>
  );
};
