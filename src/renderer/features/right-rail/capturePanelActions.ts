import type { CaptureReplayApplyRequest, CaptureReplayBindingRequest } from '@shared/types/captureReplay';
import type { SessionScope } from '@shared/types/session';
import { getElectronApi } from '../../platform/getElectronApi';

export type CaptureScope = SessionScope;
const api = () => {
  const bridge = getElectronApi();
  if (!bridge) throw new Error('Application connection is unavailable');
  return bridge;
};
export const getOpenedCaptureState = (scope: CaptureScope) => api().capture.getOpenedState(scope);
export const getContextSnapshot = (scope: CaptureScope) => api().context.get(scope);
export const getTraceProjection = (sessionId: string) => api().trace.getProjection(sessionId);
export const getReplayState = (scope: CaptureScope) => api().capture.getReplayState(scope);
export const getCaptureRecovery = (scope: CaptureScope) => api().capture.getRecovery(scope);
export const restorePreviousCapture = (scope: CaptureReplayBindingRequest) => api().capture.restorePrevious(scope);
export const getReplaySelection = (scope: CaptureScope) => api().capture.getReplaySelection(scope);
export const applyReplayEvent = (request: CaptureReplayApplyRequest) => api().capture.applyReplayEvent(request);
export const refreshReplayFrame = (scope: CaptureReplayBindingRequest) => api().capture.refreshFrame(scope);
export const subscribeReplay = (listener: Parameters<ReturnType<typeof api>['events']['onCaptureReplayChanged']>[0]) => api().events.onCaptureReplayChanged(listener);
export const readLivePreview = (scope: CaptureScope) => api().capture.readLivePreview(scope);
export const clearOpenedCapture = (scope: CaptureReplayBindingRequest) => api().capture.clearOpenedState(scope);
export const refreshProjectCaptureInputs = (projectId: string) => api().project.inputs.refresh(projectId);
export const refreshReplayDevices = () => api().device.refresh();
export const openProjectCaptureInput = (request: CaptureReplayBindingRequest & { inputId: string; filePath: string; replayDeviceId: string }) => api().capture.openProjectInput(request);
