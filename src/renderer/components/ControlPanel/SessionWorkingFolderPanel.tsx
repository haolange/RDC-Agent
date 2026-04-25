import React, { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { useSessionStore } from '../../stores/sessionStore';

const getLeafName = (value: string): string => value.split(/[\\/]/).filter(Boolean).pop() || value;

export const SessionWorkingFolderPanel: React.FC = () => {
  const { t } = useI18n();
  const currentProject = useSessionStore((state) => state.currentProject);
  const currentSession = useSessionStore((state) => state.currentSession);
  const currentRun = useSessionStore((state) => state.currentRun);
  const conversationMessages = useSessionStore((state) => state.conversationMessages);
  const actionEvents = useSessionStore((state) => state.actionEvents);
  const [attachmentCount, setAttachmentCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    if (!currentSession?.sessionId) {
      setAttachmentCount(0);
      return () => {
        cancelled = true;
      };
    }

    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      setAttachmentCount(0);
      return () => {
        cancelled = true;
      };
    }

    void electronAPI.session.attachments.list(currentSession.sessionId)
      .then((result) => {
        if (!cancelled) {
          setAttachmentCount(result.attachments.length);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAttachmentCount(0);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentSession?.sessionId]);

  const stats = useMemo(() => [
    { label: t('control.sessionWorkingFolderAttachments'), value: attachmentCount },
    { label: t('control.sessionWorkingFolderMessages'), value: conversationMessages.length },
    { label: t('control.sessionWorkingFolderEvents'), value: actionEvents.length },
  ], [actionEvents.length, attachmentCount, conversationMessages.length, t]);

  const hasTaskMaterial = Boolean(currentRun) || attachmentCount > 0 || actionEvents.length > 0;

  if (!currentProject || !currentSession) {
    return <div className="session-working-folder-empty">{t('control.sessionWorkingFolderUnavailable')}</div>;
  }

  const openPath = async (targetPath: string) => {
    await window.electronAPI?.appShell.openPath(targetPath);
  };

  return (
    <div className="session-working-folder-panel" data-testid="session-working-folder-panel">
      {!hasTaskMaterial ? (
        <div className="session-working-folder-idle-state">
          <div className="session-working-folder-idle-icon" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="session-working-folder-idle-copy">{t('control.sessionWorkingFolderIdleCompact')}</div>
        </div>
      ) : (
        <>
          <div className="session-working-folder-paths">
            <div className="session-working-folder-path-card">
              <span className="session-working-folder-label">{t('control.sessionWorkingFolderSessionPath')}</span>
              <span className="session-working-folder-name">{getLeafName(currentSession.sessionPath)}</span>
              <span className="session-working-folder-path" title={currentSession.sessionPath}>{currentSession.sessionPath}</span>
            </div>
            <div className="session-working-folder-path-card">
              <span className="session-working-folder-label">{t('control.sessionWorkingFolderProjectRoot')}</span>
              <span className="session-working-folder-name">{currentProject.name}</span>
              <span className="session-working-folder-path" title={currentProject.rootPath}>{currentProject.rootPath}</span>
            </div>
          </div>

          <div className="session-working-folder-stats">
            {stats.map((entry) => (
              <div key={entry.label} className="session-working-folder-stat">
                <span className="session-working-folder-stat-value">{entry.value}</span>
                <span className="session-working-folder-stat-label">{entry.label}</span>
              </div>
            ))}
          </div>

          <div className="session-working-folder-actions">
            <button
              type="button"
              className="panel-action-btn"
              data-testid="session-working-folder-open-session"
              onClick={() => void openPath(currentSession.sessionPath)}
            >
              <span>{t('control.sessionWorkingFolderOpenSession')}</span>
            </button>
            <button
              type="button"
              className="panel-action-btn"
              data-testid="session-working-folder-open-project"
              onClick={() => void openPath(currentProject.rootPath)}
            >
              <span>{t('control.sessionWorkingFolderOpenProject')}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default SessionWorkingFolderPanel;
