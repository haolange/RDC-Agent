import React from 'react';
import { Chevron } from '../../ui/Chevron';
import { WorkRowTitle } from './WorkRowTitle';

/** Shared tool-card geometry; callers own identity, state and disclosure. */
export const WorkCardHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  titleContent?: React.ReactNode;
  titleMeta?: React.ReactNode;
  status?: React.ReactNode;
  duration?: string;
  expanded?: boolean;
  disabled?: boolean;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  controls?: string;
  preview?: React.ReactNode;
  trailingPreview?: React.ReactNode;
}> = ({
  icon,
  title,
  titleContent,
  titleMeta,
  status,
  duration,
  expanded,
  disabled,
  onClick,
  controls,
  preview,
  trailingPreview,
}) => (
  <button
    type="button"
    className={`work-card-trigger${preview ? ' has-preview' : ''}`}
    onClick={onClick}
    aria-expanded={expanded}
    aria-controls={controls}
    disabled={disabled}
  >
    <span className="work-process-tool-card-header" data-work-node-heading>
      <span className="work-process-tool-card-title">
        {icon}
        <WorkRowTitle text={title}>{titleContent}</WorkRowTitle>
        {titleMeta}
      </span>
      <span className="work-process-tool-card-meta">
        {status}
        {duration ? <span>{duration}</span> : null}
        {expanded !== undefined ? <Chevron open={expanded} size={12} className="work-process-row-caret" /> : null}
      </span>
    </span>
    {preview ? (
      <span className="work-card-preview">
        {preview}
        {trailingPreview ? <span className="work-card-preview-trailing">{trailingPreview}</span> : null}
      </span>
    ) : null}
  </button>
);
