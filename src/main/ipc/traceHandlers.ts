import { ipcMain } from 'electron';
import { traceService } from '../agent-trace/TraceService';
import type { WorkbenchIpcContext } from './workbenchContext';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { TraceGetProjectionArgsSchema } from './validation/traceSchemas';

export function registerTraceHandlers(context: WorkbenchIpcContext): void {
  const { state } = context;

  ipcMain.handle('trace:getProjection', async (_event, ...rawArgs: unknown[]) => {
    const [sessionId] = parseIpcArgs(TraceGetProjectionArgsSchema, rawArgs, {
      label: 'trace:getProjection',
      maxBytes: 4 * 1024,
      padTo: 1,
    });
    const targetSessionId = sessionId || state.currentSessionId;
    if (!targetSessionId) {
      return { success: false, error: 'No active session.' };
    }
    return traceService.getSession(targetSessionId);
  });
}
