import React from 'react';
import { useI18n } from '../../../i18n';

interface WorkProcessViewToggleProps {
  detailView: boolean;
  onToggle: () => void;
}

export const WorkProcessViewToggle: React.FC<WorkProcessViewToggleProps> = ({
  detailView,
  onToggle,
}) => {
  const { t } = useI18n();
  const label = detailView ? t('chat.workProcessBackToGrouped') : t('chat.workProcessShowLoopDetail');

  return (
    <button
      type="button"
      className="button button-ghost work-process-view-toggle"
      onClick={onToggle}
      title={label}
      aria-label={label}
      data-testid="work-process-view-toggle"
    >
      {detailView ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      )}
    </button>
  );
};
