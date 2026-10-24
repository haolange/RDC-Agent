import { ipcMain } from 'electron';
import { replayHistoryStore } from '../captures/replay/ReplayHistoryStore';
import { replayLivePreviewStore } from '../captures/replay/ReplayLivePreviewStore';
import { storageAdapter } from '../sessions/StorageAdapter';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { SessionScopeArgsSchema } from './validation/captureDeviceSchemas';
import type { SessionScope } from '@shared/types/session';
function authorize(scope: SessionScope) {
  const session = storageAdapter.readSession(scope.sessionId);
  const project = storageAdapter.getProjectById(scope.projectId);
  if (!session || session.projectId !== scope.projectId || !project) throw new Error('REPLAY_SCOPE_DENIED');
  return project.rootPath;
}
export function registerCaptureReplayReadHandlers(): void {
  ipcMain.handle('capture:getReplaySelection', (_event, ...args: unknown[]) => {
    const [scope] = parseIpcArgs(SessionScopeArgsSchema, args, { label: 'capture:getReplaySelection', maxBytes: 1024 });
    return replayHistoryStore.readSelection(authorize(scope), scope.sessionId);
  });
  ipcMain.handle('capture:readLivePreview', async (_event, ...args: unknown[]) => {
    const [scope] = parseIpcArgs(SessionScopeArgsSchema, args, { label: 'capture:readLivePreview', maxBytes: 1024 });
    authorize(scope);
    return replayLivePreviewStore.read(scope.sessionId);
  });
}
