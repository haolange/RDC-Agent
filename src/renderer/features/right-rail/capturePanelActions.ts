import { getElectronApi } from '../../platform/getElectronApi';

export type CaptureScope = { projectId: string; sessionId: string };

export async function getOpenedCaptureState(scope: CaptureScope) {
  return getElectronApi()?.capture.getOpenedState(scope) ?? null;
}

export async function getContextSnapshot(scope: CaptureScope) {
  return getElectronApi()?.context.get(scope) ?? null;
}

export async function getTraceProjection(sessionId: string) {
  return getElectronApi()?.trace.getProjection(sessionId) ?? { success: false, presentation: null };
}

export async function openProjectCaptureInput(request: {
  projectId: string;
  sessionId: string;
  inputId: string;
  filePath: string;
  replayDeviceId?: string | null;
}) {
  const { replayDeviceId, ...rest } = request;
  return getElectronApi()?.capture.openProjectInput({
    ...rest,
    replayDeviceId: replayDeviceId ?? '',
  });
}

export async function closeHumanPreview(scope: CaptureScope) {
  return getElectronApi()?.context.closeHumanPreview(scope);
}

export async function openHumanPreview(scope: CaptureScope) {
  return getElectronApi()?.context.openHumanPreview(scope);
}

export async function clearOpenedCapture(scope: CaptureScope) {
  return getElectronApi()?.capture.clearOpenedState(scope);
}

export async function refreshProjectCaptureInputs(projectId: string) {
  return getElectronApi()?.project.inputs.refresh(projectId);
}
