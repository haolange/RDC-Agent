import { ipcMain } from 'electron';
import { nowIso } from '@shared/utils/id';
import { traceProjectionRefreshService } from '../agent-runtime/orchestration/TraceProjectionRefreshService';
import { projectWorkspaceStore, sessionRecordStore } from '../sessions/store/sessionStores';
import { rdcSessionService } from '../rdc/RdcSessionService';
import { runExecutionService } from '../agent-runtime/orchestration/RunExecutionService';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { EmptyArgsSchema } from './validation/commonIpcSchemas';
import {
  WorkflowGetRunUsageArgsSchema,
  WorkflowResumeArgsSchema,
  WorkflowStopArgsSchema,
} from './validation/ipcSchemas';
import { readRunContextUsage } from './runContextUsageBoundary';
import type { WorkflowState } from '@shared/types/workflow';
import type { RunContextUsageReadResult } from '@shared/types/session';
import type { WorkbenchIpcContext } from './workbenchContext';

function readWorkflowState(sessionId: string, runId: string | null): WorkflowState | null {
  const run = runId
    ? sessionRecordStore.listRuns(sessionId).find((entry) => entry.runId === runId) ?? null
    : sessionRecordStore.getLatestRun(sessionId);
  if (!run) return null;
  return {
    caseId: run.caseId,
    runId: run.runId,
    sessionId: run.sessionId,
    blockers: [],
    reasoningSummaries: [],
    lastUpdated: nowIso(),
  };
}

export function registerWorkflowHandlers(context: WorkbenchIpcContext): void {
  const { state } = context;

  ipcMain.handle('workflow:getState', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'workflow:getState', maxBytes: 1024 });
    if (!state.currentSessionId) {
      return null;
    }

    try {
      return readWorkflowState(state.currentSessionId, state.currentRunId);
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
        projectWorkspaceStore.setCurrentSessionId(sessionId);
        state.currentRunId = sessionRecordStore.getLatestRun(sessionId)?.runId || null;
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
      const result = runExecutionService.stopRun(targetRunId)
        ? { success: true }
        : { success: false, error: 'No active run.' };
      const session = state.currentSessionId ? sessionRecordStore.readSession(state.currentSessionId) : null;
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
}
