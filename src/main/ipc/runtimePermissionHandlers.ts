import { ipcMain } from 'electron';
import { runtimePermissionStateService } from '../agent-runtime/permissions/RuntimePermissionStateService';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { EmptyArgsSchema } from './validation/commonIpcSchemas';
import type { WorkbenchIpcContext } from './workbenchContext';

let unsubscribe: (() => void) | undefined;

export function registerRuntimePermissionHandlers(context: WorkbenchIpcContext): void {
  ipcMain.handle('runtime:getPermissionState', (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'runtime:getPermissionState', maxBytes: 1024 });
    return runtimePermissionStateService.getSnapshot();
  });
  unsubscribe?.();
  unsubscribe = runtimePermissionStateService.subscribe((snapshot) => {
    context.broadcastToRenderer('runtime:permissionStateChanged', snapshot);
  });
}
