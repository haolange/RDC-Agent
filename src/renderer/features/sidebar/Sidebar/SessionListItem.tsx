import React from 'react';
import { useI18n } from '../../../i18n';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';

export interface SessionListItemProps {
  project: ProjectRecord;
  session: SessionRecord;
  isSessionRailActive: boolean;
  onActivate: (project: ProjectRecord, session: SessionRecord) => void;
  onContextMenu: (event: React.MouseEvent, session: SessionRecord) => void;
  onRenameClick: (event: React.MouseEvent, session: SessionRecord) => void;
  onRemoveClick: (event: React.MouseEvent, session: SessionRecord) => void;
  onRenameKeyDown: (event: React.KeyboardEvent, session: SessionRecord) => void;
  onRemoveKeyDown: (event: React.KeyboardEvent, session: SessionRecord) => void;
}

export const SessionListItem: React.FC<SessionListItemProps> = ({
  project,
  session,
  isSessionRailActive,
  onActivate,
  onContextMenu,
  onRenameClick,
  onRemoveClick,
  onRenameKeyDown,
  onRemoveKeyDown,
}) => {
  const { t } = useI18n();

  return (
    <div
      className={`session-item session-subitem ${isSessionRailActive ? 'active' : ''}`}
      data-owns-context-menu=""
      onContextMenu={(event) => onContextMenu(event, session)}
    >
      <div className="session-item-header">
        <button
          type="button"
          className="session-item-select"
          onClick={() => void onActivate(project, session)}
        >
          <span className="session-item-gutter" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.8" opacity="0.55" />
              <circle cx="12" cy="12" r="2.5" fill="currentColor" opacity="0.9" />
            </svg>
          </span>
          <span className="session-item-title">{session.title}</span>
        </button>
        <span className="session-item-actions">
          <button
            type="button"
            className="session-item-icon-button"
            title={t('sidebar.renameSession')}
            onClick={(event) => onRenameClick(event, session)}
            onKeyDown={(event) => onRenameKeyDown(event, session)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>
          <button
            type="button"
            className="session-item-icon-button danger"
            title={t('sidebar.removeSession')}
            onClick={(event) => onRemoveClick(event, session)}
            onKeyDown={(event) => onRemoveKeyDown(event, session)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
            </svg>
          </button>
        </span>
      </div>
    </div>
  );
};
