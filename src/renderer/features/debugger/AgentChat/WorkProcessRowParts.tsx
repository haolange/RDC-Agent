import React from 'react';
import { useI18n } from '../../../i18n';
import { getElectronApi } from '../../../platform/getElectronApi';
import { Button } from '../../../ui/Button';
import { FaviconImage } from '../../../ui/FaviconImage';
import { getRowStatusLabel, type WorkProcessRow } from './workProcessPresentation';
import { WorkProcessIcon } from './WorkProcessIcons';
import { useWorkProcessLabel } from './workProcessUseLabel';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';

type ToolRowModel = Extract<WorkProcessRow, { type: 'tool' }>;

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

const CopyPathButton: React.FC<{ path: string }> = ({ path }) => {
  const { language } = useI18n();
  const [copied, setCopied] = React.useState(false);
  const copyLabel = language === 'zh-CN' ? '复制' : 'Copy';
  const copiedLabel = language === 'zh-CN' ? '已复制' : 'Copied';

  const onCopy = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!path) return;
    await getElectronApi()?.appShell.copyText(path);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="work-process-tool-card-copy"
      onClick={onCopy}
      aria-label={copied ? copiedLabel : copyLabel}
      title={copied ? copiedLabel : copyLabel}
    >
      {copied ? '✓' : '⧉'}
    </Button>
  );
};

const resolveBodyText = (row: ToolRowModel): string => {
  // Outcome-first: prefer projected result summary when the tool has completed.
  if (row.bodyText?.trim()) return row.bodyText.trim();

  if (row.family === 'file') return row.pathChip?.trim() || row.target;
  if (row.family === 'shell') {
    const command = row.commandText?.trim() || row.target;
    return command ? `$ ${command}` : '';
  }
  if (row.family === 'git') return row.commandText?.trim() || row.target || row.previewLines[0] || '';
  if (row.family === 'search') return row.target || row.previewLines[0] || '';
  if (row.family === 'web') {
    if (row.browseLink) return row.browseLink.label;
    return row.target || row.previewLines[0] || '';
  }
  return row.pathChip?.trim() || row.target || row.previewLines[0] || '';
};

const resolveCollapsedSampleLines = (row: ToolRowModel): string[] => {
  if (row.bodyLines && row.bodyLines.length > 0) return row.bodyLines.slice(0, 3);
  // Search family: when we have a count summary, also surface the first paths.
  if (row.family === 'search' && row.bodyText && row.previewLines.length > 0) {
    return row.previewLines.slice(0, 3);
  }
  return [];
};

