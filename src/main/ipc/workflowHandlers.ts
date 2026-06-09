import { ipcMain } from 'electron';
import type { RunContextUsageSummary, RunSummary } from '@shared/types/session';
import { storageAdapter } from '../sessions/StorageAdapter';
import { rdxSessionService } from '../index';
import { debuggerLlmService } from '../settings/DebuggerLlmService';
import { runExecutionService } from '../workflow/debugger/RunExecutionService';
import { debuggerRuntime } from '../workflow/debugger/DebuggerRuntime';
import type { WorkbenchIpcContext } from './workbenchContext';

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

  ipcMain.handle('workflow:resume', async (_event, sessionId?: string) => {
    try {
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

  ipcMain.handle('workflow:stop', async (_event, runId?: string) => {
    const targetRunId = runId || state.currentRunId;
    if (!targetRunId) {
      return { success: false, error: 'No active run.' };
    }
    const result = await debuggerRuntime.stopRun(targetRunId);
    context.broadcastToRenderer('capture:openedStateChanged', null);
    context.broadcastToRenderer('context:changed', rdxSessionService.snapshotContext());
    return result;
  });

  ipcMain.handle('workflow:getRunUsage', async (_event, runId?: string) => {
    const targetRunId = runId || state.currentRunId;
    if (!targetRunId) {
      return { usage: null as RunContextUsageSummary | null };
    }

    return {
      usage: debuggerLlmService.getRunContextUsage(targetRunId),
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
