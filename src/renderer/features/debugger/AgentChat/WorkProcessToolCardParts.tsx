import React from 'react';
import { useI18n } from '../../../i18n';
import { getElectronApi } from '../../../platform/getElectronApi';
import { Button } from '../../../ui/Button';
import { FaviconImage } from '../../../ui/FaviconImage';
import type { WorkProcessRow } from './workProcessPresentation';
import { useWorkProcessLabel } from './workProcessUseLabel';

export type ToolRowModel = Extract<WorkProcessRow, { type: 'tool' }>;

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const SourcePills: React.FC<{ pills: NonNullable<ToolRowModel['sourcePills']> }> = ({ pills }) => (
  <div className="work-process-source-pills" data-testid="work-process-source-pills">
    {pills.map((pill) => {
      const content = (
        <>
          <FaviconImage domain={pill.domain} />
          <span>{pill.domain}</span>
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
          onClick={(event) => event.stopPropagation()}
        >
          {content}
        </a>
      ) : (
        <span key={pill.domain} className="work-process-source-pill" title={pill.title || pill.domain}>
          {content}
        </span>
      );
    })}
  </div>
);

/** Singular destination row: same pill grammar as search, but one focus chip + soft meta. */
const WebPageDestination: React.FC<{ chip: NonNullable<ToolRowModel['pageChip']> }> = ({ chip }) => {
  const statusLabel = typeof chip.status === 'number' ? String(chip.status) : '';
  const bytesLabel = typeof chip.bytes === 'number' ? formatBytes(chip.bytes) : '';
  const tooltip = [chip.title, chip.url].filter(Boolean).join('\n');

  return (
    <div className="work-process-web-destination" data-testid="work-process-web-page-chip">
      <a
        className="work-process-source-pill is-destination"
        href={chip.url}
        target="_blank"
        rel="noreferrer noopener"
        title={tooltip || chip.url}
        onClick={(event) => event.stopPropagation()}
      >
        <FaviconImage domain={chip.domain} />
        <span>{chip.domain}</span>
      </a>
      {chip.pathLabel ? (
        <span className="work-process-meta-chip is-path" title={chip.pathLabel}>{chip.pathLabel}</span>
      ) : null}
      {statusLabel ? (
        <span className="work-process-meta-chip" title={`HTTP ${statusLabel}`}>{statusLabel}</span>
      ) : null}
      {bytesLabel ? (
        <span className="work-process-meta-chip" title={bytesLabel}>{bytesLabel}</span>
      ) : null}
    </div>
  );
};

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
  if (row.bodyText?.trim()) return row.bodyText.trim();

  if (row.family === 'file') return row.pathChip?.trim() || row.target;
  if (row.family === 'shell') {
    const command = row.commandText?.trim() || row.target;
    return command ? `$ ${command}` : '';
  }
  if (row.family === 'git') return row.commandText?.trim() || row.target || row.previewLines[0] || '';
  if (row.family === 'search') return row.target || row.previewLines[0] || '';
  if (row.family === 'web') {
    if (row.pageChip) return row.pageChip.domain;
    return row.target || row.previewLines[0] || '';
  }
  return row.pathChip?.trim() || row.target || row.previewLines[0] || '';
};

const resolveCollapsedSampleLines = (row: ToolRowModel): string[] => {
  if (row.bodyLines && row.bodyLines.length > 0) return row.bodyLines.slice(0, 3);
  if (row.family === 'search' && row.bodyText && row.previewLines.length > 0) {
    return row.previewLines.slice(0, 3);
  }
  return [];
};

export const CardBody: React.FC<{ row: ToolRowModel }> = ({ row }) => {
  const bodyText = resolveBodyText(row);
  const sampleLines = resolveCollapsedSampleLines(row);
  if (!bodyText && sampleLines.length === 0 && !row.sourcePills?.length && !row.pageChip) return null;

  if (row.family === 'web') {
    const fetchTitle = row.pageChip?.title?.trim();
    return (
      <div className="work-process-tool-card-body family-web">
        {row.pageChip && fetchTitle ? (
          <span className="work-process-tool-card-body-text is-summary" title={fetchTitle}>{fetchTitle}</span>
        ) : null}
        {row.pageChip ? <WebPageDestination chip={row.pageChip} /> : null}
        {!row.pageChip && bodyText ? (
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

export const FamilyDetail: React.FC<{ row: ToolRowModel }> = ({ row }) => {
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
    if (!row.sourcePills?.length && !row.pageChip && lines.length <= 1) return null;
    return (
      <div className="work-process-tool-card-detail family-web" data-testid="work-process-tool-preview">
        {row.pageChip ? <WebPageDestination chip={row.pageChip} /> : null}
        {lines.length > 1 ? (
          <pre className="work-process-tool-card-preview">{lines.slice(1).join('\n')}</pre>
        ) : null}
        {row.sourcePills?.length ? <SourcePills pills={row.sourcePills} /> : null}
      </div>
    );
  }

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

export const RawPanel: React.FC<{ row: ToolRowModel }> = ({ row }) => {
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

export const ToolApprovalCallout: React.FC<{ approval: NonNullable<ToolRowModel['approval']> }> = ({ approval }) => {
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