const CardBody: React.FC<{ row: ToolRowModel }> = ({ row }) => {
  const bodyText = resolveBodyText(row);
  const sampleLines = resolveCollapsedSampleLines(row);
  if (!bodyText && sampleLines.length === 0 && !row.sourcePills?.length && !row.browseLink) return null;

  if (row.family === 'web') {
    return (
      <div className="work-process-tool-card-body family-web">
        {row.browseLink ? (
          <a
            className="work-process-tool-card-link"
            href={row.browseLink.url}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(event) => event.stopPropagation()}
          >
            {row.browseLink.label}
          </a>
        ) : bodyText ? (
          <span className="work-process-tool-card-body-text">{bodyText}</span>
        ) : null}
        {row.sourcePills?.length ? <SourcePills pills={row.sourcePills} /> : null}
      </div>
    );
  }

  if (row.family === 'file') {
    const copyPath = row.pathChip?.trim() || row.target;
    return (
      <div className="work-process-tool-card-body family-file">
        <code className="work-process-tool-card-path" title={bodyText || copyPath}>{bodyText}</code>
        {copyPath ? <CopyPathButton path={copyPath} /> : null}
      </div>
    );
  }

  if (row.family === 'shell' || row.family === 'git') {
    return (
      <div className={`work-process-tool-card-body family-${row.family}`}>
        <code className="work-process-tool-card-command">{bodyText}</code>
      </div>
    );
  }

  if (row.family === 'search' || sampleLines.length > 0) {
    return (
      <div className={`work-process-tool-card-body family-${row.family}`}>
        {bodyText ? (
          <span className="work-process-tool-card-body-text is-summary" title={bodyText}>{bodyText}</span>
        ) : null}
        {sampleLines.length > 0 ? (
          <ul className="work-process-tool-card-body-list">
            {sampleLines.map((line) => (
              <li key={line} className="work-process-tool-card-body-list-item" title={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`work-process-tool-card-body family-${row.family}`}>
      <span className="work-process-tool-card-body-text" title={bodyText}>{bodyText}</span>
    </div>
  );
};

const FamilyDetail: React.FC<{ row: ToolRowModel }> = ({ row }) => {
  const lines = row.previewLines;
  if (row.family === 'shell' || row.family === 'git') {
    if (!row.commandText && lines.length === 0) return null;
    return (
      <div className="work-process-tool-card-detail family-shell" data-testid="work-process-tool-preview">
        {row.commandText ? (
          <pre className="work-process-shell-command">{`$ ${row.commandText}`}</pre>
        ) : null}
        {lines.length > 0 ? (
          <pre className="work-process-shell-stdout">{lines.join('\n')}</pre>
        ) : null}
      </div>
    );
  }

  if (row.family === 'file') {
    if (lines.length === 0) return null;
    return (
      <div className="work-process-tool-card-detail family-file" data-testid="work-process-tool-preview">
        <pre className="work-process-tool-card-preview">{lines.join('\n')}</pre>
      </div>
    );
  }

  if (row.family === 'search') {
    if (lines.length === 0) return null;
    return (
      <div className="work-process-tool-card-detail family-search" data-testid="work-process-tool-preview">
        <ul className="work-process-tool-card-list">
          {lines.map((line) => (
            <li key={line} className="work-process-tool-card-list-item">{line}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (row.family === 'web') {
    if (!row.sourcePills?.length && lines.length <= 1) return null;
    return (
      <div className="work-process-tool-card-detail family-web" data-testid="work-process-tool-preview">
        {lines.length > 1 ? (
          <pre className="work-process-tool-card-preview">{lines.slice(1).join('\n')}</pre>
        ) : null}
        {row.sourcePills?.length ? <SourcePills pills={row.sourcePills} /> : null}
      </div>
    );
  }

  // generic (includes skill_read brief + path chip)
  if (lines.length === 0 && !row.pathChip) return null;
  return (
    <div className="work-process-tool-card-detail family-generic" data-testid="work-process-tool-preview">
      {lines[0] ? <p className="work-process-tool-card-caption">{lines[0]}</p> : null}
      {row.pathChip ? (
        <span className="work-process-path-chip" title={row.pathChip}>{row.pathChip}</span>
      ) : null}
      {lines.length > 1 ? (
        <pre className="work-process-tool-card-preview">{lines.slice(1).join('\n')}</pre>
      ) : null}
    </div>
  );
};

const RawPanel: React.FC<{ row: ToolRowModel }> = ({ row }) => {
  const { t } = useI18n();
  if (row.argsLines.length === 0 && row.rawLines.length === 0) return null;
  return (
    <div
      className="work-process-tool-card-raw"
      role="region"
      aria-label={t('chat.workProcessRawData')}
      data-testid="work-process-tool-raw"
    >
      {row.argsLines.length > 0 ? (
        <div className="work-process-tool-card-raw-section">
          <span className="work-process-tool-card-raw-label">{t('chat.workProcessArgs')}</span>
          <pre className="work-process-tool-card-raw-pre">{row.argsLines.join('\n')}</pre>
        </div>
      ) : null}
      {row.rawLines.length > 0 ? (
        <div className="work-process-tool-card-raw-section">
          <span className="work-process-tool-card-raw-label">{t('chat.workProcessRawResult')}</span>
          <pre className="work-process-tool-card-raw-pre">{row.rawLines.join('\n')}</pre>
        </div>
      ) : null}
    </div>
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
  const hasDetail = row.previewLines.length > 0
    || Boolean(row.commandText)
    || Boolean(row.pathChip && row.family === 'generic')
    || Boolean(row.sourcePills?.length && row.family === 'web');
  const hasRaw = row.argsLines.length > 0 || row.rawLines.length > 0;
  const canExpand = hasDetail || hasRaw;
  const hasApproval = Boolean(row.approval);
  const diagnosticCaption = row.diagnosticCaption?.trim() || '';
  const hasDiagnostic = row.status === 'error' && Boolean(diagnosticCaption);
  // Collapsed by default — including while running — so live CoT stays quiet;
  // users expand individual cards when they want detail / Raw.
  const [expanded, setExpanded] = React.useState(false);
  const durationTitleFull = row.duration ? `${row.toolName} · ${row.duration}` : row.toolName;
  const verbLabel = label(row.verb);

  const toggleExpanded = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canExpand) return;
    setExpanded((open) => !open);
  };

  return (
    <li
      className={`work-process-step is-appear status-${row.status} kind-tool family-${row.family}${compact ? ' is-compact' : ''}`}
      data-testid="work-process-tool-call"
    >
      <WorkProcessRailIcon variant="step" status={row.status} />
      <div className="work-process-step-content">
        <div
          className={`work-process-tool-card status-${row.status}${expanded ? ' is-expanded' : ''}${canExpand ? ' is-expandable' : ''}`}
          data-testid="work-process-tool-card"
          data-family={row.family}
        >
          <button
            type="button"
            className="work-process-tool-card-header"
            onClick={toggleExpanded}
            aria-expanded={canExpand ? expanded : undefined}
            disabled={!canExpand}
            title={durationTitleFull}
          >
            <span className="work-process-tool-card-title">
              <WorkProcessIcon icon={row.icon} className="work-process-tool-card-icon" />
              <span className="work-process-tool-card-verb">{verbLabel}</span>
            </span>
            <span className="work-process-tool-card-meta">
              {row.duration ? <span>{row.duration}</span> : null}
              {statusLabel ? (
                row.status === 'error' ? (
                  <span className="work-process-tool-status-error">{statusLabel}</span>
                ) : (
                  <span>{statusLabel}</span>
                )
              ) : null}
              {canExpand ? (
                <span className={`work-process-row-caret${expanded ? ' is-open' : ''}`} aria-hidden="true" />
              ) : null}
            </span>
          </button>

          <CardBody row={row} />

          {hasDiagnostic ? (
            <button
              type="button"
              className={`work-process-tool-diagnostic${expanded ? ' is-open' : ''}`}
              data-testid="work-process-tool-diagnostic"
              aria-expanded={expanded}
              title={t('chat.workProcessShowDiagnostic')}
              onClick={toggleExpanded}
            >
              <span className="work-process-tool-diagnostic-text">{diagnosticCaption}</span>
              {canExpand ? (
                <span className="work-process-tool-diagnostic-action">
                  {expanded ? t('chat.workProcessHideDiagnostic') : t('chat.workProcessShowDiagnostic')}
                </span>
              ) : null}
            </button>
          ) : null}

          {hasApproval ? <ToolApprovalCallout approval={row.approval!} /> : null}

          {expanded ? (
            <div className="work-process-tool-card-expand">
              <FamilyDetail row={row} />
              <RawPanel row={row} />
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
};
