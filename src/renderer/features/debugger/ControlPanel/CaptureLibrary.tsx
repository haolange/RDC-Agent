import React, { useMemo, useState } from 'react';
import { useI18n } from '../../../i18n';
import { getElectronApi } from '../../../platform/getElectronApi';
import { useCaptureStore } from '../../../stores/captureStore';
import { useDeviceStore } from '../../../stores/deviceStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { openProjectInput } from './openProjectInput';

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
  const currentRun = useSessionStore((state) => state.currentRun);
  const projectInputs = useProjectStore((state) => state.projectInputs);
  const openedCapture = useCaptureStore((state) => state.openedCapture);
  const setCaptures = useCaptureStore((state) => state.setCaptures);
  const setContextSnapshot = useCaptureStore((state) => state.setContextSnapshot);
  const setOpenedCapture = useCaptureStore((state) => state.setOpenedCapture);
  const updateProjectInputs = useProjectStore((state) => state.updateProjectInputs);
  const selectedDevice = useDeviceStore((state) => state.selectedDevice);
  const devices = useDeviceStore((state) => state.devices);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedDeviceEntry = useMemo(
    () => devices.find((device) => device.id === selectedDevice) ?? devices[0] ?? null,
    [devices, selectedDevice],
  );

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

  const handleOpen = async (inputId: string) => {
    const input = projectInputs.find((entry) => entry.inputId === inputId);
    if (!input) {
      return;
    }

    await openProjectInput({
      input,
      currentProject,
      currentRun,
      selectedDeviceEntry,
      setCaptures,
      setContextSnapshot,
      setOpenedCapture,
      setErrorMessage,
      t,
      onStart: () => setOpeningId(inputId),
      onComplete: () => setOpeningId(null),
    });
  };

  if (!currentProject) {
    return <div className="capture-library-empty">{t('control.captureLibraryProjectHint')}</div>;
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
      {currentRun ? (
        <div className="capture-library-run-lock" role="status">
          {t('control.captureSwitchLocked')}
        </div>
      ) : null}

      {projectInputs.length === 0 ? (
        <div className="capture-library-empty">{t('control.captureLibraryEmpty')}</div>
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
                <div className="capture-library-item-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    data-testid={`capture-library-open-${input.inputId}`}
                    onClick={() => void handleOpen(input.inputId)}
                    disabled={Boolean(currentRun) || openingId === input.inputId}
                  >
                    {openingId === input.inputId ? t('control.captureOpening') : t('control.captureOpen')}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
