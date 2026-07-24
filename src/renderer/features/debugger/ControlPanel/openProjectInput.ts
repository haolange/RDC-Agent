import type { ReplayDeviceEntry } from '@shared/types/device';
import type {
  CaptureDescriptor,
  ContextSnapshot,
  OpenedCaptureState,
  ProjectInputRecord,
  ProjectRecord,
  RunSummary,
} from '@shared/types/session';
import type { TranslationKey } from '../../../i18n';
import { getElectronApi } from '../../../platform/getElectronApi';

interface OpenProjectInputOptions {
  input: ProjectInputRecord;
  currentProject: ProjectRecord | null;
  currentRun: RunSummary | null;
  ownerSessionId: string | null;
  selectedDeviceEntry: ReplayDeviceEntry | null;
  setCaptures: (captures: CaptureDescriptor[]) => void;
  setContextSnapshot: (snapshot: ContextSnapshot | null) => void;
  setOpenedCapture: (openedCapture: OpenedCaptureState | null) => void;
  setErrorMessage: (message: string | null) => void;
  setStatusMessage?: (message: string | null) => void;
  setSelectedInputId?: (inputId: string) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  onStart?: () => void;
  onComplete?: () => void;
}

const isLocalReplayUnsupportedError = (message: string | null | undefined): boolean => (
  Boolean(message?.includes('LOCAL_REPLAY_UNSUPPORTED'))
);

const stripLocalReplayUnsupportedMarker = (message: string): string => (
  message.replace(/^LOCAL_REPLAY_UNSUPPORTED\s*/i, '').trim()
);

export async function openProjectInput(options: OpenProjectInputOptions): Promise<void> {
  const {
    input,
    currentProject,
    currentRun,
    ownerSessionId,
    selectedDeviceEntry,
    setCaptures,
    setContextSnapshot,
    setOpenedCapture,
    setErrorMessage,
    setStatusMessage,
    setSelectedInputId,
    t,
    onStart,
    onComplete,
  } = options;

  if (currentRun) {
    setErrorMessage(t('control.captureSwitchLocked'));
    return;
  }

  if (!currentProject || !selectedDeviceEntry) {
    return;
  }

  onStart?.();
  try {
    await getElectronApi()?.capture.clearOpenedState();
    setContextSnapshot(null);
    setCaptures([]);
    // Keep the picker mounted while opening — optimistic OpenedState swaps the panel and
    // drops selection/error when the open fails.
    setOpenedCapture(null);
    setSelectedInputId?.(input.inputId);
    setErrorMessage(null);
    setStatusMessage?.(null);

    if (
      selectedDeviceEntry.type === 'android'
      && !['connected', 'online'].includes(selectedDeviceEntry.status)
    ) {
      setStatusMessage?.(t('control.captureRemoteConnecting'));
    }

    const result = await getElectronApi()!.capture.openProjectInput({
      projectId: currentProject.projectId,
      ownerSessionId,
      inputId: input.inputId,
      filePath: input.filePath,
      replayDeviceId: selectedDeviceEntry.id,
    });

    setStatusMessage?.(null);

    if (result.success) {
      setOpenedCapture(result.openedCapture ?? null);
      if (result.contextSnapshot) {
        setContextSnapshot(result.contextSnapshot);
        setCaptures(result.contextSnapshot.captureDescriptors ?? []);
      }
      setErrorMessage(null);
      return;
    }

    setOpenedCapture(null);
    setSelectedInputId?.(input.inputId);
    const rawError = result.error ?? t('control.captureOpenFailed');
    if (selectedDeviceEntry.type === 'local' && isLocalReplayUnsupportedError(rawError)) {
      const detail = stripLocalReplayUnsupportedMarker(rawError);
      setErrorMessage(detail
        ? `${t('control.captureLocalReplayUnsupported')}\n${detail}`
        : t('control.captureLocalReplayUnsupported'));
      return;
    }
    setErrorMessage(rawError);
  } catch (error) {
    setOpenedCapture(null);
    setSelectedInputId?.(input.inputId);
    setStatusMessage?.(null);
    const message = error instanceof Error ? error.message : t('control.captureOpenFailed');
    if (selectedDeviceEntry.type === 'local' && isLocalReplayUnsupportedError(message)) {
      const detail = stripLocalReplayUnsupportedMarker(message);
      setErrorMessage(detail
        ? `${t('control.captureLocalReplayUnsupported')}\n${detail}`
        : t('control.captureLocalReplayUnsupported'));
      return;
    }
    setErrorMessage(message);
  } finally {
    onComplete?.();
  }
}
