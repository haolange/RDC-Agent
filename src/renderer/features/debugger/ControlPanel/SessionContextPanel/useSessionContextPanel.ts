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
import { useSessionHumanPreview } from './useSessionHumanPreview';

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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
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
    setStatusMessage(null);
  }, [currentProject?.projectId, currentSession?.sessionId]);

  const replayDeviceSummary = useMemo(() => {
    if (!selectedDeviceEntry) {
      return t('control.sessionContextDeviceUnknown');
    }
    if (selectedDeviceEntry.type === 'local') {
      return t('control.sessionContextReplayDeviceLocal');
    }
    return selectedDeviceEntry.label;
  }, [selectedDeviceEntry, t]);

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
      setStatusMessage,
      setSelectedInputId,
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
    setStatusMessage(null);
  };

  const humanPreview = useSessionHumanPreview({
    sessionContextSnapshot,
    activeOpenedCaptureReplaySessionId: activeOpenedCapture?.replaySessionId,
    setContextSnapshot,
    setErrorMessage,
    missingContextLabel: t('control.humanPreviewMissingContext'),
    missingSessionLabel: t('control.humanPreviewMissingSession'),
    missingOwnerLabel: t('control.humanPreviewMissingOwner'),
  });

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
    statusMessage,
    selectedInputId,
    setSelectedInputId,
    selectedDeviceEntry,
    replayDeviceSummary,
    handleOpen,
    handleRefresh,
    handleClear,
    handleOpenHumanPreview: humanPreview.handleOpenHumanPreview,
    handleCloseHumanPreview: humanPreview.handleCloseHumanPreview,
    humanPreview: humanPreview.humanPreview,
    previewDisabledReason: humanPreview.previewDisabledReason,
    canControlHumanPreview: humanPreview.canControlHumanPreview,
    isHumanPreviewOpen: humanPreview.isHumanPreviewOpen,
  };
}

export type SessionContextPanelViewModel = ReturnType<typeof useSessionContextPanel>;
