import { dialog, ipcMain } from 'electron';
import { AppError } from '@shared/errors/appError';
import { createSessionWithHooks, removeSessionWithHooks } from '../rdc/sessionLifecycle';
import { conversationService } from '../conversation/ConversationService';
import { traceService } from '../agent-trace/TraceService';
import { applyDeclaredHandoff } from '../agent-runtime/interactions/applyDeclaredHandoff';
import { sessionRevisions } from '../sessions/store/SessionRevisionRegistry';
import { resolveEnabledAgentDefinition } from '../settings/agent-manifests/effectiveAgentSnapshot';
import { rdcCliInvokerService } from '../rdc/RdcCliInvokerService';
import { attachmentStagingService } from '../conversation/AttachmentStagingService';
import { projectWorkspaceStore, sessionRecordStore } from '../sessions/store/sessionStores';
import { agentOrchestrator } from '../agent-runtime/orchestration/agentRuntimeRoot';
import { runExecutionService } from '../agent-runtime/orchestration/RunExecutionService';
import { nativeMessage } from '../window/nativeI18n';
import { assertSessionModelExecutable } from '../agent-runtime/interactions/sessionModelGate';
import { rdcSessionService } from '../rdc/RdcSessionService';
import {
  ProjectAddArgsSchema,
  ProjectInputsImportArgsSchema,
  ProjectInputReferenceArgsSchema,
  ProjectInputsImportPathsArgsSchema,
  ProjectInputsListArgsSchema,
  ProjectInputsRefreshArgsSchema,
  ProjectRemoveArgsSchema,
  ProjectRenameArgsSchema,
  ProjectSelectArgsSchema,
  SessionCreateArgsSchema,
  SessionIdOnlyArgsSchema,
  SessionListArgsSchema,
  SessionRenameArgsSchema,
  SessionApplyDeclaredHandoffArgsSchema,
  SessionSetAgentIdArgsSchema,
  SessionSetModelOverrideArgsSchema,
} from './validation/projectSessionSchemas';
import { EmptyArgsSchema } from './validation/commonIpcSchemas';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { requireActiveSessionOwner } from './sessionOwnerGate';
import { SessionModelLanes } from './sessionModelLanes';
import { registerProjectInputLifecycleHandlers } from './projectInputLifecycleHandlers';
import type { WorkbenchIpcContext } from './workbenchContext';
import type { RunSummary, SessionRecordSnapshot } from '@shared/types/session';
import type { IpcChannelTable } from './invokeRegistry';

const STALE_RECOVERABLE_RUN_STATUSES: Array<RunSummary['status']> = ['planning', 'queued', 'running', 'stopping'];

async function recoverStaleRunOnSelection(run: RunSummary | null): Promise<RunSummary | null> {
  if (!run || !STALE_RECOVERABLE_RUN_STATUSES.includes(run.status)) {
    return run;
  }
  const isActive =
    (run.turnId ? conversationService.isTurnActive(run.sessionId, run.turnId) : false) ||
    runExecutionService.listActiveRuns().some((activeRun) => activeRun.runId === run.runId);
  if (isActive) {
    return run;
  }

  await sessionRecordStore.updateRun(run.sessionId, run.runId, {
    status: 'interrupted',
    stopReason: 'Recovered after app restart',
    stoppedAt: Date.now(),
    finishedAt: Date.now(),
  });
  return sessionRecordStore.getLatestRun(run.sessionId);
}

export function registerProjectSessionHandlers(context: WorkbenchIpcContext): void {
  registerProjectInputLifecycleHandlers(context);
  sessionRevisions.subscribe((snapshot) => context.broadcastToRenderer('session:recordChanged', snapshot));
  const sessionModelLanes = new SessionModelLanes();
  const channels: IpcChannelTable = {
    ...projectChannels(context),
    ...projectInputChannels(context),
    ...sessionLifecycleChannels(context),
    ...activeSessionChannels(context, sessionModelLanes),
  };
  for (const [channel, handler] of Object.entries(channels)) ipcMain.handle(channel, handler);
}

