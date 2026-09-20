import { ipcMain } from 'electron';
import { traceProjectionRefreshService } from '../agent-trace/TraceProjectionRefreshService';
import type { RunContextUsageReadResult, RunSummary } from '@shared/types/session';
import { storageAdapter } from '../sessions/StorageAdapter';
import { rdcSessionService } from '../sessions';
import { runExecutionService } from '../workflow/debugger/RunExecutionService';
import { debuggerRuntime } from '../workflow/debugger/DebuggerRuntime';
import type { WorkbenchIpcContext } from './workbenchContext';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { EmptyArgsSchema } from './validation/commonIpcSchemas';
import {
  WorkflowGetRunUsageArgsSchema,
  WorkflowResumeArgsSchema,
  WorkflowStopArgsSchema,
} from './validation/ipcSchemas';
import { readRunContextUsage } from './runContextUsageBoundary';

export function registerWorkflowHandlers(context: WorkbenchIpcContext): void {
  const { state } = context;

  ipcMain.handle('workflow:getState', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'workflow:getState', maxBytes: 1024 });
    if (!state.currentSessionId) {
      return null;
    }

    try {
      return await debuggerRuntime.getWorkflowState(state.currentSessionId, state.currentRunId || undefined);
    } catch (error) {
      console.error('[IPC] Failed to get workflow state:', error);
      return null;
    }
  });

  ipcMain.handle('workflow:resume', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [sessionId] = parseIpcArgs(WorkflowResumeArgsSchema, rawArgs, {
        label: 'workflow:resume',
        maxBytes: 4 * 1024,
        padTo: 1,
      });
      if (sessionId) {
        state.currentSessionId = sessionId;
        await storageAdapter.setCurrentSessionId(sessionId);
        state.currentRunId = storageAdapter.getLatestRun(sessionId)?.runId || null;
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('workflow:stop', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [runId] = parseIpcArgs(WorkflowStopArgsSchema, rawArgs, {
        label: 'workflow:stop',
        maxBytes: 4 * 1024,
        padTo: 1,
      });
      const targetRunId = runId || state.currentRunId;
      if (!targetRunId) {
        return { success: false, error: 'No active run.' };
      }
      const result = await debuggerRuntime.stopRun(targetRunId);
      const session = state.currentSessionId ? storageAdapter.readSession(state.currentSessionId) : null;
      if (session) {
        const scope = { projectId: session.projectId, sessionId: session.sessionId };
        context.broadcastToRenderer('capture:openedStateChanged', {
          ...scope,
          payload: rdcSessionService.snapshotOpenedCaptureForSession(scope),
        });
        context.broadcastToRenderer('context:changed', {
          ...scope,
          payload: rdcSessionService.snapshotContextForSession(scope),
        });
        traceProjectionRefreshService.schedule(session.sessionId);
      }
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workflow:getRunUsage', async (_event, ...rawArgs: unknown[]): Promise<RunContextUsageReadResult> => {
    const [request] = parseIpcArgs(WorkflowGetRunUsageArgsSchema, rawArgs, {
      label: 'workflow:getRunUsage',
      maxBytes: 4 * 1024,
      padTo: 1,
    });
    return readRunContextUsage(request);
  });

  ipcMain.handle('workflow:listRuns', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'workflow:listRuns', maxBytes: 1024 });
    if (!state.currentSessionId) {
      return { runs: [] as RunSummary[] };
    }
    return { runs: storageAdapter.listRuns(state.currentSessionId) };
  });

  ipcMain.handle('workflow:listActiveRuns', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'workflow:listActiveRuns', maxBytes: 1024 });
    return { runs: runExecutionService.listActiveRuns() };
  });
}
