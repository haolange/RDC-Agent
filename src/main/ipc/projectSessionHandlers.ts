import { dialog, ipcMain } from 'electron';
import type {
  ProjectInputRecord,
  RunSummary,
  SessionAttachmentRecord,
  SessionOutputRecord,
  SessionRecord,
} from '@shared/types/session';
import { runExecutionService } from '../workflow/debugger/RunExecutionService';
import { storageAdapter } from '../sessions/StorageAdapter';
import { toolBridge } from '../tools/ToolBridge';
import type { WorkbenchIpcContext } from './workbenchContext';

const STALE_RECOVERABLE_RUN_STATUSES: Array<RunSummary['status']> = [
  'planning',
  'queued',
  'running',
  'stopping',
];

async function recoverStaleRunOnSelection(run: RunSummary | null): Promise<RunSummary | null> {
  if (!run || !STALE_RECOVERABLE_RUN_STATUSES.includes(run.status)) {
    return run;
  }
  const isActive = runExecutionService.listActiveRuns().some((activeRun) => activeRun.runId === run.runId);
  if (isActive) {
    return run;
  }

  await storageAdapter.updateRun(run.sessionId, run.runId, {
    status: 'interrupted',
    stopReason: 'Recovered after app restart',
    stoppedAt: Date.now(),
    finishedAt: Date.now(),
  });
  return storageAdapter.getLatestRun(run.sessionId);
}

