import type { ReplayDeviceStatusChangedPayload } from '@shared/types/device';
import type { ContextSnapshot, SessionScopedPayload } from '@shared/types/session';
import { useCaptureStore } from '../../stores/captureStore';
import { useDeviceStore } from '../../stores/deviceStore';
import { useProjectStore } from '../../stores/projectStore';
import { isActiveSessionScope } from '../../stores/sessionEventGate';
import { useSessionProjectionStore } from '../../stores/sessionProjectionStore';

import type { ElectronAPI } from '@shared/types/electron';
import type { EventBridgeOptions } from './eventBridgeOptions';
const projection = () => useSessionProjectionStore.getState();

export function subscribeCaptureStatusChanged(electronAPI: ElectronAPI, projectScopedContext: (event: SessionScopedPayload<ContextSnapshot | null>) => void) {
  return electronAPI.events.onCaptureStatusChanged((event) => {
    const scoped = event as SessionScopedPayload<unknown>;
    if (!isActiveSessionScope(scoped)) return;
    electronAPI.context.get({ projectId: scoped.projectId, sessionId: scoped.sessionId }).then((snapshot) => {
      const payload: SessionScopedPayload<ContextSnapshot | null> = { ...scoped, payload: snapshot };
      projectScopedContext(payload);
    }).catch (() => undefined);
  });
}

export function subscribeDeviceStatusChanged(electronAPI: ElectronAPI) {
  return electronAPI.events.onDeviceStatusChanged((payload) => {
    useDeviceStore.getState().applyStatusPayload(payload as ReplayDeviceStatusChangedPayload);
  });
}

export function createCaptureProjection(electronAPI: ElectronAPI, syncCapturesFromSnapshot: EventBridgeOptions['syncCapturesFromSnapshot']) {
  const projectScopedContext = (event: SessionScopedPayload<ContextSnapshot | null>) => {
    projection().projectContextSnapshot(event.sessionId, event.payload);
    if (!isActiveSessionScope(event)) return;
    useCaptureStore.getState().setContextSnapshot(event.payload);
    if (event.payload) syncCapturesFromSnapshot(event.payload);
    else useCaptureStore.getState().setCaptures([]);
  };

  const projectScopedOpenedCapture = (event: SessionScopedPayload<ReturnType<typeof useCaptureStore.getState>['openedCapture']>) => {
    projection().projectOpenedCapture(event.sessionId, event.payload);
    if (isActiveSessionScope(event)) useCaptureStore.getState().setOpenedCapture(event.payload);
  };

  return {
    projectScopedContext, projectScopedOpenedCapture, hydrate() {
      void useDeviceStore.getState().loadDevices();
      const initialProject = useProjectStore.getState().currentProject;
      const initialSession = useProjectStore.getState().currentSession;
      if (initialProject && initialSession) {
        const scope = { projectId: initialProject.projectId, sessionId: initialSession.sessionId };
        void electronAPI.capture.getOpenedState(scope)
          .then((payload) => projectScopedOpenedCapture({ ...scope, payload }))
          .catch (() => undefined);
        void electronAPI.context.get(scope)
          .then((payload) => projectScopedContext({ ...scope, payload }))
          .catch (() => undefined);
      }

    }
  };
}
