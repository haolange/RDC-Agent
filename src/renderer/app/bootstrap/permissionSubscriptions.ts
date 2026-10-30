import type { ElectronAPI } from '@shared/types/electron';
import type { RuntimePermissionState } from '@shared/types/runtimePermission';
import { useRuntimePermissionStore } from '../../stores/runtimePermissionStore';
import { useWorkflowStore } from '../../stores/workflowStore';

export function subscribePermissionState(electronAPI: ElectronAPI): () => void {
  let disposed = false;
  const apply = (snapshot: RuntimePermissionState) => {
    if (disposed) return;
    const permission = useRuntimePermissionStore.getState();
    if (permission.snapshot && snapshot.revision < permission.snapshot.revision) return;
    permission.applySnapshot(snapshot);
    const workflow = useWorkflowStore.getState();
    const presentation = workflow.tracePresentation;
    if (presentation) workflow.setTracePresentation(presentation);
  };
  // Subscribe first: a slower initial query may arrive after a newer event.
  const unsubscribe = electronAPI.events.onPermissionStateChanged(apply);
  void electronAPI.runtime.getPermissionState().then(apply).catch(() => {
    if (!disposed && !useRuntimePermissionStore.getState().snapshot) useRuntimePermissionStore.getState().setSyncError();
  });
  return () => { disposed = true; unsubscribe(); };
}
