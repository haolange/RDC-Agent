import React from 'react';
import { FaviconImage } from '../../../ui/FaviconImage';
import type { ToolRowModel } from './workProcessToolTypes';

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const SourcePills: React.FC<{ pills: NonNullable<ToolRowModel['sourcePills']> }> = ({ pills }) => (
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
export const WebPageDestination: React.FC<{ chip: NonNullable<ToolRowModel['pageChip']> }> = ({ chip }) => {
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
