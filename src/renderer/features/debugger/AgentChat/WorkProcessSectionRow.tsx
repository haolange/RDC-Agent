import React, { useState } from 'react';
import { useI18n } from '../../../i18n';
import type { WorkProcessRow } from './workProcessPresentation';
import { useWorkProcessLabel } from './workProcessUseLabel';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';

interface WorkProcessSectionRowProps {
  row: Extract<WorkProcessRow, { type: 'section' }>;
  showLoopMeta?: boolean;
  renderRow: (row: WorkProcessRow) => React.ReactNode;
}

export const WorkProcessSectionRow: React.FC<WorkProcessSectionRowProps> = ({
  row,
  showLoopMeta = false,
  renderRow,
}) => {
  const { t } = useI18n();
  const label = useWorkProcessLabel();
  const [commentaryExpanded, setCommentaryExpanded] = useState(false);
  const hasError = row.status === 'error' || row.steps.some((step) => step.status === 'error');
  const showSteps = row.stepCount > 0;
  const shouldClamp = row.clampable && row.clampResult && !commentaryExpanded;
  const resultClassName = [
    'work-process-loop-result',
    row.resultStreaming ? 'is-streaming' : '',
    shouldClamp ? 'is-clamped' : '',
    commentaryExpanded ? 'is-expanded' : '',
    row.clampable === false ? 'is-not-clampable' : '',
  ].filter(Boolean).join(' ');
  const hasResult = Boolean(row.resultText || row.resultToolSummary);
  const thinkingClassName = [
    'work-process-thinking-state',
    row.thinkingKind ? `kind-${row.thinkingKind}` : '',
    row.thinkingVisibility ? `visibility-${row.thinkingVisibility}` : '',
    row.thinkingStatus ? `status-${row.thinkingStatus}` : '',
  ].filter(Boolean).join(' ');

  return (
    <li className={`work-process-step work-process-section status-${row.status} kind-section`} data-testid="work-process-section">
      <WorkProcessRailIcon variant="section" status={row.status} />
      <div className="work-process-step-content">
        {showLoopMeta ? (
          <div className="work-process-section-meta">
            {row.outputPhase ? (
              <span className="work-process-loop-tag">
                {row.outputPhase === 'final_answer'
                  ? t('chat.workProcessOutputPhaseFinal')
                  : t('chat.workProcessOutputPhaseCommentary')}
              </span>
            ) : null}
            {row.stopReason ? (
              <span className="work-process-loop-tag">{row.stopReason}</span>
            ) : null}
          </div>
        ) : null}
        {row.thinkingExpandable ? (
          <details className={thinkingClassName} open={row.thinkingOpenByDefault}>
            <summary className="work-process-thinking-summary">
              <span>{label(row.thinkingLabel)}</span>
              {row.thinkingSource ? <span className="work-process-thinking-source">{row.thinkingSource}</span> : null}
              <span className="work-process-row-caret" aria-hidden="true" />
            </summary>
            <pre className="work-process-thinking-preview">{row.thinkingPreview}</pre>
          </details>
        ) : row.thinkingLabel ? (
          <p className={thinkingClassName}>
            <span>{label(row.thinkingLabel)}</span>
            {row.thinkingSource ? <span className="work-process-thinking-source">{row.thinkingSource}</span> : null}
          </p>
        ) : null}
        {hasResult ? (
          <div className={resultClassName}>
            {row.resultText ? <p className="work-process-loop-result-text">{row.resultText}</p> : null}
            {row.resultToolSummary ? <p className="work-process-loop-tool-summary">{row.resultToolSummary}</p> : null}
            {row.clampable && row.clampResult ? (
              <button
                type="button"
                className="button button-ghost work-process-clamp-toggle"
                onClick={() => setCommentaryExpanded((prev) => !prev)}
              >
                {commentaryExpanded ? t('chat.workProcessCollapse') : t('chat.workProcessExpand')}
              </button>
            ) : null}
          </div>
        ) : null}
        {showSteps ? (
          <ol className={`work-process-steps work-process-section-list ${hasError || row.defaultOpen ? 'is-open' : ''}`}>
            {row.steps.map((step) => renderRow(step))}
          </ol>
        ) : null}
      </div>
    </li>
  );
};
