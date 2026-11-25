import { useCallback, useState } from 'react';
import { useDeviceStore } from '../../stores/deviceStore';
import { useProjectStore } from '../../stores/projectStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useSessionProjectionStore } from '../../stores/sessionProjectionStore';
import { errorDetail } from '../../lib/errorDetail';
import { clearOpenedCapture, getTraceProjection, openProjectCaptureInput, refreshProjectCaptureInputs, refreshReplayDevices, refreshReplayFrame, type CaptureScope } from './capturePanelActions';
import type { CaptureReplayState } from '@shared/types/captureReplay';
import type { RdcContextCaptureInput } from '@shared/types/trace';

export type CaptureAction = 'open' | 'close' | 'refresh' | 'image';

/**
 * The Capture panel's operations: open, close, export the image or refresh the inputs, one at a time, with the failure
 * of the last one kept for its callout.
 */
export function useCaptureActions(scope: CaptureScope, reload: () => Promise<unknown>, receive: (state: CaptureReplayState) => void) {
  const [action, setAction] = useState<CaptureAction | null>(null);
  const [error, setError] = useState<{ message: string; action: CaptureAction } | null>(null);
  const refreshProjection = useCallback(async () => {
    await reload();
    const result = await getTraceProjection(scope.sessionId);
    if (result.success && result.presentation) {
      useSessionProjectionStore.getState().projectTrace(scope.sessionId, result.presentation);
      if (useProjectStore.getState().currentSessionId === scope.sessionId) useWorkflowStore.getState().setTracePresentation(result.presentation);
    }
  }, [reload, scope]);
  const run = async (operation: CaptureAction, state: CaptureReplayState, input: RdcContextCaptureInput | undefined, deviceId: string,
    onOpened: () => void) => {
    setAction(operation); setError(null);
    try {
      if (operation === 'open' && input) {
        const result = await openProjectCaptureInput({ ...scope, bindingGeneration: state.generation, inputId: input.inputId, filePath: input.filePath, replayDeviceId: deviceId });
        if (!result.success) {
          if (result.issue) { setError({ message: result.issue.diagnostic, action: operation }); await reload(); return; }
          throw new Error(result.error);
        }
        onOpened();
      } else if (operation === 'close') {
        const result = await clearOpenedCapture({ ...scope, bindingGeneration: state.generation });
        if (!result.success) throw new Error(result.error);
      } else if (operation === 'image') receive(await refreshReplayFrame({ ...scope, bindingGeneration: state.generation }));
      else if (operation === 'refresh') {
        const [result, nextDevices] = await Promise.all([refreshProjectCaptureInputs(scope.projectId), refreshReplayDevices()]);
        useDeviceStore.getState().applyStatusPayload(nextDevices);
        useProjectStore.getState().updateProjectInputs(scope.projectId, result.inputs);
      }
      if (operation === 'refresh') await refreshProjection();
    } catch (reason) { setError({ message: errorDetail(reason), action: operation }); }
    finally { setAction(null); }
  };
  return { action, error, run, refreshProjection };
}
