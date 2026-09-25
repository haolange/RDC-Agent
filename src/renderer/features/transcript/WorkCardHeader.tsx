import React from 'react';

/** Shared tool-card geometry; callers own identity, state and disclosure. */
export const WorkCardHeader: React.FC<{
  icon: React.ReactNode; title: React.ReactNode; status?: React.ReactNode; duration?: string;
  expanded?: boolean; disabled?: boolean; onClick: React.MouseEventHandler<HTMLButtonElement>;
  controls?: string; tooltip?: string; preview?: React.ReactNode; trailingPreview?: React.ReactNode;
}> = ({ icon, title, status, duration, expanded, disabled, onClick, controls, tooltip, preview, trailingPreview }) => (
  <button type="button" className={`work-card-trigger${preview ? ' has-preview' : ''}`}
    onClick={onClick} aria-expanded={expanded} aria-controls={controls} disabled={disabled} title={tooltip}>
    <span className="work-process-tool-card-header">
      <span className="work-process-tool-card-title">{icon}<span className="work-process-tool-card-verb">{title}</span></span>
      <span className="work-process-tool-card-meta">
        {status}{duration ? <span>{duration}</span> : null}
        {expanded !== undefined ? <span className={`work-process-row-caret${expanded ? ' is-open' : ''}`} aria-hidden="true" /> : null}
      </span>
    </span>
    {preview ? <span className="work-card-preview">{preview}{trailingPreview ? <span className="work-card-preview-trailing">{trailingPreview}</span> : null}</span> : null}
  </button>
);
