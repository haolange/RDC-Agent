import React from 'react';
import type { WorkProcessRow } from './workProcessTypes';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';
import { MessageMarkdown } from '../../patterns/Markdown/MessageMarkdown';
import { MeasuredWorkRows } from './MeasuredWorkRows';
import { WorkProcessThinking } from './WorkProcessThinking';

interface WorkProcessSectionRowProps {
  row: Extract<WorkProcessRow, { type: 'section' }>;
  renderRow: (row: WorkProcessRow) => React.ReactNode;
}

export const WorkProcessSectionRow: React.FC<WorkProcessSectionRowProps> = ({
  row,
  renderRow,
}) => {
  const hasError = row.status === 'error' || row.steps.some((step) => step.status === 'error');
  const visibleSteps = row.visibleSteps;
  const showSteps = visibleSteps.length > 0;
  const hasProse = Boolean(row.proseText);
  return (
    <li
      className={`work-process-step work-process-section kind-section status-${row.status}${hasProse || row.thinkingLabel || row.thinkingExpandable ? ' has-narrative' : ''}${hasProse ? ' has-prose' : ''}`}
      data-testid="work-process-section"
    >
      <WorkProcessRailIcon row={row} />
      <div className="work-process-step-content">
        {(row.thinkingExpandable || row.thinkingLabel) ? <WorkProcessThinking row={{
          type: 'thinking', id: row.id, status: row.status, duration: '', preview: row.thinkingPreview,
          label: row.thinkingLabel, kind: row.thinkingKind, source: row.thinkingSource,
          visibility: row.thinkingVisibility, thinkingStatus: row.thinkingStatus,
          expandable: row.thinkingExpandable, openByDefault: row.thinkingOpenByDefault,
        }} /> : null}
        {hasProse ? (
          <div className={`work-process-prose${row.proseStreaming ? ' is-streaming' : ''}`} data-work-node-prose>
            <MessageMarkdown content={row.proseText} deferHeavyPlugins={row.proseStreaming} />
          </div>
        ) : null}
        {showSteps ? (
          <MeasuredWorkRows className={`work-process-steps work-process-section-list ${hasError || row.defaultOpen ? 'is-open' : ''}`}
            rows={visibleSteps} renderRow={renderRow} />
        ) : null}
      </div>
    </li>
  );
};
