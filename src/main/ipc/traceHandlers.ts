import { ipcMain } from 'electron';
import { AppError } from '@shared/errors/appError';
import { traceService } from '../agent-trace/TraceService';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { TraceGetProjectionArgsSchema } from './validation/traceSchemas';
import type { WorkbenchIpcContext } from './workbenchContext';

export function registerTraceHandlers(context: WorkbenchIpcContext): void {
  const { state } = context;

  ipcMain.handle('trace:getProjection', async (_event, ...rawArgs: unknown[]) => {
    const [sessionId] = parseIpcArgs(TraceGetProjectionArgsSchema, rawArgs, {
      label: 'trace:getProjection',
      maxBytes: 4 * 1024,
      padTo: 1,
    });
    const targetSessionId = sessionId || state.currentSessionId;
    if (!targetSessionId) throw new AppError('SESSION_NOT_FOUND', 'no active session.');
    return traceService.getSession(targetSessionId);
  });
}