export function registerProjectSessionHandlers(context: WorkbenchIpcContext): void {
  const { state } = context;

  ipcMain.handle('project:list', async () => {
    return { projects: storageAdapter.listProjects() };
  });

  ipcMain.handle('project:add', async (_event, rootPath: string) => {
    try {
      const project = storageAdapter.createProject(rootPath);
      await context.selectCurrentProject(project.projectId);
      return { success: true, project };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('project:select', async (_event, projectId: string) => {
    try {
      const selection = await context.selectCurrentProject(projectId);
      if (!selection.project) {
        return { success: false, error: `Project not found: ${projectId}` };
      }
      return {
        success: true,
        project: selection.project,
        currentSession: selection.currentSession,
        currentRun: selection.currentRun,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('project:rename', async (_event, projectId: string, newName: string) => {
    try {
      const project = storageAdapter.renameProject(projectId, newName);
      return { success: true, project };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('project:remove', async (_event, projectId: string) => {
    try {
      storageAdapter.removeProject(projectId);
      if (state.currentProjectId === projectId) {
        state.currentProjectId = null;
        state.currentSessionId = null;
        state.currentRunId = null;
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('project:inputs:list', async (_event, projectId: string) => {
    return { inputs: storageAdapter.listProjectInputs(projectId) };
  });

  ipcMain.handle('project:inputs:refresh', async (_event, projectId: string) => {
    const inputs = storageAdapter.refreshProjectInputs(projectId);
    context.broadcastToRenderer('project:inputsChanged', { projectId, inputs });
    return { inputs };
  });

  ipcMain.handle('project:inputs:import', async (_event, projectId: string) => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'RenderDoc Capture', extensions: ['rdc'] }],
      properties: ['openFile', 'multiSelections'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, inputs: storageAdapter.listProjectInputs(projectId) };
    }

    const inputs = storageAdapter.importProjectInputs(projectId, result.filePaths);
    context.broadcastToRenderer('project:inputsChanged', { projectId, inputs });
    return { success: true, inputs };
  });

  ipcMain.handle('project:inputs:importPaths', async (_event, projectId: string, filePaths: string[]) => {
    try {
      const inputs = storageAdapter.importProjectInputs(projectId, filePaths ?? []);
      context.broadcastToRenderer('project:inputsChanged', { projectId, inputs });
      return { success: true, inputs };
    } catch (error) {
      return {
        success: false,
        inputs: [] as ProjectInputRecord[],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('session:list', async (_event, projectId?: string) => {
    const resolvedProjectId = projectId || state.currentProjectId;
    if (!resolvedProjectId) {
      return { sessions: [] as SessionRecord[] };
    }
    return { sessions: storageAdapter.listSessions(resolvedProjectId) };
  });

  ipcMain.handle('session:create', async (_event, projectId: string, title?: string) => {
    try {
      const session = storageAdapter.createSession(projectId, title);
      state.currentProjectId = session.projectId;
      state.currentSessionId = session.sessionId;
      state.currentRunId = null;
      await storageAdapter.setCurrentSessionId(session.sessionId);
      return { success: true, session };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('session:rename', async (_event, id: string, title: string) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      return { success: false, error: 'Session 名称不能为空。' };
    }

    const session = storageAdapter.updateSession(id, { title: trimmedTitle });
    if (!session) {
      return { success: false, error: `Session not found: ${id}` };
    }

    return { success: true, session };
  });

  ipcMain.handle('session:remove', async (_event, id: string) => {
    const session = storageAdapter.readSession(id);
    if (!session) {
      return { success: false, error: `Session not found: ${id}` };
    }

    const runs = storageAdapter.listRuns(id);
    const activeRun = runs.find((run) => ['queued', 'running', 'stopping'].includes(run.status));
    if (activeRun) {
      runExecutionService.stopRun(activeRun.runId);
      toolBridge.abortRun(activeRun.runId);
      await context.setRunLifecycleState(id, activeRun.runId, {
        status: 'cancelled',
        lastStage: activeRun.lastStage,
        stopReason: 'Session removed',
        stoppedAt: Date.now(),
        finishedAt: Date.now(),
      });
    }

    storageAdapter.removeSession(id);
    const remainingSessions = storageAdapter.listSessions(session.projectId);
    const nextSession = remainingSessions[0] || null;
    let nextRun: RunSummary | null = null;
    if (state.currentSessionId === id) {
      state.currentSessionId = nextSession?.sessionId || null;
      state.currentRunId = nextSession?.lastRunId || null;
      state.currentProjectId = session.projectId;
      if (state.currentSessionId) {
        await storageAdapter.setCurrentSessionId(state.currentSessionId);
        nextRun = storageAdapter.getLatestRun(state.currentSessionId);
      } else {
        await storageAdapter.setCurrentSessionId(null);
        storageAdapter.setCurrentProjectId(session.projectId);
      }
    }

    return { success: true, nextSession, nextRun };
  });

  ipcMain.handle('session:select', async (_event, id: string) => {
    const session = storageAdapter.readSession(id);
    if (!session) {
      return { success: false, error: `Session not found: ${id}` };
    }

    state.currentSessionId = id;
    state.currentProjectId = session.projectId;
    const currentRun = await recoverStaleRunOnSelection(storageAdapter.getLatestRun(id));
    state.currentRunId = currentRun?.runId || session.lastRunId || null;
    await storageAdapter.setCurrentSessionId(id);
    return {
      success: true,
      session,
      currentRun,
    };
  });

  ipcMain.handle('session:attachments:list', async (_event, sessionId: string) => {
    return {
      attachments: storageAdapter.listSessionAttachments(sessionId),
    };
  });

  ipcMain.handle('session:outputs:list', async (_event, sessionId: string, runId?: string) => {
    if (!sessionId) {
      return { outputs: [] as SessionOutputRecord[] };
    }
    return {
      outputs: await context.buildSessionOutputs(sessionId, runId),
    };
  });

  ipcMain.handle('session:attachments:import', async (_event, sessionId: string, filePaths: string[]) => {
    try {
      return {
        success: true,
        attachments: storageAdapter.importSessionAttachments(sessionId, filePaths ?? []),
      };
    } catch (error) {
      return {
        success: false,
        attachments: [] as SessionAttachmentRecord[],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('run:list', async (_event, sessionId: string) => {
    return { runs: storageAdapter.listRuns(sessionId) };
  });
}
