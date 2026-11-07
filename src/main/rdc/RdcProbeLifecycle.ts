import type { CaptureReplayState } from '@shared/types/captureReplay';

/** A probe never chooses a new device on behalf of the owning session. */
export function selectedProbeDeviceId(state: Pick<CaptureReplayState, 'replayDeviceId' | 'preparation'>): string {
  const id = state.replayDeviceId ?? state.preparation.targetDeviceId;
  if (!id || state.preparation.phase !== 'ready') {
    throw new Error('RDC_PROBE_DEVICE_REQUIRED: prepare the session replay device through Capture first.');
  }
  if (state.preparation.targetDeviceId && state.preparation.targetDeviceId !== id) {
    throw new Error('RDC_PROBE_DEVICE_MISMATCH: selected and prepared devices differ.');
  }
  return id;
}
