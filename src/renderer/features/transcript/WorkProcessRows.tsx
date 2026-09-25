import React, { useId } from 'react';
import { useScopedWorkDisclosure } from './ScopedWorkDisclosure';
import { useI18n } from '../../i18n';
import { ActiveSignalText } from '../../ui/ActiveSignalText';
import { getRowStatusLabel } from './workProcessStatus';
import { type WorkProcessRow } from './workProcessTypes';
import { useWorkProcessLabel } from './workProcessUseLabel';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';
import { isActiveWorkProcessStatus } from './workProcessActiveSignal';
import { ToolRow } from './WorkProcessRowParts';
import { PlanCard } from './PlanCard';
import { WorkCardHeader } from './WorkCardHeader';
import { WorkProcessIcon } from './WorkProcessIcons';

export { ToolRow };

export const SummaryRow: React.FC<{ row: Extract<WorkProcessRow, { type: 'summary' }> }> = ({ row }) => {
  const label = useWorkProcessLabel();
  const title = label(row.text);
  return (
    <li className={`work-process-step is-appear status-${row.status} kind-summary`} data-testid="work-process-block">
      <WorkProcessRailIcon variant="step" status={row.status} />
      <div className="work-process-step-content">
        <div className="work-process-summary-card">
          {row.detailLines.length > 0 ? (
            <details className="work-process-disclosure">
              <summary className="work-process-summary-line">
                <span className="work-process-step-summary">{title}</span>
                <span className="work-process-row-caret" aria-hidden="true" />
              </summary>
              <pre className="work-process-row-pre">{row.detailLines.join('\n')}</pre>
            </details>
          ) : (
            <p className="work-process-step-summary">{title}</p>
          )}
          {row.duration ? <span className="work-process-summary-duration">{row.duration}</span> : null}
        </div>
      </div>
    </li>
  );
};

const HookDiagnosticCard: React.FC<{
  row: Extract<WorkProcessRow, { type: 'diagnostic' }>;
  density: 'normal' | 'compact';
}> = ({ row, density }) => {
  const { t } = useI18n();
  const [expanded, toggle] = useScopedWorkDisclosure(`hook-diagnostic-${row.id}`, false);
  return <li className={`work-process-step is-appear kind-diagnostic is-orphan-hook-row status-${row.status}`} data-testid="work-process-hook-diagnostic-card">
    <WorkProcessRailIcon variant="step" status={row.status} />
    <div className="work-process-step-content">
      <div className={`work-process-tool-card is-orphan-hook severity-${row.severity}${density === 'compact' ? ' is-compact' : ''}${expanded ? ' is-expanded' : ''}`}>
        <WorkCardHeader icon={<WorkProcessIcon icon="plug" className="work-process-tool-card-icon" />}
          title={t('chat.workProcessHookDiagnostics')}
          status={row.severity === 'error' ? t('chat.workProcessStatusError')
            : row.severity === 'warning' ? t('chat.workProcessHookWarning') : null}
          expanded={expanded} onClick={toggle}
          preview={!expanded && row.severity !== 'info' ? row.message : undefined} />
        {expanded ? <div className="work-process-tool-card-expand">
          <p className="work-process-orphan-hook-message">{row.message}</p>
          {row.detailLines.length ? <pre className="work-process-row-pre">{row.detailLines.join('\n')}</pre> : null}
        </div> : null}
      </div>
    </div>
  </li>;
};

export const DiagnosticRow: React.FC<{
  row: Extract<WorkProcessRow, { type: 'diagnostic' }>;
  density?: 'normal' | 'compact';
}> = ({ row, density = 'normal' }) => row.isHookDiagnostic
  ? <HookDiagnosticCard row={row} density={density} />
  : (
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

export const PlanReviewRow: React.FC<{ row: Extract<WorkProcessRow, { type: 'planReview' }> }> = ({ row }) => (
  <li className={`work-process-step is-appear status-${row.status} kind-plan-review`} data-testid="work-process-plan-review">
    <WorkProcessRailIcon variant="step" status={row.status} />
    <div className="work-process-step-content">
      <PlanCard plan={row.plan} />
    </div>
  </li>
);

export const UserInputRow: React.FC<{ row: Extract<WorkProcessRow, { type: 'userInput' }> }> = ({ row }) => {
  const { t } = useI18n();
  const label = useWorkProcessLabel();
  const active = isActiveWorkProcessStatus(row.status);
  const [expanded, toggleDisclosure] = useScopedWorkDisclosure(`user-input-${row.id}`, row.status !== 'complete');
  const transcriptId = useId();
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
            onClick={toggleDisclosure}
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
        {row.metaLines.map((line) => <span key={line}>{label(line)}</span>)}
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
