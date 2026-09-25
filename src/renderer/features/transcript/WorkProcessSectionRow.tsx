import React from 'react';
import { ActiveSignalText } from '../../ui/ActiveSignalText';
import type { WorkProcessRow } from './workProcessTypes';
import { useWorkProcessLabel } from './workProcessUseLabel';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';
import { isActiveThinkingStatus } from './workProcessActiveSignal';
import { MessageMarkdown } from '../../patterns/Markdown/MessageMarkdown';
import { WorkProcessIcon } from './WorkProcessIcons';
import { MeasuredWorkRows } from './MeasuredWorkRows';
import { useScopedWorkDisclosure } from './ScopedWorkDisclosure';

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

  // Policy hint from projection; sticky user gesture wins until this section remounts (key=row.id).
  // Summary click (not details onToggle) owns the gesture so programmatic `open` updates do not
  // get misclassified as user overrides when the browser emits a synthetic toggle.
  const [thinkingOpen, toggleThinking] = useScopedWorkDisclosure(`thinking-${row.id}`, row.thinkingOpenByDefault);

  const handleThinkingSummaryClick = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    toggleThinking();
  };

  return (
    <li
      className={`work-process-step work-process-section kind-section status-${row.status}${hasProse ? ' has-prose' : ''}${firstLineCaption ? ' first-line-caption' : ''}`}
      data-testid="work-process-section"
    >
      <WorkProcessRailIcon variant="section" status={row.status} />
      <div className="work-process-step-content">
        {row.thinkingExpandable ? (
          <details className={thinkingClassName} open={thinkingOpen}>
            <summary
              className="work-process-thinking-summary"
              onClick={handleThinkingSummaryClick}
            >
              {thinkingLabelNode}
              {row.thinkingSource ? <span className="work-process-thinking-source">{row.thinkingSource}</span> : null}
              <span className="work-process-row-caret" aria-hidden="true" />
            </summary>
            <div className="work-process-thinking-preview">
              <MessageMarkdown content={row.thinkingPreview} deferHeavyPlugins={thinkingActive} />
            </div>
          </details>
        ) : row.thinkingLabel ? (
          <p className={`${thinkingClassName} work-process-thinking-caption`}>
            {thinkingLabelNode}
            {row.thinkingSource ? <span className="work-process-thinking-source">{row.thinkingSource}</span> : null}
          </p>
        ) : null}
        {hasProse ? (
          <div className={`work-process-prose${row.proseStreaming ? ' is-streaming' : ''}`}>
            <MessageMarkdown content={row.proseText} deferHeavyPlugins={row.proseStreaming} />
          </div>
        ) : null}
        {showSteps ? (
          <MeasuredWorkRows className={`work-process-steps work-process-section-list disclosure-${row.stepsDisclosure} ${hasError || row.defaultOpen ? 'is-open' : ''}`}
            rows={visibleSteps} renderRow={renderRow} />
        ) : null}
      </div>
    </li>
  );
};
