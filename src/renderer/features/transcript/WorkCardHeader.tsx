import React from 'react';
import { Chevron } from '../../ui/Chevron';

/** Shared tool-card geometry; callers own identity, state and disclosure. */
export const WorkCardHeader: React.FC<{
  icon: React.ReactNode; title: React.ReactNode;
  /** The title as plain text: it reserves the bold width so the hover locate never shifts the row. */
  titleText?: string; status?: React.ReactNode; duration?: string;
  expanded?: boolean; disabled?: boolean; onClick: React.MouseEventHandler<HTMLButtonElement>;
  controls?: string; preview?: React.ReactNode; trailingPreview?: React.ReactNode;
}> = ({ icon, title, titleText, status, duration, expanded, disabled, onClick, controls, preview, trailingPreview }) => (
  <button type="button" className={`work-card-trigger${preview ? ' has-preview' : ''}`}
    onClick={onClick} aria-expanded={expanded} aria-controls={controls} disabled={disabled}>
    <span className="work-process-tool-card-header" data-work-node-heading>
      <span className="work-process-tool-card-title">{icon}<span className="work-process-tool-card-verb work-row-title" data-text={titleText}>{title}</span></span>
      <span className="work-process-tool-card-meta">
        {status}{duration ? <span>{duration}</span> : null}
        {expanded !== undefined ? <Chevron open={expanded} size={12} className="work-process-row-caret" /> : null}
      </span>
    </span>
    {preview ? <span className="work-card-preview">{preview}{trailingPreview ? <span className="work-card-preview-trailing">{trailingPreview}</span> : null}</span> : null}
  </button>
);
