import React, { useMemo, useState } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useDeviceStore } from '../../stores/deviceStore';
import type { OpenedCaptureState, ProjectInputRecord } from '@shared/types/session';
import { useI18n } from '../../i18n';

const formatSize = (size: number): string => {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${size} B`;
};

const createOpeningState = (
  input: ProjectInputRecord,
  projectId: string,
  device: { id: string; label: string; type: string },
): OpenedCaptureState => ({
  projectId,
  inputId: input.inputId,
  filePath: input.filePath,
  captureId: input.inputId,
  sessionId: '',
  contextId: '',
  replaySessionId: '',
  backend: device.type === 'android' ? 'remote' : 'local',
  deviceId: device.id,
  deviceLabel: device.label,
  status: 'opening',
  openedAt: Date.now(),
  preview: null,
});

export const CaptureLibrary: React.FC = () => {
  const { t } = useI18n();
  const currentRun = useSessionStore((state) => state.currentRun);
  const currentProject = useSessionStore((state) => state.currentProject);
  const projectInputs = useSessionStore((state) => state.projectInputs);
  const openedCapture = useSessionStore((state) => state.openedCapture);
  const setCaptures = useSessionStore((state) => state.setCaptures);
  const setProjectInputs = useSessionStore((state) => state.setProjectInputs);
  const setContextSnapshot = useSessionStore((state) => state.setContextSnapshot);
  const setOpenedCapture = useSessionStore((state) => state.setOpenedCapture);

  const selectedDevice = useDeviceStore((state) => state.selectedDevice);
  const devices = useDeviceStore((state) => state.devices);

  const [openingId, setOpeningId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedDeviceEntry = useMemo(
    () => devices.find((device) => device.id === selectedDevice) ?? devices[0] ?? null,
    [devices, selectedDevice],
  );

  const activeOpenedCapture = currentProject && openedCapture?.projectId === currentProject.projectId
    ? openedCapture
    : null;
  const currentDeviceLabel = selectedDeviceEntry?.label ?? 'Local Replay';

  const handleRefresh = async () => {
    if (!currentProject) return;
    setIsRefreshing(true);
    try {
      const result = await window.electronAPI.project.inputs.refresh(currentProject.projectId);
      setProjectInputs(result.inputs ?? []);
      setErrorMessage(null);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleImport = async () => {
    if (!currentProject) return;
    setIsImporting(true);
    try {
      const result = await window.electronAPI.project.inputs.import(currentProject.projectId);
      setProjectInputs(result.inputs ?? []);
      setErrorMessage(result.error ?? null);
    } finally {
      setIsImporting(false);
    }
  };

  const handleOpen = async (input: ProjectInputRecord) => {
    if (currentRun) {
      setErrorMessage(t('control.captureSwitchLocked'));
      return;
    }
    if (!currentProject || !selectedDeviceEntry) return;
    setOpeningId(input.inputId);
    try {
      await window.electronAPI.capture.clearOpenedState();
      setContextSnapshot(null);
      setCaptures([]);
      setOpenedCapture(createOpeningState(input, currentProject.projectId, selectedDeviceEntry));
      setErrorMessage(null);

      if (
        selectedDeviceEntry.type === 'android'
        && !['connected', 'online'].includes(selectedDeviceEntry.status)
      ) {
        setErrorMessage('正在连接 Android RenderDoc…');
      }

      const result = await window.electronAPI.capture.openProjectInput({
        projectId: currentProject.projectId,
        inputId: input.inputId,
        filePath: input.filePath,
        replayDeviceId: selectedDeviceEntry.id,
      });
      if (result.success) {
        setOpenedCapture(result.openedCapture ?? null);
        if (result.contextSnapshot) {
          setContextSnapshot(result.contextSnapshot);
          setCaptures(result.contextSnapshot.captureDescriptors ?? []);
        }
        setErrorMessage(null);
      } else {
        setOpenedCapture(null);
        setErrorMessage(result.error ?? '打开失败。');
      }
    } catch (error) {
      setOpenedCapture(null);
      setErrorMessage(error instanceof Error ? error.message : '打开失败。');
    } finally {
      setOpeningId(null);
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

      <div className="capture-library-context-note">
        当前回放设备：
        {' '}
        <strong>{currentDeviceLabel}</strong>
      </div>

      {errorMessage && <div className="capture-library-error" role="alert">{errorMessage}</div>}
      {currentRun && (
        <div className="capture-library-run-lock" role="status" aria-live="polite">
          {t('control.captureSwitchLocked')}
        </div>
      )}

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
                    <span className="capture-item-separator">·</span>
                    <span>{new Date(input.lastModifiedAt).toLocaleDateString()}</span>
                    {isOpened && (
                      <>
                        <span className="capture-item-separator">·</span>
                        <span className="capture-library-opened-flag">{t('control.captureLibraryOpenedBadge')}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="capture-library-item-actions" data-testid={`capture-library-actions-${input.inputId}`}>
                  <button
                    type="button"
                    className="button button-primary button-sm"
                    data-testid={`capture-library-open-${input.inputId}`}
                    onClick={() => void handleOpen(input)}
                    disabled={Boolean(currentRun) || openingId === input.inputId}
                    title={currentRun ? t('control.captureSwitchLocked') : undefined}
                  >
                    {openingId === input.inputId ? t('control.captureOpening') : t('control.captureOpen')}
                  </button>
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
