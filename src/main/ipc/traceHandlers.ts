import { ipcMain } from 'electron';
import { traceService } from '../agent-trace/TraceService';
import { debuggerRuntime } from '../workflow/debugger/DebuggerRuntime';
import type { WorkbenchIpcContext } from './workbenchContext';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import {
  TraceExportRunArgsSchema,
  TraceGetEventsArgsSchema,
  TraceGetProjectionArgsSchema,
  TraceGetRunArgsSchema,
  TraceSwitchBranchArgsSchema,
} from './validation/traceSchemas';

export function registerTraceHandlers(context: WorkbenchIpcContext): void {
  const { state } = context;

  ipcMain.handle('trace:getRun', async (_event, ...rawArgs: unknown[]) => {
    const [runId] = parseIpcArgs(TraceGetRunArgsSchema, rawArgs, {
      label: 'trace:getRun',
      maxBytes: 4 * 1024,
    });
    const run = traceService.getRun(runId);
    return { run };
  });

  ipcMain.handle('trace:getEvents', async (_event, ...rawArgs: unknown[]) => {
    const [runId, afterSeq] = parseIpcArgs(TraceGetEventsArgsSchema, rawArgs, {
      label: 'trace:getEvents',
      maxBytes: 4 * 1024,
      padTo: 2,
    });
    return { events: traceService.getEvents(runId, afterSeq ?? 0) };
  });

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
    return debuggerRuntime.getTraceProjection(targetSessionId);
  });

  ipcMain.handle('trace:exportRun', async (_event, ...rawArgs: unknown[]) => {
    const [runId] = parseIpcArgs(TraceExportRunArgsSchema, rawArgs, {
      label: 'trace:exportRun',
      maxBytes: 4 * 1024,
    });
    return traceService.exportRun(runId);
  });

  ipcMain.handle('trace:switchBranch', async (_event, ...rawArgs: unknown[]) => {
    const [sessionId, branchId] = parseIpcArgs(TraceSwitchBranchArgsSchema, rawArgs, {
      label: 'trace:switchBranch',
      maxBytes: 4 * 1024,
    });
    return debuggerRuntime.switchTraceBranch(sessionId, branchId);
  });
}
