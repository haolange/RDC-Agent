import React from 'react';
import { useI18n } from '../../i18n';
import { humanizeError } from '../../i18n/humanizeError';
import { ActiveSignalText } from '../../ui/ActiveSignalText';
import { Icon } from '../../ui/Icon';
import { InlineError } from '../../ui/InlineError';
import { Chevron } from '../../ui/Chevron';
import { useScopedWorkDisclosure } from './ScopedWorkDisclosure';
import { getRowStatusLabel } from './workProcessStatus';
import { type WorkProcessRow } from './workProcessTypes';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';
import { isActiveWorkProcessStatus } from './workProcessActiveSignal';
import { ToolRow } from './WorkProcessRowParts';
import { WorkCardHeader } from './WorkCardHeader';
import { WorkRowTitle } from './WorkRowTitle';
import { PlanCard } from './PlanCard';
import { usePlanReader } from './PlanReaderHost';

export { ToolRow };

export const SummaryRow: React.FC<{ row: Extract<WorkProcessRow, { type: 'summary' }> }> = ({ row }) => {
  const title = row.text;
  return (
    <li className={`work-process-step is-appear status-${row.status} kind-summary`} data-testid="work-process-block">
      <WorkProcessRailIcon row={row} />
      <div className="work-process-step-content">
        <div className="work-process-summary-card">
          {row.detailLines.length > 0 ? (
            <details className="work-process-disclosure" data-locate>
              <summary className="work-process-summary-line">
                <span className="work-process-step-summary" data-work-node-prose>
                  <WorkRowTitle text={title} wrap />
                </span>
                <Chevron size={12} className="work-process-row-caret" />
              </summary>
              <pre className="work-process-row-pre">{row.detailLines.join('\n')}</pre>
            </details>
          ) : (
            <p className="work-process-step-summary" data-work-node-prose>
              {title}
            </p>
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
  return (
    <li
      className={`work-process-step is-appear kind-diagnostic is-orphan-hook-row status-${row.status}`}
      data-testid="work-process-hook-diagnostic-card"
    >
      <WorkProcessRailIcon row={row} />
      <div className="work-process-step-content">
        <div
          className={`work-process-tool-card is-orphan-hook severity-${row.severity}${density === 'compact' ? ' is-compact' : ''}${expanded ? ' is-expanded' : ''}`}
          data-locate
        >
          <WorkCardHeader
            icon={<Icon name="plug" className="work-process-icon work-process-tool-card-icon" />}
            title={t('chat.workProcessHookDiagnostics')}
            status={
              row.severity === 'error'
                ? t('chat.workProcessStatusError')
                : row.severity === 'warning'
                  ? t('chat.workProcessHookWarning')
                  : null
            }
            expanded={expanded}
            onClick={toggle}
            preview={!expanded && row.severity !== 'info' ? row.message : undefined}
          />
          {expanded ? (
            <div className="work-process-tool-card-expand">
              <p className="work-process-orphan-hook-message">{row.message}</p>
              {row.detailLines.length ? <pre className="work-process-row-pre">{row.detailLines.join('\n')}</pre> : null}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
};

export const DiagnosticRow: React.FC<{
  row: Extract<WorkProcessRow, { type: 'diagnostic' }>;
  density?: 'normal' | 'compact';
}> = ({ row, density = 'normal' }) =>
  row.isHookDiagnostic ? (
    <HookDiagnosticCard row={row} density={density} />
  ) : (
    <li
      className={`work-process-step is-appear work-process-diagnostic status-${row.status} severity-${row.severity} kind-diagnostic`}
      data-testid="work-process-block"
    >
      <WorkProcessRailIcon row={row} />
      <div className="work-process-step-content">
        {row.detailLines.length > 0 ? (
          <details className="work-process-disclosure" open={row.status === 'error'} data-locate>
            <summary className="work-process-summary-line">
              <span className="work-process-diagnostic-message" data-work-node-prose>
                <WorkRowTitle text={row.message} wrap />
              </span>
              <Chevron size={12} className="work-process-row-caret" />
            </summary>
            <pre className="work-process-row-pre">{row.detailLines.join('\n')}</pre>
          </details>
        ) : (
          <div className="work-process-diagnostic-message" data-work-node-prose>
            {row.message}
          </div>
        )}
      </div>
    </li>
  );

/** The current plan revision inside Working: the card follows each revision and fades toward its foot. */
export const PlanReviewRow: React.FC<{ row: Extract<WorkProcessRow, { type: 'planReview' }> }> = ({ row }) => {
  const openPlan = usePlanReader();
  return (
    <li
      className={`work-process-step is-appear status-${row.status} kind-plan-review`}
      data-testid="work-process-plan-review"
    >
      <WorkProcessRailIcon row={row} />
      <div className="work-process-step-content">
        <PlanCard plan={row.plan} onOpen={openPlan} />
      </div>
    </li>
  );
};

export const UserInputRow: React.FC<{ row: Extract<WorkProcessRow, { type: 'userInput' }> }> = ({ row }) => {
  const { t } = useI18n();
  const active = isActiveWorkProcessStatus(row.status);
  const headerText = row.incomplete
    ? row.verb
    : t('chat.workProcessAskCount', { verb: row.verb, count: row.questionCount });
  const pendingAnswerLabel = t(active ? 'chat.workProcessUserAnswerPending' : 'chat.workProcessUserAnswerMissing');

  return (
    <li
      className={`work-process-step is-appear status-${row.status} kind-user-input`}
      data-testid="work-process-user-input"
    >
      <WorkProcessRailIcon row={row} />
      <div className="work-process-step-content">
        <div className="work-process-user-input" data-testid="work-process-user-input-transcript">
          <div className="work-process-tool-card-header" data-work-node-heading>
            {active ? (
              <ActiveSignalText active tone="interaction" className="work-process-user-input-verb">
                {headerText}
              </ActiveSignalText>
            ) : (
              <span className="work-process-user-input-verb">{headerText}</span>
            )}
            {active ? (
              <span className="work-process-user-input-progress">
                {row.answeredCount}/{row.questionCount}
              </span>
            ) : null}
          </div>
          {row.items.length > 0 ? (
            <ol className="work-process-user-input-transcript">
              {row.items.map((item, index) => (
                <li className="work-process-user-input-transcript-item" key={item.questionId}>
                  <span className="work-process-user-input-transcript-index" aria-hidden="true">
                    {index + 1}.
                  </span>
                  <p className="work-process-user-input-transcript-question">{item.prompt}</p>
                  {item.answer ? (
                    <p className="work-process-user-input-transcript-answer">{item.answer}</p>
                  ) : (
                    <p className="work-process-user-input-transcript-pending">{pendingAnswerLabel}</p>
                  )}
                </li>
              ))}
            </ol>
          ) : null}
          {row.incomplete ? (
            <p className="work-process-user-input-transcript-error" role="alert">
              {t('chat.userInputIncomplete')}
            </p>
          ) : row.error ? (
            <InlineError className="work-process-user-input-transcript-error" detail={row.error}>
              {humanizeError(row.error, t, 'chat.userInputFailed')}
            </InlineError>
          ) : null}
        </div>
      </div>
    </li>
  );
};

export const ApprovalRow: React.FC<{ row: Extract<WorkProcessRow, { type: 'approval' }> }> = ({ row }) => {
  const { t } = useI18n();
  const statusLabel = row.status === 'complete' ? '' : getRowStatusLabel(row.status, t);
  const summaryLine = (
    <>
      <span className="work-process-tool-line">
        <span className="work-process-tool-verb">{row.verb}</span>
        <span className="work-process-approval-message">{row.message}</span>
      </span>
      <span className="work-process-tool-meta">
        {row.metaLines.map((line) => (
          <span key={line}>{line}</span>
        ))}
        {row.duration ? <span>{row.duration}</span> : null}
        {statusLabel ? <span>{statusLabel}</span> : null}
      </span>
    </>
  );

  return (
    <li
      className={`work-process-step is-appear status-${row.status} kind-approval`}
      data-testid="work-process-approval"
    >
      <WorkProcessRailIcon row={row} />
      <div className="work-process-step-content">
        <div className="work-process-approval">
          <div className="work-process-tool-summary work-process-tool-summary-static" data-work-node-heading>
            {summaryLine}
          </div>
        </div>
      </div>
    </li>
  );
};
