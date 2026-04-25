import React, { useState } from 'react';
import { useI18n } from '../../i18n';
import { useSessionStore } from '../../stores/sessionStore';

const formatSize = (size: number): string => {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${size} B`;
};

export const CaptureLibrary: React.FC = () => {
  const { t } = useI18n();
  const currentProject = useSessionStore((state) => state.currentProject);
  const projectInputs = useSessionStore((state) => state.projectInputs);
  const openedCapture = useSessionStore((state) => state.openedCapture);
  const setProjectInputs = useSessionStore((state) => state.setProjectInputs);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeOpenedCapture = currentProject && openedCapture?.projectId === currentProject.projectId
    ? openedCapture
    : null;

  const handleRefresh = async () => {
    if (!currentProject) return;
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;
    setIsRefreshing(true);
    try {
      const result = await electronAPI.project.inputs.refresh(currentProject.projectId);
      setProjectInputs(result.inputs ?? []);
      setErrorMessage(null);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleImport = async () => {
    if (!currentProject) return;
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;
    setIsImporting(true);
    try {
      const result = await electronAPI.project.inputs.import(currentProject.projectId);
      setProjectInputs(result.inputs ?? []);
      setErrorMessage(result.error ?? null);
    } finally {
      setIsImporting(false);
    }
  };

  if (!currentProject) {
    return <div className="capture-library-empty">{t('control.captureLibraryProjectHint')}</div>;
  }

  return (
    <div className="capture-library">
      <div className="capture-library-toolbar" data-testid="capture-library-toolbar">
        <button
          type="button"
          className="panel-action-btn"
          data-testid="capture-library-refresh"
          onClick={() => void handleRefresh()}
          disabled={isRefreshing}
        >
          <span>{isRefreshing ? t('control.captureLibraryRefreshing') : t('control.captureLibraryRefresh')}</span>
        </button>
        <button
          type="button"
          className="panel-action-btn"
          data-testid="capture-library-import"
          onClick={() => void handleImport()}
          disabled={isImporting}
        >
          <span>{isImporting ? t('control.captureLibraryImporting') : t('control.captureLibraryImport')}</span>
        </button>
      </div>

      {errorMessage && <div className="capture-library-error" role="alert">{errorMessage}</div>}

      {projectInputs.length === 0 ? (
        <div className="capture-library-empty">
          {t('control.captureLibraryEmpty')}
        </div>
      ) : (
        <div className="capture-library-list">
          {projectInputs.map((input) => {
            const isOpened = activeOpenedCapture?.inputId === input.inputId && activeOpenedCapture.status === 'open';
            return (
              <div
                key={input.inputId}
                className={`capture-library-item ${isOpened ? 'opened' : ''}`}
                data-testid={`capture-library-card-${input.inputId}`}
              >
                <div className="capture-library-item-main">
                  <div className="capture-library-item-copy">
                    <div className="capture-library-item-name">{input.fileName}</div>
                    <div className="capture-library-item-path" title={input.filePath}>{input.filePath}</div>
                  </div>
                  <div className="capture-library-item-meta">
                    <span>{formatSize(input.size)}</span>
                    <span className="capture-item-separator">/</span>
                    <span>{new Date(input.lastModifiedAt).toLocaleDateString()}</span>
                    {isOpened && (
                      <>
                        <span className="capture-item-separator">/</span>
                        <span className="capture-library-opened-flag">{t('control.captureLibraryOpenedBadge')}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CaptureLibrary;
