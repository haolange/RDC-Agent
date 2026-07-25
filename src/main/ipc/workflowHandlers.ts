import { ipcMain } from 'electron';
import type { RunContextUsageSummary, RunSummary } from '@shared/types/session';
import { storageAdapter } from '../sessions/StorageAdapter';
import { rdxSessionService } from '../sessions';
import { debuggerLlmService } from '../settings/DebuggerLlmService';
import { runExecutionService } from '../workflow/debugger/RunExecutionService';
import { debuggerRuntime } from '../workflow/debugger/DebuggerRuntime';
import type { WorkbenchIpcContext } from './workbenchContext';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import {
  WorkflowGetRunUsageArgsSchema,
  WorkflowResumeArgsSchema,
  WorkflowStopArgsSchema,
} from './validation/ipcSchemas';

export function registerWorkflowHandlers(context: WorkbenchIpcContext): void {
  const { state } = context;

  ipcMain.handle('workflow:getState', async () => {
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
      context.broadcastToRenderer('capture:openedStateChanged', null);
      context.broadcastToRenderer('context:changed', rdxSessionService.snapshotContext());
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workflow:getRunUsage', async (_event, ...rawArgs: unknown[]) => {
    const [runId, sessionId] = parseIpcArgs(WorkflowGetRunUsageArgsSchema, rawArgs, {
      label: 'workflow:getRunUsage',
      maxBytes: 4 * 1024,
      padTo: 2,
    });
    const targetKey = runId ?? sessionId ?? state.currentRunId;
    if (!targetKey) {
      return { usage: null as RunContextUsageSummary | null };
    }

    const fallbackSessionId = sessionId ?? state.currentSessionId ?? null;
    return {
      usage: debuggerLlmService.getRunContextUsage(targetKey, fallbackSessionId),
    };
  });

  ipcMain.handle('workflow:listRuns', async () => {
    if (!state.currentSessionId) {
      return { runs: [] as RunSummary[] };
    }
    return { runs: storageAdapter.listRuns(state.currentSessionId) };
  });

  ipcMain.handle('workflow:listActiveRuns', async () => {
    return { runs: runExecutionService.listActiveRuns() };
  });
}
