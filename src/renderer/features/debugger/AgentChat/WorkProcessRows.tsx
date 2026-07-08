import React from 'react';
import { useI18n } from '../../../i18n';
import { ActiveSignalText } from '../../../ui/ActiveSignalText';
import { getRowStatusLabel, type WorkProcessRow } from './workProcessPresentation';
import { useWorkProcessLabel } from './workProcessUseLabel';
import { WorkProcessIcon } from './WorkProcessIcons';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';
import { isActiveWorkProcessStatus } from './workProcessActiveSignal';

const ConsoleOutput: React.FC<{ lines: string[] }> = ({ lines }) => {
  const { t } = useI18n();
  return (
    <div className="work-process-console" data-testid="work-process-console">
      <div className="work-process-console-head">
        <span className="work-process-console-prompt" aria-hidden="true">{'>_'}</span>
        <span className="work-process-console-title">{t('chat.workProcessConsole')}</span>
      </div>
      <pre className="work-process-console-body">{lines.join('\n')}</pre>
    </div>
  );
};

export const SummaryRow: React.FC<{ row: Extract<WorkProcessRow, { type: 'summary' }> }> = ({ row }) => (
  <li className={`work-process-step status-${row.status} kind-summary`} data-testid="work-process-block">
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
    className={`work-process-step work-process-diagnostic status-${row.status} kind-diagnostic`}
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

const ResultPreview: React.FC<{ lines: string[]; compact?: boolean }> = ({ lines, compact }) => {
  if (compact) {
    return (
      <pre className="work-process-result-preview" data-testid="work-process-result-preview">
        {lines.join('\n')}
      </pre>
    );
  }
  return <ConsoleOutput lines={lines} />;
};

type ToolRowModel = Extract<WorkProcessRow, { type: 'tool' }>;
type ToolGroupRowModel = Extract<WorkProcessRow, { type: 'toolGroup' }>;

export const ToolGroupRow: React.FC<{
  row: ToolGroupRowModel;
  renderRow: (row: WorkProcessRow) => React.ReactNode;
}> = ({ row, renderRow }) => {
  const label = useWorkProcessLabel();
  const active = isActiveWorkProcessStatus(row.status);
  const title = label(row.title);
  const activeInteractionTitle = active && row.kind === 'interaction';
  return (
  <li
    className={`work-process-step work-process-tool-group status-${row.status} kind-${row.kind}`}
    data-testid="work-process-tool-group"
  >
    <WorkProcessRailIcon variant="step" status={row.status} />
    <div className="work-process-step-content">
      <details className="work-process-tool-group-details" open={row.defaultOpen}>
        <summary className="work-process-tool-group-summary">
          <span className="work-process-tool-group-head">
            <span className="work-process-tool-group-icon" aria-hidden="true">
              <WorkProcessIcon icon={row.icon} />
            </span>
            {activeInteractionTitle ? (
              <ActiveSignalText active tone="interaction" className="work-process-tool-group-title">
                {`${title} ${row.countLabel}`}
              </ActiveSignalText>
            ) : (
              <>
                <span className="work-process-tool-group-title">{title}</span>
                <span className="work-process-tool-group-count">{row.countLabel}</span>
              </>
            )}
          </span>
          {row.summary ? <span className="work-process-tool-group-preview">{row.summary}</span> : null}
          <span className="work-process-row-caret" aria-hidden="true" />
        </summary>
        <ol className="work-process-steps work-process-tool-group-list">
          {row.rows.map((child) => renderRow(child))}
        </ol>
      </details>
    </div>
  </li>
  );
};

const ToolApprovalCallout: React.FC<{ approval: NonNullable<ToolRowModel['approval']> }> = ({ approval }) => {
  const label = useWorkProcessLabel();
  return (
  <div className={`work-process-tool-approval status-${approval.status}`} data-testid="work-process-tool-approval">
    <div className="work-process-tool-approval-head">
      <span className="work-process-tool-approval-verb">{label(approval.verb)}</span>
      {approval.metaLines.length > 0 ? (
        <span className="work-process-tool-approval-meta">
          {approval.metaLines.map((line) => <span key={line}>{line}</span>)}
        </span>
      ) : null}
    </div>
    {approval.message ? <p className="work-process-tool-approval-message">{approval.message}</p> : null}
  </div>
  );
};

export const ToolRow: React.FC<{ row: ToolRowModel }> = ({ row }) => {
  const { t } = useI18n();
  const label = useWorkProcessLabel();
  const compact = row.compact === true;
  const statusLabel = row.status === 'complete' ? '' : label(getRowStatusLabel(row.status));
  const hasDebugDetails = row.argsLines.length > 0 || row.rawLines.length > 0;
  const hasPreview = row.previewLines.length > 0;
  const hasApproval = Boolean(row.approval);
  const hasExpandableContent = hasApproval || hasPreview || hasDebugDetails;
  const autoOpen = row.status === 'error' || row.status === 'running';
  const durationTitle = row.duration ? `${row.toolName} · ${row.duration}` : row.toolName;

  const summaryInner = (
    <>
      <span className="work-process-tool-line">
        <span className="work-process-tool-verb">{label(row.verb)}</span>
        {row.target ? <span className="work-process-tool-target">{row.target}</span> : null}
      </span>
      {compact ? (
        hasExpandableContent ? <span className="work-process-row-caret" aria-hidden="true" /> : null
      ) : (
        <span className="work-process-tool-meta">
          {row.duration ? <span>{row.duration}</span> : null}
          {statusLabel ? <span>{statusLabel}</span> : null}
          {hasExpandableContent ? <span className="work-process-row-caret" aria-hidden="true" /> : null}
        </span>
      )}
    </>
  );

  return (
    <li className={`work-process-step status-${row.status} kind-tool ${compact ? 'is-compact' : ''}`} data-testid="work-process-tool-call">
      <WorkProcessRailIcon variant="step" status={row.status} />
      <div className="work-process-step-content">
        <div className={`work-process-tool status-${row.status}`}>
          {hasExpandableContent ? (
            <details className="work-process-disclosure" open={autoOpen}>
              <summary className="work-process-tool-summary" title={durationTitle}>
                {summaryInner}
              </summary>
              <div className="work-process-tool-body">
                {row.approval ? <ToolApprovalCallout approval={row.approval} /> : null}
                {hasPreview ? <ResultPreview lines={row.previewLines} compact={compact} /> : null}
                {hasDebugDetails ? (
                  <details className="work-process-debug-disclosure" open={row.status === 'error'}>
                    <summary className="work-process-debug-toggle">
                      <span className="work-process-debug-toggle-icon" aria-hidden="true" />
                      {t('chat.workProcessRawData')}
                    </summary>
                    <div className="work-process-debug-body">
                      {row.argsLines.length > 0 ? (
                        <div className="work-process-debug-section">
                          <span className="work-process-debug-label">{t('chat.workProcessArgs')}</span>
                          <pre className="work-process-row-pre">{row.argsLines.join('\n')}</pre>
                        </div>
                      ) : null}
                      {row.rawLines.length > 0 ? (
                        <div className="work-process-debug-section">
                          <span className="work-process-debug-label">{t('chat.workProcessRawResult')}</span>
                          <pre className="work-process-row-pre">{row.rawLines.join('\n')}</pre>
                        </div>
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </div>
            </details>
          ) : (
            <div className="work-process-tool-summary work-process-tool-summary-static" title={durationTitle}>
              {summaryInner}
            </div>
          )}
        </div>
      </div>
    </li>
  );
};

export const UserInputRow: React.FC<{ row: Extract<WorkProcessRow, { type: 'userInput' }> }> = ({ row }) => {
  const { t } = useI18n();
  const pendingAnswerLabel = row.status === 'error'
    ? t('chat.workProcessUserAnswerMissing')
    : t('chat.workProcessUserAnswerPending');

  return (
    <li className={`work-process-step status-${row.status} kind-user-input`} data-testid="work-process-user-input">
      <WorkProcessRailIcon variant="step" status={row.status} />
      <div className="work-process-step-content">
        <div className="work-process-user-input" data-testid="work-process-user-input-transcript">
          <div className="work-process-user-input-transcript">
            {row.items.map((item) => (
              <div className="work-process-user-input-transcript-item" key={item.questionId}>
                <p className="work-process-user-input-transcript-question">{item.prompt}</p>
                {item.answer ? (
                  <p className="work-process-user-input-transcript-answer">{item.answer}</p>
                ) : (
                  <p className="work-process-user-input-transcript-pending">{pendingAnswerLabel}</p>
                )}
              </div>
            ))}
            {row.error ? <p className="work-process-user-input-transcript-error">{row.error}</p> : null}
          </div>
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
    <li className={`work-process-step status-${row.status} kind-approval`} data-testid="work-process-approval">
      <WorkProcessRailIcon variant="step" status={row.status} />
      <div className="work-process-step-content">
        <div className="work-process-approval">
          <div className="work-process-tool-summary work-process-tool-summary-static">{summaryLine}</div>
        </div>
      </div>
    </li>
  );
};
