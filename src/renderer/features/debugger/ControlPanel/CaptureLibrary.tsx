import React, { useState } from 'react';
import { useI18n } from '../../../i18n';
import { getElectronApi } from '../../../platform/getElectronApi';
import { useCaptureStore } from '../../../stores/captureStore';
import { useProjectStore } from '../../../stores/projectStore';

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
  const currentProject = useProjectStore((state) => state.currentProject);
  const projectInputs = useProjectStore((state) => state.projectInputs);
  const openedCapture = useCaptureStore((state) => state.openedCapture);
  const updateProjectInputs = useProjectStore((state) => state.updateProjectInputs);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeOpenedCapture = currentProject && openedCapture?.projectId === currentProject.projectId
    ? openedCapture
    : null;

  const handleRefresh = async () => {
    if (!currentProject) return;
    const electronAPI = getElectronApi();
    if (!electronAPI) return;
    setIsRefreshing(true);
    try {
      const result = await electronAPI.project.inputs.refresh(currentProject.projectId);
      updateProjectInputs(currentProject.projectId, result.inputs ?? []);
      setErrorMessage(null);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleImport = async () => {
    if (!currentProject) return;
    const electronAPI = getElectronApi();
    if (!electronAPI) return;
    setIsImporting(true);
    try {
      const result = await electronAPI.project.inputs.import(currentProject.projectId);
      updateProjectInputs(currentProject.projectId, result.inputs ?? []);
      setErrorMessage(result.error ?? null);
    } finally {
      setIsImporting(false);
    }
  };

  if (!currentProject) {
    return <div className="panel-empty">{t('control.captureLibraryProjectHint')}</div>;
  }

  return (
    <div className="capture-library" data-testid="capture-library">
      {activeOpenedCapture ? (
        <div className="capture-library-context-note">
          <strong>{t('control.captureLibraryOpenedBadge')}</strong>
          {' '}
          {activeOpenedCapture.filePath}
        </div>
      ) : null}

      <div className="capture-library-toolbar" data-testid="capture-library-toolbar">
        <button
          type="button"
          className="panel-action-btn"
          data-testid="capture-library-import"
          onClick={() => void handleImport()}
          disabled={isImporting}
        >
          {isImporting ? t('control.captureLibraryImporting') : t('control.captureLibraryImport')}
        </button>
        <button
          type="button"
          className="panel-action-btn"
          data-testid="capture-library-refresh"
          onClick={() => void handleRefresh()}
          disabled={isRefreshing}
        >
          {isRefreshing ? t('control.captureLibraryRefreshing') : t('control.captureLibraryRefresh')}
        </button>
      </div>

      {errorMessage ? <div className="capture-library-error" role="alert">{errorMessage}</div> : null}

      {projectInputs.length === 0 ? (
        <div className="panel-empty">{t('control.captureLibraryEmpty')}</div>
      ) : (
        <div className="capture-library-list">
          {projectInputs.map((input, index) => {
            const isOpened = activeOpenedCapture?.inputId === input.inputId;
            return (
              <article
                key={input.inputId}
                className={`capture-library-item ${isOpened ? 'opened' : ''}`}
                data-testid={index === 0 ? 'capture-library-card-input-0' : `capture-library-card-input-${index}`}
              >
                <div className="capture-library-item-main">
                  <div className="capture-library-item-copy">
                    <div className="capture-library-item-name">{input.fileName}</div>
                    <div className="capture-library-item-path">{input.filePath}</div>
                  </div>
                  <div className="capture-library-item-meta">
                    <span>{formatSize(input.size)}</span>
                    {isOpened ? <span className="capture-library-opened-flag">{t('control.captureLibraryOpenedBadge')}</span> : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
