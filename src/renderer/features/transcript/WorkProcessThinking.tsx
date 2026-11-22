import React from 'react';
import { MessageMarkdown } from '../../patterns/Markdown/MessageMarkdown';
import { ActiveSignalText } from '../../ui/ActiveSignalText';
import { Icon } from '../../ui/Icon';
import { Chevron } from '../../ui/Chevron';
import { useScopedWorkDisclosure } from './ScopedWorkDisclosure';
import { isActiveThinkingStatus } from './workProcessActiveSignal';
import type { WorkProcessRow } from './workProcessTypes';

type ThinkingRow = Extract<WorkProcessRow, { type: 'thinking' }>;

/** Shared disclosure for a thinking event, including historical section headers. */
export const WorkProcessThinking: React.FC<{ row: ThinkingRow }> = ({ row }) => {
  const active = isActiveThinkingStatus(row.thinkingStatus, row.status);
  const className = ['work-process-thinking-state', row.kind ? `kind-${row.kind}` : '',
    row.visibility ? `visibility-${row.visibility}` : '', row.thinkingStatus ? `status-${row.thinkingStatus}` : '']
    .filter(Boolean).join(' ');
  const [open, toggle] = useScopedWorkDisclosure(`thinking-${row.id}`, row.openByDefault);
  const label = <><Icon name="spark" className="work-process-icon work-process-thinking-icon" />
    <span className="work-row-title" data-text={row.label}><ActiveSignalText active={active} tone="info">{row.label}</ActiveSignalText></span></>;
  if (row.expandable) return <details className={className} open={open} data-locate>
    <summary className="work-process-thinking-summary" data-work-node-heading onClick={(event) => { event.preventDefault(); toggle(); }}>
      {label}<Chevron size={12} className="work-process-row-caret" />
    </summary>
    <div className="work-process-thinking-preview"><MessageMarkdown content={row.preview} deferHeavyPlugins={active} /></div>
  </details>;
  return row.label ? <p className={`${className} work-process-thinking-caption`} data-work-node-heading>{label}</p> : null;
};

export const WorkProcessThinkingRow: React.FC<{ row: ThinkingRow }> = ({ row }) => (
  <li className="work-process-step work-process-thinking-row" data-testid="work-process-thinking">
    <WorkProcessThinking row={row} />
  </li>
);
