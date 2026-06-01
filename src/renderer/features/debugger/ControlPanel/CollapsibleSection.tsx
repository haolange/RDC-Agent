import React from 'react';

export const CollapsibleSection: React.FC<{
  id: string;
  title: string;
  icon: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  badge?: string | number;
  summary?: React.ReactNode;
  variant?: 'project' | 'session';
}> = ({
  id,
  title,
  icon,
  isExpanded,
  onToggle,
  children,
  badge,
  summary,
  variant = 'project',
}) => {
  const sessionVariant = variant === 'session';

  return (
    <div
      className={`cp-section ${isExpanded ? 'expanded' : ''} ${sessionVariant ? 'cp-section-session' : ''}`}
      data-testid={`cp-section-${id}`}
    >
      <button className="cp-section-header" onClick={onToggle} aria-expanded={isExpanded}>
        <div className="cp-section-title">
          <span className="cp-section-icon">{icon}</span>
          <span className="cp-section-label">{title}</span>
          {badge !== undefined && badge !== 0 && (
            <span className="cp-section-badge">{badge}</span>
          )}
        </div>
        <div className="cp-section-trailing">
          {summary ? <div className="cp-section-summary">{summary}</div> : null}
          <span className={`cp-section-arrow ${isExpanded ? 'expanded' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </div>
      </button>
      {isExpanded ? (
        <div className="cp-section-content">
          <div className="cp-section-inner">{children}</div>
        </div>
      ) : null}
    </div>
  );
};

export default CollapsibleSection;