/** Project registry: listing, adding, selecting, renaming and removing projects. */
function projectChannels(context: WorkbenchIpcContext): IpcChannelTable {
  const { state } = context;
  return {
    'project:list': async (_event, ...rawArgs: unknown[]) => {
      parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'project:list', maxBytes: 1024 });
      return { projects: projectWorkspaceStore.listProjects() };
    },
    'project:add': async (_event, ...rawArgs: unknown[]) => {
      const [rootPath] = parseIpcArgs(ProjectAddArgsSchema, rawArgs, { label: 'project:add', maxBytes: 8 * 1024 });
      const project = await projectWorkspaceStore.createProject(rootPath);
      await context.selectCurrentProject(project.projectId);
      return { project };
    },
    'project:select': async (_event, ...rawArgs: unknown[]) => {
      const [projectId] = parseIpcArgs(ProjectSelectArgsSchema, rawArgs, {
        label: 'project:select',
        maxBytes: 4 * 1024,
      });
      const selection = await context.selectCurrentProject(projectId);
      if (!selection.project) throw new AppError('PROJECT_NOT_FOUND', projectId);
      return {
        project: selection.project,
        currentSession: selection.currentSession,
        currentRun: selection.currentRun,
      };
    },
    'project:rename': async (_event, ...rawArgs: unknown[]) => {
      const [projectId, newName] = parseIpcArgs(ProjectRenameArgsSchema, rawArgs, {
        label: 'project:rename',
        maxBytes: 4 * 1024,
      });
      return { project: projectWorkspaceStore.renameProject(projectId, newName) };
    },
    'project:remove': async (_event, ...rawArgs: unknown[]) => {
      const [projectId] = parseIpcArgs(ProjectRemoveArgsSchema, rawArgs, {
        label: 'project:remove',
        maxBytes: 4 * 1024,
      });
      await Promise.all(
        sessionRecordStore.listSessions(projectId).map(async (session) => {
          await conversationService.cancelActiveTurn({ sessionId: session.sessionId });
          await rdcSessionService.clearOpenedCaptureForSession({ projectId, sessionId: session.sessionId });
        }),
      );
      projectWorkspaceStore.removeProject(projectId);
      if (state.currentProjectId === projectId) {
        state.currentProjectId = null;
        state.currentSessionId = null;
        state.currentRunId = null;
      }
    },
  };
}

