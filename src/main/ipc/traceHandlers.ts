import { ipcMain } from 'electron';
import { traceService } from '../agent-trace/TraceService';
import type { WorkbenchIpcContext } from './workbenchContext';

export function registerTraceHandlers(context: WorkbenchIpcContext): void {
  const { state } = context;

  ipcMain.handle('trace:getRun', async (_event, runId: string) => {
    const run = traceService.getRun(runId);
    return { run };
  });

  ipcMain.handle('trace:getEvents', async (_event, runId: string, afterSeq?: number) => {
    return { events: traceService.getEvents(runId, afterSeq ?? 0) };
  });

  ipcMain.handle('trace:getProjection', async (_event, sessionId?: string) => {
    const targetSessionId = sessionId || state.currentSessionId;
    if (!targetSessionId) {
      return { success: false, error: 'No active session.' };
    }
    const result = await traceService.getSession(targetSessionId);
    return result;
  });

  ipcMain.handle('trace:exportRun', async (_event, runId: string) => {
    return traceService.exportRun(runId);
  });
}
