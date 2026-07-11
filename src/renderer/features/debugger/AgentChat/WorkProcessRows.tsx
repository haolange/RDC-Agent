import React from 'react';
import { useI18n } from '../../../i18n';
import { ActiveSignalText } from '../../../ui/ActiveSignalText';
import { FaviconImage } from '../../../ui/FaviconImage';
import { getRowStatusLabel, type WorkProcessRow } from './workProcessPresentation';
import { useWorkProcessLabel } from './workProcessUseLabel';
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
    className={`work-process-step is-appear work-process-diagnostic status-${row.status} kind-diagnostic`}
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

const SourcePills: React.FC<{ pills: NonNullable<ToolRowModel['sourcePills']> }> = ({ pills }) => (
  <div className="work-process-source-pills" data-testid="work-process-source-pills">
    {pills.map((pill) => {
      const content = (
        <>
          <FaviconImage domain={pill.domain} />
          <span>{pill.title || pill.domain}</span>
        </>
      );
      return pill.url ? (
        <a
          key={`${pill.domain}-${pill.url}`}
          className="work-process-source-pill"
          href={pill.url}
          target="_blank"
          rel="noreferrer noopener"
          title={pill.title || pill.url}
        >
          {content}
        </a>
      ) : (
        <span key={pill.domain} className="work-process-source-pill" title={pill.title}>
          {content}
        </span>
      );
    })}
  </div>
);

export const ToolRow: React.FC<{ row: ToolRowModel }> = ({ row }) => {
  const { t } = useI18n();
  const label = useWorkProcessLabel();
  const compact = row.compact === true;
  const statusLabel = row.status === 'complete' ? '' : label(getRowStatusLabel(row.status));
  const hasDebugDetails = row.argsLines.length > 0 || row.rawLines.length > 0;
  const hasPreview = row.previewLines.length > 0;
  const hasApproval = Boolean(row.approval);
  const sourcePills = row.sourcePills?.length ? row.sourcePills : null;
  const [rawOpen, setRawOpen] = React.useState(row.status === 'error');
  const [previewOpen, setPreviewOpen] = React.useState(
    row.status === 'running' || row.status === 'error',
  );
  const durationTitleFull = row.duration ? `${row.toolName} · ${row.duration}` : row.toolName;
  const verbLabel = label(row.verb);

  React.useEffect(() => {
    if (row.status === 'error') {
      setRawOpen(true);
      setPreviewOpen(true);
    } else if (row.status === 'running') {
      setPreviewOpen(true);
    }
  }, [row.status]);

  const toggleRaw = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setRawOpen((open) => !open);
  };

  const togglePreview = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setPreviewOpen((open) => !open);
  };

  const verbNode = hasPreview ? (
    <button
      type="button"
      className={`work-process-tool-verb is-toggle${previewOpen ? ' is-open' : ''}`}
      aria-expanded={previewOpen}
      aria-label={t('chat.workProcessConsole')}
      title={t('chat.workProcessConsole')}
      onClick={togglePreview}
    >
      {verbLabel}
    </button>
  ) : (
    <span className="work-process-tool-verb">{verbLabel}</span>
  );

  const targetNode = row.browseLink ? (
    <a
      className="work-process-tool-browse-link"
      href={row.browseLink.url}
      target="_blank"
      rel="noreferrer noopener"
    >
      {row.browseLink.label}
    </a>
  ) : row.target ? (
    hasDebugDetails ? (
      <button
        type="button"
        className={`work-process-tool-target is-toggle${rawOpen ? ' is-open' : ''}`}
        aria-expanded={rawOpen}
        aria-label={t('chat.workProcessRawData')}
        title={t('chat.workProcessRawData')}
        onClick={toggleRaw}
      >
        {row.target}
      </button>
    ) : (
      <span className="work-process-tool-target">{row.target}</span>
    )
  ) : null;

  return (
    <li className={`work-process-step is-appear status-${row.status} kind-tool ${compact ? 'is-compact' : ''}`} data-testid="work-process-tool-call">
      <WorkProcessRailIcon variant="step" status={row.status} />
      <div className="work-process-step-content">
        <div className={`work-process-tool status-${row.status}`}>
          <div className="work-process-tool-summary work-process-tool-summary-static" title={durationTitleFull}>
            <span className="work-process-tool-line">
              {verbNode}
              {targetNode}
            </span>
            {compact ? null : (
              <span className="work-process-tool-meta">
                {row.duration ? <span>{row.duration}</span> : null}
                {statusLabel ? <span>{statusLabel}</span> : null}
              </span>
            )}
          </div>
          {hasApproval ? <ToolApprovalCallout approval={row.approval!} /> : null}
          {hasPreview && previewOpen ? (
            <div
              className="work-process-tool-preview"
              role="region"
              aria-label={t('chat.workProcessConsole')}
              data-testid="work-process-tool-preview"
            >
              <ResultPreview lines={row.previewLines} compact={compact} />
            </div>
          ) : null}
          {hasDebugDetails && rawOpen ? (
            <div
              className="work-process-debug-body"
              role="region"
              aria-label={t('chat.workProcessRawData')}
              data-testid="work-process-tool-raw"
            >
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
          ) : null}
          {sourcePills ? <SourcePills pills={sourcePills} /> : null}
        </div>
      </div>
    </li>
  );
};

export const UserInputRow: React.FC<{ row: Extract<WorkProcessRow, { type: 'userInput' }> }> = ({ row }) => {
  const { t } = useI18n();
  const label = useWorkProcessLabel();
  const active = isActiveWorkProcessStatus(row.status);
  const headerText = `${label(row.verb)} · ${row.questionCount}`;
  const pendingAnswerLabel = row.status === 'error'
    ? t('chat.workProcessUserAnswerMissing')
    : t('chat.workProcessUserAnswerPending');

  return (
    <li className={`work-process-step is-appear status-${row.status} kind-user-input`} data-testid="work-process-user-input">
      <WorkProcessRailIcon variant="step" status={row.status} />
      <div className="work-process-step-content">
        <div className="work-process-user-input" data-testid="work-process-user-input-transcript">
          <div className="work-process-user-input-header">
            {active ? (
              <ActiveSignalText active tone="interaction" className="work-process-user-input-verb">
                {headerText}
              </ActiveSignalText>
            ) : (
              <span className="work-process-user-input-verb">{headerText}</span>
            )}
          </div>
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
