import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../../i18n';
import { type DropdownOption } from '../../../../ui/DropdownSelect';
import { useDeviceStore } from '../../../../stores/deviceStore';
import { useCaptureStore } from '../../../../stores/captureStore';
import { useProjectStore } from '../../../../stores/projectStore';
import { useSessionStore } from '../../../../stores/sessionStore';
import { getElectronApi } from '../../../../platform/getElectronApi';
import { openProjectInput } from '../openProjectInput';
import {
  isContextSnapshotOwnedBySession,
  isOpenedCaptureOwnedBySession,
} from './sessionContextOwnership';

export function useSessionContextPanel() {
  const { t } = useI18n();
  const currentProject = useProjectStore((state) => state.currentProject);
  const currentSession = useProjectStore((state) => state.currentSession);
  const currentRun = useSessionStore((state) => state.currentRun);
  const projectInputs = useProjectStore((state) => state.projectInputs);
  const openedCapture = useCaptureStore((state) => state.openedCapture);
  const contextSnapshot = useCaptureStore((state) => state.contextSnapshot);
  const setCaptures = useCaptureStore((state) => state.setCaptures);
  const setContextSnapshot = useCaptureStore((state) => state.setContextSnapshot);
  const setOpenedCapture = useCaptureStore((state) => state.setOpenedCapture);
  const selectedDevice = useDeviceStore((state) => state.selectedDevice);
  const devices = useDeviceStore((state) => state.devices);

  const [openingId, setOpeningId] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedInputId, setSelectedInputId] = useState<string>('');

  const selectedDeviceEntry = useMemo(
    () => devices.find((device) => device.id === selectedDevice) ?? devices[0] ?? null,
    [devices, selectedDevice],
  );

  const activeOpenedCapture = isOpenedCaptureOwnedBySession(
    openedCapture,
    currentProject?.projectId,
    currentSession?.sessionId,
  ) ? openedCapture : null;
  const sessionContextSnapshot = isContextSnapshotOwnedBySession(
    contextSnapshot,
    currentSession?.sessionId,
  ) ? contextSnapshot : null;
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
    setSelectedInputId('');
    setErrorMessage(null);
  }, [currentProject?.projectId, currentSession?.sessionId]);

  useEffect(() => {
    if (activeOpenedCapture?.inputId && projectInputs.some((entry) => entry.inputId === activeOpenedCapture.inputId)) {
      setSelectedInputId(activeOpenedCapture.inputId);
      return;
    }

    if (selectedInputId && !projectInputs.some((entry) => entry.inputId === selectedInputId)) {
      setSelectedInputId('');
    }
  }, [activeOpenedCapture?.inputId, projectInputs, selectedInputId]);

  const handleOpen = async (inputId: string) => {
    const input = projectInputs.find((entry) => entry.inputId === inputId);
    if (!input || !currentSession) {
      return;
    }

    await openProjectInput({
      input,
      currentProject,
      currentRun,
      ownerSessionId: currentSession.sessionId,
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
    const electronAPI = getElectronApi();
    if (!electronAPI) return;

    const [nextOpenedCapture, nextContext] = await Promise.all([
      electronAPI.capture.getOpenedState().catch(() => null),
      electronAPI.context.get().catch(() => null),
    ]);

    setOpenedCapture(nextOpenedCapture);
    setContextSnapshot(nextContext);
  };

  const handleClear = async () => {
    await getElectronApi()?.capture.clearOpenedState().catch(() => undefined);
    setOpenedCapture(null);
    setContextSnapshot(null);
    setCaptures([]);
    setErrorMessage(null);
  };

  const handleOpenHumanPreview = async () => {
    const electronAPI = getElectronApi();
    if (!electronAPI) return;
    setPreviewBusy(true);
    const result = await electronAPI.context.openHumanPreview({
      sessionId: sessionContextSnapshot?.sessionId ?? activeOpenedCapture?.replaySessionId,
    }).catch((error) => ({
      success: false,
      contextSnapshot: undefined,
      error: error instanceof Error ? error.message : String(error),
    }));
    if (result.contextSnapshot) {
      setContextSnapshot(result.contextSnapshot);
    }
    if (!result.success && result.error) {
      setErrorMessage(result.error);
    }
    setPreviewBusy(false);
  };

  const handleCloseHumanPreview = async () => {
    const electronAPI = getElectronApi();
    if (!electronAPI) return;
    setPreviewBusy(true);
    const result = await electronAPI.context.closeHumanPreview()
      .catch((error) => ({
        success: false,
        contextSnapshot: undefined,
        error: error instanceof Error ? error.message : String(error),
      }));
    if (result.contextSnapshot) {
      setContextSnapshot(result.contextSnapshot);
    }
    if (!result.success && result.error) {
      setErrorMessage(result.error);
    }
    setPreviewBusy(false);
  };

  const humanPreview = sessionContextSnapshot?.humanPreview;
  const previewSessionId = sessionContextSnapshot?.sessionId ?? activeOpenedCapture?.replaySessionId;
  const previewDisabledReason = !sessionContextSnapshot?.contextId
    ? t('control.humanPreviewMissingContext')
    : !previewSessionId
      ? t('control.humanPreviewMissingSession')
      : !sessionContextSnapshot?.runtimeOwner || !sessionContextSnapshot?.ownerLeaseId
        ? t('control.humanPreviewMissingOwner')
        : '';
  const canControlHumanPreview = !previewDisabledReason && !previewBusy;
  const isHumanPreviewOpen = humanPreview?.status === 'open' || humanPreview?.status === 'opening';

  return {
    t,
    currentRun,
    projectInputs,
    contextSnapshot: sessionContextSnapshot,
    activeOpenedCapture,
    isIdleSelectionState,
    captureOptions,
    openingId,
    errorMessage,
    selectedInputId,
    setSelectedInputId,
    handleOpen,
    handleRefresh,
    handleClear,
    handleOpenHumanPreview,
    handleCloseHumanPreview,
    humanPreview,
    previewDisabledReason,
    canControlHumanPreview,
    isHumanPreviewOpen,
  };
}

export type SessionContextPanelViewModel = ReturnType<typeof useSessionContextPanel>;
