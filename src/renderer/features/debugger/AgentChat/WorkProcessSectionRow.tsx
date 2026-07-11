import React from 'react';
import { ActiveSignalText } from '../../../ui/ActiveSignalText';
import type { WorkProcessRow } from './workProcessPresentation';
import { useWorkProcessLabel } from './workProcessUseLabel';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';
import { isActiveThinkingStatus } from './workProcessActiveSignal';
import { MessageMarkdown } from './MessageMarkdown';
import { WorkProcessIcon } from './WorkProcessIcons';

interface WorkProcessSectionRowProps {
  row: Extract<WorkProcessRow, { type: 'section' }>;
  renderRow: (row: WorkProcessRow) => React.ReactNode;
}

export const WorkProcessSectionRow: React.FC<WorkProcessSectionRowProps> = ({
  row,
  renderRow,
}) => {
  const label = useWorkProcessLabel();
  const hasError = row.status === 'error' || row.steps.some((step) => step.status === 'error');
  const visibleSteps = row.visibleSteps;
  const showSteps = visibleSteps.length > 0;
  const hasProse = Boolean(row.proseText);
  const thinkingActive = isActiveThinkingStatus(row.thinkingStatus, row.status);
  const firstLineCaption = Boolean(row.thinkingExpandable || row.thinkingLabel) && !hasProse;
  const thinkingClassName = [
    'work-process-thinking-state',
    row.thinkingKind ? `kind-${row.thinkingKind}` : '',
    row.thinkingVisibility ? `visibility-${row.thinkingVisibility}` : '',
    row.thinkingStatus ? `status-${row.thinkingStatus}` : '',
  ].filter(Boolean).join(' ');

  const thinkingLabelNode = (
    <>
      <WorkProcessIcon icon="spark" className="work-process-thinking-icon" />
      <ActiveSignalText active={thinkingActive} tone="info">{label(row.thinkingLabel)}</ActiveSignalText>
    </>
  );

  return (
    <li
      className={`work-process-step work-process-section kind-section status-${row.status}${hasProse ? ' has-prose' : ''}${firstLineCaption ? ' first-line-caption' : ''}`}
      data-testid="work-process-section"
    >
      <WorkProcessRailIcon variant="section" status={row.status} />
      <div className="work-process-step-content">
        {row.thinkingExpandable ? (
          <details className={thinkingClassName} open={row.thinkingOpenByDefault}>
            <summary className="work-process-thinking-summary">
              {thinkingLabelNode}
              {row.thinkingSource ? <span className="work-process-thinking-source">{row.thinkingSource}</span> : null}
              <span className="work-process-row-caret" aria-hidden="true" />
            </summary>
            <div className="work-process-thinking-preview">{row.thinkingPreview}</div>
          </details>
        ) : row.thinkingLabel ? (
          <p className={`${thinkingClassName} work-process-thinking-caption`}>
            {thinkingLabelNode}
            {row.thinkingSource ? <span className="work-process-thinking-source">{row.thinkingSource}</span> : null}
          </p>
        ) : null}
        {hasProse ? (
          <div className={`work-process-prose${row.proseStreaming ? ' is-streaming' : ''}`}>
            <MessageMarkdown content={row.proseText} />
          </div>
        ) : null}
        {showSteps ? (
          <ol className={`work-process-steps work-process-section-list disclosure-${row.stepsDisclosure} ${hasError || row.defaultOpen ? 'is-open' : ''}`}>
            {visibleSteps.map((step) => renderRow(step))}
          </ol>
        ) : null}
      </div>
    </li>
  );
};
