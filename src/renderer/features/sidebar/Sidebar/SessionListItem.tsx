import React from 'react';
import { useI18n } from '../../../i18n';
import { useSessionRunning } from '../../../hooks/useSessionRunning';
import { Icon } from '../../../ui/Icon';
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
  const running = useSessionRunning(session.sessionId);

  if (session.storageDiagnostic === 'unsupported-schema') {
    return (
      <div className="session-item session-subitem is-disabled" role="status">
        <div className="session-item-header">
          <span className="session-item-title">{session.title}</span>
        </div>
        <span className="session-item-title">{t('sidebar.sessionSchemaUnsupported')}</span>
      </div>
    );
  }

  return (
    <div
      className={`session-item session-subitem ${isSessionRailActive ? 'is-selected' : ''}`}
      data-owns-context-menu=""
      onContextMenu={(event) => onContextMenu(event, session)}
    >
      <div className="session-item-header">
        <button type="button" className="session-item-select" onClick={() => void onActivate(project, session)}>
          {/* Rows carry no icon of their own; the gutter only marks a session with a reply in flight. */}
          <span className="session-item-gutter">
            {running ? (
              <span
                className="session-item-running"
                role="img"
                aria-label={t('sidebar.sessionRunning')}
                data-tooltip={t('sidebar.sessionRunning')}
              />
            ) : null}
          </span>
          <span className="session-item-title">{session.title}</span>
        </button>
        <span className="session-item-actions">
          <button
            type="button"
            className="session-item-icon-button"
            data-tooltip={t('sidebar.renameSession')}
            onClick={(event) => onRenameClick(event, session)}
            onKeyDown={(event) => onRenameKeyDown(event, session)}
          >
            <Icon name="edit" size={14} />
          </button>
          <button
            type="button"
            className="session-item-icon-button danger"
            data-tooltip={t('sidebar.removeSession')}
            onClick={(event) => onRemoveClick(event, session)}
            onKeyDown={(event) => onRemoveKeyDown(event, session)}
          >
            <Icon name="trash" size={14} />
          </button>
        </span>
      </div>
    </div>
  );
};
