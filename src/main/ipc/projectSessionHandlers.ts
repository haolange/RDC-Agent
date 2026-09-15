import { dialog, ipcMain } from 'electron';
import type {
  ProjectInputRecord,
  RunSummary,
  SessionRecord,
} from '@shared/types/session';
import { runExecutionService } from '../workflow/debugger/RunExecutionService';
import { agentOrchestrator } from '../workflow/debugger/AgentOrchestrator';
import { storageAdapter } from '../sessions/StorageAdapter';
import { attachmentStagingService } from '../conversation/AttachmentStagingService';
import { rdxCliInvokerService } from '../tools/RdxCliInvokerService';
import type { WorkbenchIpcContext } from './workbenchContext';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { EmptyArgsSchema } from './validation/commonIpcSchemas';
import {
  ProjectAddArgsSchema,
  ProjectInputsImportArgsSchema,
  ProjectInputsImportPathsArgsSchema,
  ProjectInputsListArgsSchema,
  ProjectInputsRefreshArgsSchema,
  ProjectRemoveArgsSchema,
  ProjectRenameArgsSchema,
  ProjectSelectArgsSchema,
  RunListArgsSchema,
  SessionCreateArgsSchema,
  SessionIdOnlyArgsSchema,
  SessionListArgsSchema,
  SessionRenameArgsSchema,
  SessionApplyDeclaredHandoffArgsSchema,
  SessionSetAgentIdArgsSchema,
  SessionSetModelOverrideArgsSchema,
} from './validation/projectSessionSchemas';
import { createSessionWithHooks, removeSessionWithHooks } from '../hooks/sessionLifecycle';
import { conversationService } from '../conversation/ConversationService';
import { applyDeclaredHandoff } from '../conversation/applyDeclaredHandoff';
import { projectSessionForClient } from '../sessions/projectSessionHandoff';
import { resolveEnabledAgentDefinition } from '../conversation/ConversationRoutePreflight';
import { classifyAgentToolEligibility, describeAgentToolIneligibility, isAgentToolExecutableModel } from '@shared/utils/agentToolCapability';
import { loadProviderSurface } from '../provider-catalog/ProviderCatalogRegistry';
import { resolveEffectiveModel } from '../settings/EffectiveModelResolver';
import { settingsService } from '../settings/SettingsService';
import { registerProjectInputLifecycleHandlers } from './projectInputLifecycleHandlers';
import { rdxSessionService } from '../sessions';

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
  registerProjectInputLifecycleHandlers(context);

  ipcMain.handle('project:list', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'project:list', maxBytes: 1024 });
    return { projects: storageAdapter.listProjects() };
  });

  ipcMain.handle('project:add', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [rootPath] = parseIpcArgs(ProjectAddArgsSchema, rawArgs, {
        label: 'project:add',
        maxBytes: 8 * 1024,
      });
      const project = await storageAdapter.createProject(rootPath);
      await context.selectCurrentProject(project.projectId);
      return { success: true, project };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('project:select', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [projectId] = parseIpcArgs(ProjectSelectArgsSchema, rawArgs, {
        label: 'project:select',
        maxBytes: 4 * 1024,
      });
      const selection = await context.selectCurrentProject(projectId);
      if (!selection.project) {
        return { success: false, error: `Project not found: ${projectId}` };
      }
      return {
        success: true,
        project: selection.project,
        currentSession: selection.currentSession
          ? projectSessionForClient(selection.currentSession)
          : null,
        currentRun: selection.currentRun,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('project:rename', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [projectId, newName] = parseIpcArgs(ProjectRenameArgsSchema, rawArgs, {
        label: 'project:rename',
        maxBytes: 4 * 1024,
      });
      const project = storageAdapter.renameProject(projectId, newName);
      return { success: true, project };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('project:remove', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [projectId] = parseIpcArgs(ProjectRemoveArgsSchema, rawArgs, {
        label: 'project:remove',
        maxBytes: 4 * 1024,
      });
      await Promise.all(storageAdapter.listSessions(projectId).map(async (session) => {
        const stopped = await conversationService.cancelActiveTurn({ sessionId: session.sessionId });
        if (!stopped.success) throw new Error(stopped.error || `Failed to stop session ${session.sessionId}.`);
        await rdxSessionService.clearOpenedCaptureForSession({ projectId, sessionId: session.sessionId });
      }));
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

  ipcMain.handle('project:inputs:list', async (_event, ...rawArgs: unknown[]) => {
    const [projectId] = parseIpcArgs(ProjectInputsListArgsSchema, rawArgs, {
      label: 'project:inputs:list',
      maxBytes: 4 * 1024,
    });
    return { inputs: await storageAdapter.listProjectInputs(projectId) };
  });

  ipcMain.handle('project:inputs:refresh', async (_event, ...rawArgs: unknown[]) => {
    const [projectId] = parseIpcArgs(ProjectInputsRefreshArgsSchema, rawArgs, {
      label: 'project:inputs:refresh',
      maxBytes: 4 * 1024,
    });
    const inputs = await storageAdapter.refreshProjectInputs(projectId);
    context.broadcastToRenderer('project:inputsChanged', { projectId, inputs });
    return { inputs };
  });

  ipcMain.handle('project:inputs:import', async (_event, ...rawArgs: unknown[]) => {
    const [projectId] = parseIpcArgs(ProjectInputsImportArgsSchema, rawArgs, {
      label: 'project:inputs:import',
      maxBytes: 4 * 1024,
    });
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'RenderDoc Capture', extensions: ['rdc'] }],
      properties: ['openFile', 'multiSelections'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, inputs: await storageAdapter.listProjectInputs(projectId) };
    }

    const inputs = await storageAdapter.importProjectInputs(projectId, result.filePaths);
    context.broadcastToRenderer('project:inputsChanged', { projectId, inputs });
    return { success: true, inputs };
  });

  ipcMain.handle('project:inputs:importPaths', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [projectId, filePaths] = parseIpcArgs(ProjectInputsImportPathsArgsSchema, rawArgs, {
        label: 'project:inputs:importPaths',
        maxBytes: 64 * 1024,
      });
      const inputs = await storageAdapter.importProjectInputs(projectId, filePaths);
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

  ipcMain.handle('session:list', async (_event, ...rawArgs: unknown[]) => {
    const [projectId] = parseIpcArgs(SessionListArgsSchema, rawArgs, {
      label: 'session:list',
      maxBytes: 4 * 1024,
      padTo: 1,
    });
    const resolvedProjectId = projectId || state.currentProjectId;
    if (!resolvedProjectId) {
      return { sessions: [] as SessionRecord[] };
    }
    return { sessions: storageAdapter.listSessions(resolvedProjectId).map(projectSessionForClient) };
  });

  ipcMain.handle('session:create', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [projectId, title] = parseIpcArgs(SessionCreateArgsSchema, rawArgs, {
        label: 'session:create',
        maxBytes: 4 * 1024,
        padTo: 2,
      });
      const session = await createSessionWithHooks(projectId, title);
      state.currentProjectId = session.projectId;
      state.currentSessionId = session.sessionId;
      state.currentRunId = null;
      await storageAdapter.setCurrentSessionId(session.sessionId);
      return { success: true, session };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('session:rename', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [id, title] = parseIpcArgs(SessionRenameArgsSchema, rawArgs, {
        label: 'session:rename',
        maxBytes: 4 * 1024,
      });
      const trimmedTitle = title.trim();
      if (!trimmedTitle) {
        return { success: false, error: 'Session 名称不能为空。' };
      }

      const session = storageAdapter.updateSession(id, { title: trimmedTitle });
      if (!session) {
        return { success: false, error: `Session not found: ${id}` };
      }

      return { success: true, session };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('session:remove', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [id] = parseIpcArgs(SessionIdOnlyArgsSchema, rawArgs, {
        label: 'session:remove',
        maxBytes: 4 * 1024,
      });
      const session = storageAdapter.readSession(id);
      if (!session) {
        return { success: false, error: `Session not found: ${id}` };
      }

      const stopped = await conversationService.cancelActiveTurn({ sessionId: id });
      if (!stopped.success) throw new Error(stopped.error || `Failed to stop session ${id}.`);

      const runs = storageAdapter.listRuns(id);
      const activeRun = runs.find((run) => ['queued', 'running', 'stopping'].includes(run.status));
      if (activeRun) {
        runExecutionService.stopRun(activeRun.runId);
        rdxCliInvokerService.abortRun(activeRun.runId);
        await context.setRunLifecycleState(id, activeRun.runId, {
          status: 'cancelled',
          stopReason: 'Session removed',
          stoppedAt: Date.now(),
          finishedAt: Date.now(),
        });
      }

      await removeSessionWithHooks(id);
      attachmentStagingService.releaseBySessionId(id);
      agentOrchestrator.syncSessionSlots(id);
      const remainingSessions = storageAdapter.listSessions(session.projectId);
      const nextSession = remainingSessions[0]
        ? projectSessionForClient(remainingSessions[0])
        : null;
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
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('session:select', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [id] = parseIpcArgs(SessionIdOnlyArgsSchema, rawArgs, {
        label: 'session:select',
        maxBytes: 4 * 1024,
      });
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
        session: projectSessionForClient(session),
        currentRun,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('session:setModelOverride', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [id, modelOverride] = parseIpcArgs(SessionSetModelOverrideArgsSchema, rawArgs, {
        label: 'session:setModelOverride',
        maxBytes: 4 * 1024,
      });
      const session = storageAdapter.readSession(id);
      if (!session) {
        return { success: false, error: `Session not found: ${id}` };
      }
      if (modelOverride) {
        await loadProviderSurface(modelOverride.providerId);
        const model = resolveEffectiveModel(
          modelOverride.providerId,
          modelOverride.modelId,
          settingsService.getAll(),
        );
        if (!model || !isAgentToolExecutableModel(model)) {
          const eligibility = model
            ? classifyAgentToolEligibility(model)
            : 'unavailable';
          const detail = eligibility === 'executable'
            ? `MODEL_UNAVAILABLE: ${modelOverride.providerId}:${modelOverride.modelId}`
            : describeAgentToolIneligibility(eligibility, modelOverride.providerId, modelOverride.modelId).technicalMessage;
          return {
            success: false,
            error: detail,
          };
        }
      }
      const updated = storageAdapter.updateSession(id, { modelOverride });
      return { success: true, session: updated };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('session:setAgentId', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [id, agentId] = parseIpcArgs(SessionSetAgentIdArgsSchema, rawArgs, {
        label: 'session:setAgentId',
        maxBytes: 4 * 1024,
      });
      const session = storageAdapter.readSession(id);
      if (!session) {
        return { success: false, error: `Session not found: ${id}` };
      }
      const projectRoot = storageAdapter.getProjectById(session.projectId)?.rootPath ?? null;
      const definition = resolveEnabledAgentDefinition(agentId, projectRoot);
      if (!definition) {
        return { success: false, error: `CONVERSATION_AGENT_UNAVAILABLE: requested profile \`${agentId}\` is not enabled.` };
      }
      const updated = storageAdapter.updateSession(id, { agentId });
      return { success: true, session: updated };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('session:applyDeclaredHandoff', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [id, agent, label] = parseIpcArgs(SessionApplyDeclaredHandoffArgsSchema, rawArgs, {
        label: 'session:applyDeclaredHandoff',
        maxBytes: 4 * 1024,
      });
      return applyDeclaredHandoff({ sessionId: id, agent, label });
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('run:list', async (_event, ...rawArgs: unknown[]) => {
    const [sessionId] = parseIpcArgs(RunListArgsSchema, rawArgs, {
      label: 'run:list',
      maxBytes: 4 * 1024,
    });
    return { runs: storageAdapter.listRuns(sessionId) };
  });
}
