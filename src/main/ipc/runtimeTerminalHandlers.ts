import { ipcMain } from 'electron';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { RuntimeLogListArgsSchema } from './validation/ipcSchemas';
import type { RuntimeLogScope } from '@shared/types/runtimeLog';

export function registerRuntimeTerminalHandlers(): void {
  ipcMain.handle('runtimeLog:list', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(RuntimeLogListArgsSchema, rawArgs, {
      label: 'runtimeLog:list',
      maxBytes: 8 * 1024,
    });
    return {
      entries: runtimeLogService.list(request.scope as RuntimeLogScope, request.sessionId),
    };
  });
}
