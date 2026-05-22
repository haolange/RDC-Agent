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

interface OpenProjectInputOptions {
  input: ProjectInputRecord;
  currentProject: ProjectRecord | null;
  currentRun: RunSummary | null;
  selectedDeviceEntry: ReplayDeviceEntry | null;
  setCaptures: (captures: CaptureDescriptor[]) => void;
  setContextSnapshot: (snapshot: ContextSnapshot | null) => void;
  setOpenedCapture: (openedCapture: OpenedCaptureState | null) => void;
  setErrorMessage: (message: string | null) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  onStart?: () => void;
  onComplete?: () => void;
}

export const createOpeningState = (
  input: ProjectInputRecord,
  projectId: string,
  device: ReplayDeviceEntry,
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

export async function openProjectInput(options: OpenProjectInputOptions): Promise<void> {
  const {
    input,
    currentProject,
    currentRun,
    selectedDeviceEntry,
    setCaptures,
    setContextSnapshot,
    setOpenedCapture,
    setErrorMessage,
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
    await window.electronAPI.capture.clearOpenedState();
    setContextSnapshot(null);
    setCaptures([]);
    setOpenedCapture(createOpeningState(input, currentProject.projectId, selectedDeviceEntry));
    setErrorMessage(null);

    if (
      selectedDeviceEntry.type === 'android'
      && !['connected', 'online'].includes(selectedDeviceEntry.status)
    ) {
      setErrorMessage(t('control.captureRemoteConnecting'));
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
      return;
    }

    setOpenedCapture(null);
    setErrorMessage(result.error ?? t('control.captureOpenFailed'));
  } catch (error) {
    setOpenedCapture(null);
    setErrorMessage(error instanceof Error ? error.message : t('control.captureOpenFailed'));
  } finally {
    onComplete?.();
  }
}
