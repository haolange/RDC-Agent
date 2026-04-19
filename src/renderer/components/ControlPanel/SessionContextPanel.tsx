import React, { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n';
import DropdownSelect, { type DropdownOption } from '../DropdownSelect';
import { useDeviceStore } from '../../stores/deviceStore';
import { useSessionStore } from '../../stores/sessionStore';
import { OpenedCapturePreview } from './OpenedCapturePreview';
import { openProjectInput } from './openProjectInput';

const getLeafName = (value: string): string => value.split(/[\\/]/).filter(Boolean).pop() || value;

const formatOpenedAt = (timestamp?: number): string => {
  if (!timestamp) return '--';
  return new Date(timestamp).toLocaleString();
};

const formatStatusLabel = (
  status: string | undefined,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string => {
  if (!status) return '--';
  if (status === 'open') return t('control.captureLibraryOpenedBadge');
  if (status === 'opening') return t('control.captureOpening');
  if (status === 'error') return t('app.degraded');
  if (status === 'closed') return t('app.offline');
  return status;
};

const formatBackendLabel = (
  backend: string | undefined,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string => {
  if (backend === 'local') return t('control.sessionContextBackendLocal');
  if (backend === 'remote') return t('control.sessionContextBackendRemote');
  return backend || '--';
};

export const getSessionContextSummary = (
  openedCapturePath: string | null | undefined,
  inputCount: number,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string => {
  if (openedCapturePath) {
    return getLeafName(openedCapturePath);
  }

  if (inputCount === 1) {
    return t('control.sessionContextSingleCaptureReady');
  }

  if (inputCount > 1) {
    return t('control.sessionContextMultipleCaptureReady').replace('{count}', String(inputCount));
  }

  return t('control.sessionContextNoCapture');
};

export const SessionContextPanel: React.FC = () => {
  const { t } = useI18n();
  const currentProject = useSessionStore((state) => state.currentProject);
  const currentRun = useSessionStore((state) => state.currentRun);
  const projectInputs = useSessionStore((state) => state.projectInputs);
  const openedCapture = useSessionStore((state) => state.openedCapture);
  const contextSnapshot = useSessionStore((state) => state.contextSnapshot);
  const setCaptures = useSessionStore((state) => state.setCaptures);
  const setContextSnapshot = useSessionStore((state) => state.setContextSnapshot);
  const setOpenedCapture = useSessionStore((state) => state.setOpenedCapture);
  const selectedDevice = useDeviceStore((state) => state.selectedDevice);
  const devices = useDeviceStore((state) => state.devices);

  const [openingId, setOpeningId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedInputId, setSelectedInputId] = useState<string>('');

  const selectedDeviceEntry = useMemo(
    () => devices.find((device) => device.id === selectedDevice) ?? devices[0] ?? null,
    [devices, selectedDevice],
  );

  const activeOpenedCapture = currentProject && openedCapture?.projectId === currentProject.projectId
    ? openedCapture
    : null;
  const isIdleSelectionState = !activeOpenedCapture && !currentRun;
  const captureOptions = useMemo<DropdownOption[]>(
    () => projectInputs.map((input) => ({
      value: input.inputId,
      label: input.fileName,
      testId: `session-context-capture-option-${input.inputId}`,
    })),
    [projectInputs],
  );

  useEffect(() => {
    if (activeOpenedCapture?.inputId && projectInputs.some((entry) => entry.inputId === activeOpenedCapture.inputId)) {
      setSelectedInputId(activeOpenedCapture.inputId);
      return;
    }

    if (selectedInputId && projectInputs.some((entry) => entry.inputId === selectedInputId)) {
      return;
    }

    setSelectedInputId(projectInputs[0]?.inputId ?? '');
  }, [activeOpenedCapture?.inputId, projectInputs, selectedInputId]);

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

  const handleRefresh = async () => {
    const [nextOpenedCapture, nextContext] = await Promise.all([
      window.electronAPI.capture.getOpenedState().catch(() => null),
      window.electronAPI.context.get().catch(() => null),
    ]);

    setOpenedCapture(nextOpenedCapture);
    setContextSnapshot(nextContext);
  };

  const handleClear = async () => {
    await window.electronAPI.capture.clearOpenedState().catch(() => undefined);
    setOpenedCapture(null);
    setContextSnapshot(null);
    setCaptures([]);
    setErrorMessage(null);
  };

  return (
    <div className="session-context-panel" data-testid="session-context-panel">
      {activeOpenedCapture ? (
        <div className="session-context-opened-state">
          <OpenedCapturePreview
            openedCapture={activeOpenedCapture}
            isLoading={activeOpenedCapture.status === 'opening'}
          />

          <div className="session-context-summary-card">
            <span className="session-context-label">{t('control.sessionContextOpenedCapture')}</span>
            <strong className="session-context-primary">{getLeafName(activeOpenedCapture.filePath)}</strong>
            <span className="session-context-secondary" title={activeOpenedCapture.filePath}>{activeOpenedCapture.filePath}</span>
          </div>

          <div className="session-context-facts">
            <div className="session-context-fact">
              <span className="session-context-label">{t('control.openedCaptureStatus')}</span>
              <span className={`session-context-value ${activeOpenedCapture.status === 'open' ? 'active' : ''}`}>
                {formatStatusLabel(activeOpenedCapture.status, t)}
              </span>
            </div>
            <div className="session-context-fact">
              <span className="session-context-label">{t('control.openedCaptureOpenedAt')}</span>
              <span className="session-context-value">{formatOpenedAt(activeOpenedCapture.openedAt)}</span>
            </div>
            <div className="session-context-fact">
              <span className="session-context-label">{t('control.sessionContextBackend')}</span>
              <span className="session-context-value">
                <span className={`context-badge ${contextSnapshot?.backend ?? activeOpenedCapture.backend}`}>
                  {formatBackendLabel(contextSnapshot?.backend ?? activeOpenedCapture.backend, t)}
                </span>
              </span>
            </div>
            <div className="session-context-fact">
              <span className="session-context-label">{t('control.sessionContextDevice')}</span>
              <span className="session-context-value" title={contextSnapshot?.deviceLabel ?? activeOpenedCapture.deviceLabel}>
                {contextSnapshot?.deviceLabel ?? activeOpenedCapture.deviceLabel}
              </span>
            </div>
            <div className="session-context-fact">
              <span className="session-context-label">{t('control.sessionContextRuntimeOwner')}</span>
              <span className="session-context-value mono" title={contextSnapshot?.runtimeOwner ?? '--'}>
                {contextSnapshot?.runtimeOwner ?? '--'}
              </span>
            </div>
            <div className="session-context-fact">
              <span className="session-context-label">{t('control.sessionContextContextId')}</span>
              <span className="session-context-value mono" title={contextSnapshot?.contextId ?? activeOpenedCapture.contextId}>
                {(contextSnapshot?.contextId ?? activeOpenedCapture.contextId) || '--'}
              </span>
            </div>
            {(contextSnapshot?.sessionId ?? activeOpenedCapture.replaySessionId) && (
              <div className="session-context-fact">
                <span className="session-context-label">{t('control.sessionContextReplaySession')}</span>
                <span className="session-context-value mono" title={contextSnapshot?.sessionId ?? activeOpenedCapture.replaySessionId}>
                  {contextSnapshot?.sessionId ?? activeOpenedCapture.replaySessionId}
                </span>
              </div>
            )}
            {contextSnapshot?.backend === 'remote' && (
              <div className="session-context-fact">
                <span className="session-context-label">{t('control.sessionContextRemoteStatus')}</span>
                <span className="session-context-value context-status">
                  <span className={`context-status-dot ${contextSnapshot.remoteStatus === 'disconnected' ? 'offline' : contextSnapshot.remoteStatus ?? ''}`} />
                  <span className="context-status-text">{contextSnapshot.remoteStatus ?? '--'}</span>
                </span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="session-context-quick-entry">
          {projectInputs.length === 0 ? (
            <div className="session-context-empty">{t('control.sessionContextNoCapture')}</div>
          ) : (
            <div className="session-context-picker-row">
              <DropdownSelect
                value={selectedInputId}
                options={captureOptions}
                onChange={setSelectedInputId}
                placeholder={t('control.sessionContextPickerPlaceholder')}
                emptyLabel={t('control.sessionContextNoCapture')}
                dataTestId="session-context-capture-select"
                ariaLabel={t('control.sessionContextPickerLabel')}
                className="session-context-capture-select"
                triggerClassName="session-context-capture-select-trigger"
                menuClassName="session-context-capture-select-menu"
                optionClassName="session-context-capture-select-option"
              />
              <button
                type="button"
                className="panel-action-btn session-context-open-btn"
                data-testid="session-context-open-selected"
                onClick={() => void handleOpen(selectedInputId)}
                disabled={!selectedInputId || Boolean(currentRun) || openingId === selectedInputId}
              >
                <span>{openingId === selectedInputId ? t('control.captureOpening') : t('control.captureOpen')}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {errorMessage && <div className="capture-library-error" role="alert">{errorMessage}</div>}
      {currentRun && (
        <div className="capture-library-run-lock" role="status" aria-live="polite">
          {t('control.captureSwitchLocked')}
        </div>
      )}

      {!isIdleSelectionState && (
        <div className="session-context-actions">
          <button
            type="button"
            className="panel-action-btn"
            data-testid="session-context-refresh"
            onClick={() => void handleRefresh()}
          >
            <span>{t('control.runtimeRefresh')}</span>
          </button>
          <button
            type="button"
            className="panel-action-btn"
            data-testid="session-context-copy-id"
            onClick={() => {
              const contextId = contextSnapshot?.contextId ?? activeOpenedCapture?.contextId;
              if (contextId) {
                void window.electronAPI.appShell.copyText(contextId);
              }
            }}
            disabled={!contextSnapshot?.contextId && !activeOpenedCapture?.contextId}
          >
            <span>{t('control.copyContextId')}</span>
          </button>
          <button
            type="button"
            className="panel-action-btn session-context-clear-btn"
            data-testid="session-context-clear-opened"
            onClick={() => void handleClear()}
            disabled={!activeOpenedCapture || Boolean(currentRun)}
            title={currentRun ? t('control.captureSwitchLocked') : undefined}
          >
            <span>{t('control.openedCaptureClear')}</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default SessionContextPanel;
