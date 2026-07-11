import React from 'react';
import { useI18n } from '../../../i18n';
import { FaviconImage } from '../../../ui/FaviconImage';
import { getRowStatusLabel, type WorkProcessRow } from './workProcessPresentation';
import { useWorkProcessLabel } from './workProcessUseLabel';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';

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
  const diagnosticCaption = row.diagnosticCaption?.trim() || '';
  const hasDiagnostic = row.status === 'error' && Boolean(diagnosticCaption);
  const [rawOpen, setRawOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(row.status === 'running');
  const durationTitleFull = row.duration ? `${row.toolName} · ${row.duration}` : row.toolName;
  const verbLabel = label(row.verb);

  React.useEffect(() => {
    if (row.status === 'running') {
      setPreviewOpen(true);
      return;
    }
    if (row.status === 'error') {
      // Keep failed details collapsed; diagnostic caption is the exit.
      setRawOpen(false);
      setPreviewOpen(false);
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

  const toggleDiagnosticDetails = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (hasPreview) {
      setPreviewOpen((open) => {
        const next = !open;
        if (next && hasDebugDetails) setRawOpen(true);
        if (!next) setRawOpen(false);
        return next;
      });
      return;
    }
    if (hasDebugDetails) {
      setRawOpen((open) => !open);
    }
  };

  const detailsExpanded = (hasPreview && previewOpen) || (hasDebugDetails && rawOpen);

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
                {statusLabel ? (
                  row.status === 'error' ? (
                    <span className="work-process-tool-status-error">{statusLabel}</span>
                  ) : (
                    <span>{statusLabel}</span>
                  )
                ) : null}
              </span>
            )}
          </div>
          {hasDiagnostic ? (
            <button
              type="button"
              className={`work-process-tool-diagnostic${detailsExpanded ? ' is-open' : ''}`}
              data-testid="work-process-tool-diagnostic"
              aria-expanded={detailsExpanded}
              title={t('chat.workProcessShowDiagnostic')}
              onClick={toggleDiagnosticDetails}
            >
              <span className="work-process-tool-diagnostic-text">{diagnosticCaption}</span>
              {(hasPreview || hasDebugDetails) ? (
                <span className="work-process-tool-diagnostic-action">
                  {detailsExpanded ? t('chat.workProcessHideDiagnostic') : t('chat.workProcessShowDiagnostic')}
                </span>
              ) : null}
            </button>
          ) : null}
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
