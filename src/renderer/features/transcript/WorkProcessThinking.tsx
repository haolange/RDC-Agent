import React from 'react';
import { MessageMarkdown } from '../../patterns/Markdown/MessageMarkdown';
import { ActiveSignalText } from '../../ui/ActiveSignalText';
import { useScopedWorkDisclosure } from './ScopedWorkDisclosure';
import { isActiveThinkingStatus } from './workProcessActiveSignal';
import { WorkProcessIcon } from './WorkProcessIcons';
import type { WorkProcessRow } from './workProcessTypes';

type ThinkingRow = Extract<WorkProcessRow, { type: 'thinking' }>;

/** Shared disclosure for a thinking event, including historical section headers. */
export const WorkProcessThinking: React.FC<{ row: ThinkingRow }> = ({ row }) => {
  const active = isActiveThinkingStatus(row.thinkingStatus, row.status);
  const className = ['work-process-thinking-state', row.kind ? `kind-${row.kind}` : '',
    row.visibility ? `visibility-${row.visibility}` : '', row.thinkingStatus ? `status-${row.thinkingStatus}` : '']
    .filter(Boolean).join(' ');
  const [open, toggle] = useScopedWorkDisclosure(`thinking-${row.id}`, row.openByDefault);
  const label = <><WorkProcessIcon icon="spark" className="work-process-thinking-icon" />
    <ActiveSignalText active={active} tone="info">{row.label}</ActiveSignalText></>;
  const source = row.source ? <span className="work-process-thinking-source">{row.source}</span> : null;
  if (row.expandable) return <details className={className} open={open}>
    <summary className="work-process-thinking-summary" data-work-node-heading onClick={(event) => { event.preventDefault(); toggle(); }}>
      {label}{source}<span className="work-process-row-caret" aria-hidden="true" />
    </summary>
    <div className="work-process-thinking-preview"><MessageMarkdown content={row.preview} deferHeavyPlugins={active} /></div>
  </details>;
  return row.label ? <p className={`${className} work-process-thinking-caption`} data-work-node-heading>{label}{source}</p> : null;
};

export const WorkProcessThinkingRow: React.FC<{ row: ThinkingRow }> = ({ row }) => (
  <li className="work-process-step work-process-thinking-row" data-testid="work-process-thinking">
    <WorkProcessThinking row={row} />
  </li>
);
