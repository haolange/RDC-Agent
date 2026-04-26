import React, { useEffect, useMemo, useState } from 'react';
import type { SessionOutputRecord } from '@shared/types/session';
import { useI18n } from '../../i18n';
import { useSessionStore } from '../../stores/sessionStore';

const getLeafName = (value: string): string => value.split(/[\\/]/).filter(Boolean).pop() || value;

const formatFileSize = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const SessionWorkingFolderPanel: React.FC = () => {
  const { t } = useI18n();
  const currentSession = useSessionStore((state) => state.currentSession);
  const currentRun = useSessionStore((state) => state.currentRun);
  const actionEvents = useSessionStore((state) => state.actionEvents);
  const [outputs, setOutputs] = useState<SessionOutputRecord[]>([]);

  useEffect(() => {
    let cancelled = false;

    if (!currentSession?.sessionId) {
      setOutputs([]);
      return () => {
        cancelled = true;
      };
    }

    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      setOutputs([]);
      return () => {
        cancelled = true;
      };
    }

    void electronAPI.session.outputs.list(currentSession.sessionId, currentRun?.runId)
      .then((result) => {
        if (!cancelled) {
          setOutputs(result.outputs);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOutputs([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [actionEvents.length, currentRun?.runId, currentSession?.sessionId]);

  const visibleOutputs = useMemo(() => outputs.slice(0, 18), [outputs]);
  const hasTaskMaterial = Boolean(currentRun) || outputs.length > 0 || actionEvents.length > 0;

  if (!currentSession) {
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
              <span className="session-working-folder-label">{t('control.sessionWorkingFolderDefaultPath')}</span>
              <span className="session-working-folder-name">{getLeafName(currentSession.sessionPath)}</span>
              <span className="session-working-folder-path" title={currentSession.sessionPath}>{currentSession.sessionPath}</span>
            </div>
          </div>

          <div className="session-output-list" data-testid="session-output-list">
            <span className="session-output-list-title">{t('control.sessionOutputsWorkingFiles')}</span>
            {visibleOutputs.length > 0 ? (
              visibleOutputs.map((output) => (
                <button
                  type="button"
                  key={output.id}
                  className="session-output-item"
                  onClick={() => void openPath(output.filePath)}
                  title={output.filePath}
                >
                  <span className={`session-output-kind ${output.kind}`}>{output.fileName.slice(0, 2).toUpperCase()}</span>
                  <span className="session-output-copy">
                    <span className="session-output-title">{output.title}</span>
                    <span className="session-output-meta">
                      {output.source}
                      {formatFileSize(output.sizeBytes) ? ` · ${formatFileSize(output.sizeBytes)}` : ''}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <span className="session-working-folder-empty">{t('control.sessionOutputsEmpty')}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default SessionWorkingFolderPanel;