/** Project inputs: listing, refreshing, importing and referencing captures, with the inputs-changed broadcast. */
function projectInputChannels(context: WorkbenchIpcContext): IpcChannelTable {
  return {
    'project:inputs:list': async (_event, ...rawArgs: unknown[]) => {
      const [projectId] = parseIpcArgs(ProjectInputsListArgsSchema, rawArgs, {
        label: 'project:inputs:list',
        maxBytes: 4 * 1024,
      });
      return { inputs: await projectWorkspaceStore.listProjectInputs(projectId) };
    },
    'project:inputs:refresh': async (_event, ...rawArgs: unknown[]) => {
      const [projectId] = parseIpcArgs(ProjectInputsRefreshArgsSchema, rawArgs, {
        label: 'project:inputs:refresh',
        maxBytes: 4 * 1024,
      });
      const inputs = await projectWorkspaceStore.refreshProjectInputs(projectId);
      context.broadcastToRenderer('project:inputsChanged', { projectId, inputs });
      return { inputs };
    },
    'project:inputs:import': async (_event, ...rawArgs: unknown[]) => {
      const [projectId] = parseIpcArgs(ProjectInputsImportArgsSchema, rawArgs, {
        label: 'project:inputs:import',
        maxBytes: 4 * 1024,
      });
      const result = await dialog.showOpenDialog({
        title: nativeMessage('selectCaptures'),
        filters: [{ name: nativeMessage('captureFilter'), extensions: ['rdc'] }],
        properties: ['openFile', 'multiSelections'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { inputs: await projectWorkspaceStore.listProjectInputs(projectId) };
      }

      const inputs = await projectWorkspaceStore.importProjectInputs(projectId, result.filePaths);
      context.broadcastToRenderer('project:inputsChanged', { projectId, inputs });
      return { inputs };
    },
    'project:inputs:importPaths': async (_event, ...rawArgs: unknown[]) => {
      const [projectId, filePaths] = parseIpcArgs(ProjectInputsImportPathsArgsSchema, rawArgs, {
        label: 'project:inputs:importPaths',
        maxBytes: 64 * 1024,
      });
      const inputs = await projectWorkspaceStore.importProjectInputs(projectId, filePaths);
      context.broadcastToRenderer('project:inputsChanged', { projectId, inputs });
      return { inputs };
    },
    'project:inputs:reference': async (_event, ...rawArgs: unknown[]) => {
      const [projectId, filePath] = parseIpcArgs(ProjectInputReferenceArgsSchema, rawArgs, {
        label: 'project:inputs:reference',
        maxBytes: 8192,
      });
      const inputs = await projectWorkspaceStore.referenceProjectInput(projectId, filePath);
      context.broadcastToRenderer('project:inputsChanged', { projectId, inputs });
      return { inputs };
    },
  };
}

/** Session lifecycle: listing, creating, renaming and removing sessions of a project. */
function sessionLifecycleChannels(context: WorkbenchIpcContext): IpcChannelTable {
  const { state } = context;
  return {
    'session:list': async (_event, ...rawArgs: unknown[]) => {
      const [projectId] = parseIpcArgs(SessionListArgsSchema, rawArgs, {
        label: 'session:list',
        maxBytes: 4 * 1024,
        padTo: 1,
      });
      const resolvedProjectId = projectId || state.currentProjectId;
      if (!resolvedProjectId) {
        return { sessions: [] as SessionRecordSnapshot[] };
      }
      return {
        sessions: sessionRecordStore
          .listSessions(resolvedProjectId)
          .map((session) => sessionRevisions.snapshot(session)),
      };
    },
    'session:create': async (_event, ...rawArgs: unknown[]) => {
      const [projectId, title] = parseIpcArgs(SessionCreateArgsSchema, rawArgs, {
        label: 'session:create',
        maxBytes: 4 * 1024,
        padTo: 2,
      });
      const session = await createSessionWithHooks(projectId, title);
      state.currentProjectId = session.projectId;
      state.currentSessionId = session.sessionId;
      state.currentRunId = null;
      projectWorkspaceStore.setCurrentSessionId(session.sessionId);
      return { session: sessionRevisions.snapshot(session) };
    },
    'session:rename': async (_event, ...rawArgs: unknown[]) => {
      const [id, title] = parseIpcArgs(SessionRenameArgsSchema, rawArgs, {
        label: 'session:rename',
        maxBytes: 4 * 1024,
      });
      const session = sessionRecordStore.updateSession(id, { title });
      if (!session) throw new AppError('SESSION_NOT_FOUND', id);
      return { session: sessionRevisions.snapshot(session) };
    },
    'session:remove': async (_event, ...rawArgs: unknown[]) => {
      const [id] = parseIpcArgs(SessionIdOnlyArgsSchema, rawArgs, {
        label: 'session:remove',
        maxBytes: 4 * 1024,
      });
      const session = sessionRecordStore.readSession(id);
      if (!session) throw new AppError('SESSION_NOT_FOUND', id);

      await conversationService.cancelActiveTurn({ sessionId: id });

      const runs = sessionRecordStore.listRuns(id);
      const activeRun = runs.find((run) => ['queued', 'running', 'stopping'].includes(run.status));
      if (activeRun) {
        runExecutionService.stopRun(activeRun.runId);
        rdcCliInvokerService.abortRun(activeRun.runId);
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
      agentOrchestrator.releaseSessionToolState(id);
      const remainingSessions = sessionRecordStore.listSessions(session.projectId);
      const nextSession = remainingSessions[0] ? sessionRevisions.snapshot(remainingSessions[0]) : null;
      let nextRun: RunSummary | null = null;
      if (state.currentSessionId === id) {
        state.currentSessionId = nextSession?.record.sessionId || null;
        state.currentRunId = nextSession?.record.lastRunId || null;
        state.currentProjectId = session.projectId;
        if (state.currentSessionId) {
          projectWorkspaceStore.setCurrentSessionId(state.currentSessionId);
          nextRun = sessionRecordStore.getLatestRun(state.currentSessionId);
        } else {
          projectWorkspaceStore.setCurrentSessionId(null);
          projectWorkspaceStore.setCurrentProjectId(session.projectId);
        }
      }

      return { nextSession, nextRun };
    },
  };
}

/** Opening a session and the model, agent and hand-off choices of the active session. */
function activeSessionChannels(context: WorkbenchIpcContext, sessionModelLanes: SessionModelLanes): IpcChannelTable {
  const { state } = context;
  return {
    // Opening a session is one round trip: it becomes current, and its history, trace projection and runs come back
    // with it instead of in four follow-up requests.
    'session:open': async (_event, ...rawArgs: unknown[]) => {
      const [id] = parseIpcArgs(SessionIdOnlyArgsSchema, rawArgs, {
        label: 'session:open',
        maxBytes: 4 * 1024,
      });
      const session = sessionRecordStore.readSession(id);
      if (!session) throw new AppError('SESSION_NOT_FOUND', id);
      // Paired before any await: a later write reaches the renderer as a newer session:recordChanged.
      const opened = sessionRevisions.snapshot(session);

      state.currentSessionId = id;
      state.currentProjectId = session.projectId;
      const currentRun = await recoverStaleRunOnSelection(sessionRecordStore.getLatestRun(id));
      state.currentRunId = currentRun?.runId || session.lastRunId || null;
      projectWorkspaceStore.setCurrentSessionId(id);
      const [history, trace] = await Promise.all([conversationService.getHistory(id), traceService.getSession(id)]);
      return {
        session: opened,
        currentRun,
        runs: sessionRecordStore.listRuns(id),
        history,
        trace,
      };
    },
    'session:setModelOverride': async (_event, ...rawArgs: unknown[]) => {
      const [id, request] = parseIpcArgs(SessionSetModelOverrideArgsSchema, rawArgs, {
        label: 'session:setModelOverride',
        maxBytes: 4 * 1024,
      });
      requireActiveSessionOwner(state, id);
      if (!sessionRecordStore.readSession(id)) throw new AppError('SESSION_NOT_FOUND', id);
      if (request.modelOverride) await assertSessionModelExecutable(request.modelOverride);
      // Checked after the await and written in the same synchronous step: a newer intent's field is never overwritten.
      const fields = sessionModelLanes.newer(id, request);
      const updated =
        Object.keys(fields).length > 0
          ? sessionRecordStore.updateSession(id, fields)
          : sessionRecordStore.readSession(id);
      if (!updated) throw new AppError('SESSION_NOT_FOUND', id);
      sessionModelLanes.wrote(id, request.clientRevision, fields);
      return { session: sessionRevisions.snapshot(updated) };
    },
    'session:setAgentId': async (_event, ...rawArgs: unknown[]) => {
      const [id, agentId] = parseIpcArgs(SessionSetAgentIdArgsSchema, rawArgs, {
        label: 'session:setAgentId',
        maxBytes: 4 * 1024,
      });
      requireActiveSessionOwner(state, id);
      const session = sessionRecordStore.readSession(id);
      if (!session) throw new AppError('SESSION_NOT_FOUND', id);
      const projectRoot = projectWorkspaceStore.getProjectById(session.projectId)?.rootPath ?? null;
      if (!resolveEnabledAgentDefinition(agentId, projectRoot)) {
        throw new AppError('CONVERSATION_AGENT_UNAVAILABLE', `requested profile \`${agentId}\` is not enabled.`);
      }
      const updated = sessionRecordStore.updateSession(id, { agentId });
      if (!updated) throw new AppError('SESSION_NOT_FOUND', id);
      return { session: sessionRevisions.snapshot(updated) };
    },
    'session:applyDeclaredHandoff': async (_event, ...rawArgs: unknown[]) => {
      const [id, agent, label, expectedPlanHash] = parseIpcArgs(SessionApplyDeclaredHandoffArgsSchema, rawArgs, {
        label: 'session:applyDeclaredHandoff',
        maxBytes: 4 * 1024,
        padTo: 4,
      });
      requireActiveSessionOwner(state, id);
      return applyDeclaredHandoff({ sessionId: id, agent, label, expectedPlanHash });
    },
  };
}
