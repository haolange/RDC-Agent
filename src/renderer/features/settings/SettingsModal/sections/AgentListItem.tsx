import React from 'react';
import type { AgentMode, ModeIconKey } from '@shared/types/layout';
import { ListRow } from '../../../../ui/ListRow';
import { ModeGlyph } from '../../../../ui/ModeGlyph';
import { OverflowFade } from '../../../../ui/OverflowFade';
import './AgentListItem.css';

interface AgentListItemProps {
  id: AgentMode;
  name: string;
  description: string;
  icon?: ModeIconKey;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/** Presentation only; scope, translated copy and selection remain parent-owned. */
export const AgentListItem: React.FC<AgentListItemProps> = ({
  id, name, description, icon, selected, disabled, onSelect,
}) => (
  <ListRow
    className="settings-agent-list-item"
    selected={selected}
    disabled={disabled}
    onClick={onSelect}
    leading={(
      <span className="settings-agent-list-item-icon" aria-hidden="true">
        <ModeGlyph mode={id} icon={icon ?? 'message-orbit'} size={18} strokeWidth={1.9} />
      </span>
    )}
  >
    <span className="settings-agent-list-item-copy">
      <span className="settings-agent-list-item-name" title={name}>{name}</span>
      <OverflowFade className="settings-agent-list-item-description" text={description} />
    </span>
  </ListRow>
);
