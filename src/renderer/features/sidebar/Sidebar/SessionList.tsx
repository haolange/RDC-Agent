import React from 'react';
import { useI18n } from '../../../i18n';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';
import { SessionListItem } from './SessionListItem';

export interface SessionListProps {
  project: ProjectRecord;
  projectSessions: SessionRecord[];
  visibleSessions: SessionRecord[];
  hasOverflowSessions: boolean;
  showAllSessions: boolean;
  isSessionRailActive: (sessionId: string) => boolean;
  onActivate: (project: ProjectRecord, session: SessionRecord) => void;
  onContextMenu: (event: React.MouseEvent, session: SessionRecord) => void;
  onRenameClick: (event: React.MouseEvent, session: SessionRecord) => void;
  onRemoveClick: (event: React.MouseEvent, session: SessionRecord) => void;
  onRenameKeyDown: (event: React.KeyboardEvent, session: SessionRecord) => void;
  onRemoveKeyDown: (event: React.KeyboardEvent, session: SessionRecord) => void;
  onToggleShowAll: (event: React.MouseEvent, projectId: string) => void;
}

export const SessionList: React.FC<SessionListProps> = ({
  project,
  projectSessions,
  visibleSessions,
  hasOverflowSessions,
  showAllSessions,
  isSessionRailActive,
  onActivate,
  onContextMenu,
  onRenameClick,
  onRemoveClick,
  onRenameKeyDown,
  onRemoveKeyDown,
  onToggleShowAll,
}) => {
  const { t } = useI18n();

  if (projectSessions.length === 0) {
    return (
      <div className="session-empty compact nested">
        <div className="session-empty-text">{t('sidebar.noSessions')}</div>
      </div>
    );
  }

  return (
    <div className="session-list nested-session-list">
      {visibleSessions.map((session) => (
        <SessionListItem
          key={session.sessionId}
          project={project}
          session={session}
          isSessionRailActive={isSessionRailActive(session.sessionId)}
          onActivate={onActivate}
          onContextMenu={onContextMenu}
          onRenameClick={onRenameClick}
          onRemoveClick={onRemoveClick}
          onRenameKeyDown={onRenameKeyDown}
          onRemoveKeyDown={onRemoveKeyDown}
        />
      ))}
      {hasOverflowSessions && (
        <button
          type="button"
          className="session-list-toggle"
          onClick={(event) => onToggleShowAll(event, project.projectId)}
        >
          {showAllSessions ? t('sidebar.showLess') : t('sidebar.showMore')}
        </button>
      )}
    </div>
  );
};
