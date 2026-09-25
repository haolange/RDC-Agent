import React from 'react';
import { useI18n } from '../../i18n';
import { useWorkProcessLabel } from './workProcessUseLabel';
import type { ToolRowModel } from './workProcessToolTypes';
import { SourcePills, WebPageDestination } from './WorkProcessWebParts';
import { WorkProcessImageThumbs } from './WorkProcessImageThumbs';
import {
  CopyPathButton,
  FamilyLayerBody,
  FamilyLayerDetail,
  isDedicatedFamily,
} from './WorkProcessFamilyLayers';

export type { ToolRowModel } from './workProcessToolTypes';

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
  if (isDedicatedFamily(row.family)) return <FamilyLayerBody row={row} />;

  const bodyText = resolveBodyText(row);
  const samples = resolveCollapsedSampleLines(row);
  // Collapse only an exact duplicate. Distinct output and the full raw receipt remain available.
  const sampleLines = samples.join('\n') === bodyText ? [] : samples;
  if (!bodyText && sampleLines.length === 0 && !row.sourcePills?.length && !row.pageChip && !row.imagePreviews?.length) {
    return null;
  }

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
        {row.imagePreviews?.length ? <WorkProcessImageThumbs previews={row.imagePreviews} /> : null}
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
      {row.chips?.length ? (
        <div className="work-process-tool-chips">
          {row.chips.map((chip) => <span key={chip} className="work-process-path-chip">{chip}</span>)}
        </div>
      ) : null}
      {bodyText ? <span className="work-process-tool-card-body-text" title={bodyText}>{bodyText}</span> : null}
      {row.imagePreviews?.length ? <WorkProcessImageThumbs previews={row.imagePreviews} /> : null}
    </div>
  );
};

export const FamilyDetail: React.FC<{ row: ToolRowModel }> = ({ row }) => {
  if (isDedicatedFamily(row.family)) return <FamilyLayerDetail row={row} />;

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
