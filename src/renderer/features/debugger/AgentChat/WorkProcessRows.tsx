import React, { useEffect, useId, useState } from 'react';
import { useI18n } from '../../../i18n';
import { ActiveSignalText } from '../../../ui/ActiveSignalText';
import { getRowStatusLabel, type WorkProcessRow } from './workProcessPresentation';
import { useWorkProcessLabel } from './workProcessUseLabel';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';
import { isActiveWorkProcessStatus } from './workProcessActiveSignal';
import { ToolRow } from './WorkProcessRowParts';

export { ToolRow };

export const SummaryRow: React.FC<{ row: Extract<WorkProcessRow, { type: 'summary' }> }> = ({ row }) => (
  <li className={`work-process-step is-appear status-${row.status} kind-summary`} data-testid="work-process-block">
    <WorkProcessRailIcon variant="step" status={row.status} />
    <div className="work-process-step-content">
      {row.detailLines.length > 0 ? (
        <details className="work-process-disclosure">
          <summary className="work-process-summary-line">
            <span className="work-process-step-summary">{row.text}</span>
            <span className="work-process-row-caret" aria-hidden="true" />
          </summary>
          <pre className="work-process-row-pre">{row.detailLines.join('\n')}</pre>
        </details>
      ) : (
        <p className="work-process-step-summary">{row.text}</p>
      )}
    </div>
  </li>
);

export const DiagnosticRow: React.FC<{ row: Extract<WorkProcessRow, { type: 'diagnostic' }> }> = ({ row }) => (
  <li
    className={`work-process-step is-appear work-process-diagnostic status-${row.status} severity-${row.severity} kind-diagnostic`}
    data-testid="work-process-block"
  >
    <WorkProcessRailIcon variant="step" status={row.status} />
    <div className="work-process-step-content">
      {row.detailLines.length > 0 ? (
        <details className="work-process-disclosure" open={row.status === 'error'}>
          <summary className="work-process-summary-line">
            <span className="work-process-diagnostic-message">{row.message}</span>
            <span className="work-process-row-caret" aria-hidden="true" />
          </summary>
          <pre className="work-process-row-pre">{row.detailLines.join('\n')}</pre>
        </details>
      ) : (
        <div className="work-process-diagnostic-message">{row.message}</div>
      )}
    </div>
  </li>
);

export const UserInputRow: React.FC<{ row: Extract<WorkProcessRow, { type: 'userInput' }> }> = ({ row }) => {
  const { t } = useI18n();
  const label = useWorkProcessLabel();
  const active = isActiveWorkProcessStatus(row.status);
  const [expanded, setExpanded] = useState(row.status !== 'complete');
  const transcriptId = useId();
  useEffect(() => setExpanded(row.status !== 'complete'), [row.id, row.status]);
  const headerText = row.incomplete
    ? label(row.verb)
    : t('chat.workProcessAskCount', { verb: label(row.verb), count: row.questionCount });
  const pendingAnswerLabel = row.status === 'error'
    ? t('chat.workProcessUserAnswerMissing')
    : t('chat.workProcessUserAnswerPending');
  const transcriptError = row.incomplete ? t('chat.userInputIncomplete') : row.error;

  return (
    <li className={`work-process-step is-appear status-${row.status} kind-user-input`} data-testid="work-process-user-input">
      <WorkProcessRailIcon variant="step" status={row.status} />
      <div className="work-process-step-content">
        <div className={`work-process-user-input${expanded ? ' is-expanded' : ''}`} data-testid="work-process-user-input-transcript">
          <button
            type="button"
            className="work-process-user-input-header"
            aria-controls={transcriptId}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {active ? (
              <ActiveSignalText active tone="interaction" className="work-process-user-input-verb">{headerText}</ActiveSignalText>
            ) : <span className="work-process-user-input-verb">{headerText}</span>}
            {row.status !== 'complete' ? (
              <span className="work-process-user-input-progress">{row.answeredCount}/{row.questionCount}</span>
            ) : null}
            <span className={`work-process-row-caret${expanded ? ' is-open' : ''}`} aria-hidden="true" />
          </button>
          {!expanded && !row.incomplete && row.items[0] ? (
            <p className="work-process-user-input-collapsed-summary">
              <span className="work-process-user-input-collapsed-question">{row.items[0].prompt}</span>
              {row.questionCount > 1 ? (
                <span className="work-process-user-input-collapsed-count">
                  {t('chat.workProcessAskRemaining', { count: row.questionCount - 1 })}
                </span>
              ) : null}
            </p>
          ) : null}
          {expanded ? (
            <ol id={transcriptId} className="work-process-user-input-transcript">
              {row.items.map((item, index) => (
                <li className="work-process-user-input-transcript-item" key={item.questionId}>
                  <span className="work-process-user-input-transcript-index" aria-hidden="true">{index + 1}.</span>
                  <p className="work-process-user-input-transcript-question">{item.prompt}</p>
                  {item.answer ? <p className="work-process-user-input-transcript-answer">{item.answer}</p> : (
                    <p className="work-process-user-input-transcript-pending">{pendingAnswerLabel}</p>
                  )}
                </li>
              ))}
              {transcriptError ? <li className="work-process-user-input-transcript-error" role="alert">{transcriptError}</li> : null}
            </ol>
          ) : null}
        </div>
      </div>
    </li>
  );
};

export const ApprovalRow: React.FC<{ row: Extract<WorkProcessRow, { type: 'approval' }> }> = ({ row }) => {
  const label = useWorkProcessLabel();
  const statusLabel = row.status === 'complete' ? '' : label(getRowStatusLabel(row.status));
  const summaryLine = (
    <>
      <span className="work-process-tool-line">
        <span className="work-process-tool-verb">{label(row.verb)}</span>
        <span className="work-process-approval-message">{row.message}</span>
      </span>
      <span className="work-process-tool-meta">
        {row.metaLines.map((line) => <span key={line}>{line}</span>)}
        {row.duration ? <span>{row.duration}</span> : null}
        {statusLabel ? <span>{statusLabel}</span> : null}
      </span>
    </>
  );

  return (
    <li className={`work-process-step is-appear status-${row.status} kind-approval`} data-testid="work-process-approval">
      <WorkProcessRailIcon variant="step" status={row.status} />
      <div className="work-process-step-content">
        <div className="work-process-approval">
          <div className="work-process-tool-summary work-process-tool-summary-static">{summaryLine}</div>
        </div>
      </div>
    </li>
  );
};
