import { ipcMain } from 'electron';
import { traceService } from '../agent-trace/TraceService';
import { debuggerRuntime } from '../workflow/debugger/DebuggerRuntime';
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
    return debuggerRuntime.getTraceProjection(targetSessionId);
  });

  ipcMain.handle('trace:exportRun', async (_event, runId: string) => {
    return traceService.exportRun(runId);
  });

  ipcMain.handle('trace:switchBranch', async (_event, sessionId: string, branchId: string) => {
    return debuggerRuntime.switchTraceBranch(sessionId, branchId);
  });

  ipcMain.handle('trace:exportSession', async (_event, sessionId: string, options?: unknown) => {
    return debuggerRuntime.exportTraceSession(sessionId, options as Parameters<typeof debuggerRuntime.exportTraceSession>[1]);
  });
}
