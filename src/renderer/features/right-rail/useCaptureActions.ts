import { useCallback, useState } from 'react';
import { errorCodeOf } from '@shared/errors/appError';
import { useI18n } from '../../i18n';
import { humanizeError } from '../../i18n/humanizeError';
import { errorDetail } from '../../lib/errorDetail';
import { useDeviceStore } from '../../stores/deviceStore';
import { useProjectStore } from '../../stores/projectStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useSessionProjectionStore } from '../../stores/sessionProjectionStore';
import {
  clearOpenedCapture,
  getTraceProjection,
  openProjectCaptureInput,
  refreshProjectCaptureInputs,
  refreshReplayDevices,
  refreshReplayFrame,
  type CaptureScope,
} from './capturePanelActions';
import type { CaptureReplayState } from '@shared/types/captureReplay';
import type { RdcContextCaptureInput } from '@shared/types/trace';

export type CaptureAction = 'open' | 'close' | 'refresh' | 'image';

/**
 * The Capture panel's operations: open, close, export the image or refresh the inputs, one at a time, with the failure
 * of the last one kept for its callout.
 */
export function useCaptureActions(
  scope: CaptureScope,
  reload: () => Promise<unknown>,
  receive: (state: CaptureReplayState) => void,
) {
  const { t } = useI18n();
  const [action, setAction] = useState<CaptureAction | null>(null);
  const [error, setError] = useState<{ reason: unknown; action: CaptureAction } | null>(null);
  const refreshProjection = useCallback(async () => {
    await reload();
    const { presentation } = await getTraceProjection(scope.sessionId);
    useSessionProjectionStore.getState().projectTrace(scope.sessionId, presentation);
    if (useProjectStore.getState().currentSessionId === scope.sessionId)
      useWorkflowStore.getState().setTracePresentation(presentation);
  }, [reload, scope]);
  const run = async (
    operation: CaptureAction,
    state: CaptureReplayState,
    input: RdcContextCaptureInput | undefined,
    deviceId: string,
    onOpened: () => void,
  ) => {
    setAction(operation);
    setError(null);
    try {
      if (operation === 'open' && input) {
        try {
          await openProjectCaptureInput({
            ...scope,
            bindingGeneration: state.generation,
            inputId: input.inputId,
            filePath: input.filePath,
            replayDeviceId: deviceId,
          });
        } catch (reason) {
          // A failed open can leave a device issue on the replay state; it shows from there.
          await reload();
          throw reason;
        }
        onOpened();
      } else if (operation === 'close') await clearOpenedCapture({ ...scope, bindingGeneration: state.generation });
      else if (operation === 'image')
        receive(await refreshReplayFrame({ ...scope, bindingGeneration: state.generation }));
      else if (operation === 'refresh') {
        const [result, nextDevices] = await Promise.all([
          refreshProjectCaptureInputs(scope.projectId),
          refreshReplayDevices(),
        ]);
        useDeviceStore.getState().applyStatusPayload(nextDevices);
        useProjectStore.getState().updateProjectInputs(scope.projectId, result.inputs);
      }
      if (operation === 'refresh') await refreshProjection();
    } catch (reason) {
      setError({ reason, action: operation });
    } finally {
      setAction(null);
    }
  };
  // A coded failure reads as its own sentence; the panel's action title words one without a code.
  const failure = error && {
    action: error.action,
    message: errorDetail(error.reason),
    ...(errorCodeOf(error.reason) ? { title: humanizeError(error.reason, t) } : {}),
  };
  return { action, error: failure, run, refreshProjection };
}
