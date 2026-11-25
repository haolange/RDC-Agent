import { hydrateLoadedSessionSurface } from '../../../stores/sessionProjectionHydration';
import { useConversationStore } from '../../../stores/conversationStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSessionProjectionStore } from '../../../stores/sessionProjectionStore';
import { useAgentStore } from '../../../stores/agentStore';
import { applySessionSwitchHygiene } from '../../../stores/sessionSwitchHygiene';
import { hydrateComposerAgentFromSession } from '../../../stores/sessionAgentHydration';
import {
  captureSelectionSnapshot,
  restoreSelectionSnapshot,
  type ProjectSelectionHandlerOpsContext,
  type ProjectSelectionLoaderOpsContext,
} from './projectSelectionContext';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';
import type { SessionOpenResult } from '@shared/types/electron';
import type { SelectSessionOptions } from './types';

export async function selectSessionOp(
  ctx: ProjectSelectionLoaderOpsContext,
  sessionId: string,
  options: SelectSessionOptions = {},
): Promise<boolean> {
  const rollbackState = options.rollbackState ?? captureSelectionSnapshot();
  const previousSessionId = ctx.getCurrentSession()?.sessionId ?? null;

  if (options.optimisticSession) {
    if (previousSessionId !== options.optimisticSession.sessionId) applySessionSwitchHygiene({
      previousSessionId,
      nextSessionId: options.optimisticSession.sessionId,
    });
    ctx.setCurrentSession(options.optimisticSession);
    ctx.setRightRailTarget('session');
    ctx.setCurrentRun(null);
    ctx.setCaptures([]);
    ctx.setRuns([]);
  }

  // The surface bootstraps leave a session being opened here alone, so its history and trace load once.
  useConversationStore.getState().setHistoryLoadingSessionId(sessionId);
  const result = await window.electronAPI.session.open(sessionId).catch((error): SessionOpenResult => ({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  }));
  if (useConversationStore.getState().historyLoadingSessionId === sessionId) {
    useConversationStore.getState().setHistoryLoadingSessionId(null);
  }
  if (!ctx.isLatestSelectionRequest(options.requestId)) {
    return false;
  }
  if (!result.success) {
    restoreSelectionSnapshot(ctx, rollbackState);
    ctx.setSidebarError({ contextKey: 'sidebar.selectSessionFailed', detail: result.error });
    if (options.optimisticSession?.projectId) {
      await ctx.loadProjectSessionList(options.optimisticSession.projectId).catch(() => undefined);
    }
    return false;
  }

  if ((options.optimisticSession?.sessionId ?? previousSessionId) !== result.session.sessionId) {
    applySessionSwitchHygiene({
      previousSessionId: options.optimisticSession?.sessionId ?? previousSessionId,
      nextSessionId: result.session.sessionId,
    });
  }
  ctx.setCurrentSession(result.session);
  hydrateComposerAgentFromSession(result.session);
  hydrateLoadedSessionSurface({
    sessionId: result.session.sessionId,
    messages: result.history.messages,
    branchState: result.history.branchState ?? null,
    planReview: result.history.planReview,
    tracePresentation: result.trace.presentation ?? null,
    applyTrace: Boolean(result.trace.presentation),
  });
  ctx.setRightRailTarget('session');
  ctx.setCurrentRun(result.currentRun);
  ctx.setCaptures(result.currentRun?.captures ?? []);
  ctx.setRuns(result.runs);
  return true;
}

export async function handleSessionCreateOp(
  ctx: ProjectSelectionHandlerOpsContext,
  project?: ProjectRecord,
) {
  ctx.setSidebarError(null);
  const targetProject = project || ctx.getCurrentProject();
  if (!targetProject) return;

  if (ctx.projectMenuOpen) {
    ctx.onCloseProjectMenu();
  }

  const requestId = ctx.beginSelectionRequest();
  ctx.setIsBusy(true);
  try {
    const result = await window.electronAPI.session.create(targetProject.projectId).catch((error) => ({
      success: false,
      session: undefined,
      error: error instanceof Error ? error.message : String(error),
    }));
    if (!result.success || !result.session) {
      ctx.setSidebarError({ contextKey: 'sidebar.createSessionFailed', detail: result.error });
      return;
    }

    if (!ctx.isLatestSelectionRequest(requestId)) {
      return;
    }

    const previousSessionId = ctx.getCurrentSession()?.sessionId ?? null;
    const sameProject = ctx.getCurrentProject()?.projectId === targetProject.projectId;
    applySessionSwitchHygiene({
      previousSessionId,
      nextSessionId: result.session.sessionId,
    });
    ctx.setCurrentProject(targetProject);
    ctx.setCurrentSession(result.session);
    ctx.setRightRailTarget('session');
    ctx.setCurrentRun(null);
    ctx.setCaptures([]);
    ctx.setRuns([]);
    ctx.ensureProjectExpanded(targetProject.projectId);
    if (!sameProject) {
      // Another project becomes current: its selection and project-scoped settings load with it.
      await ctx.loadProjects(targetProject.projectId, result.session.sessionId, {
        autoSelectSession: true,
        rightRailTarget: 'session',
        requestId,
      });
      return;
    }
    // Same project: the list gains the new session, and the session opens in one request alongside it.
    const [nextSessions] = await Promise.all([
      ctx.loadProjectSessionList(targetProject.projectId),
      selectSessionOp(ctx, result.session.sessionId, { optimisticSession: result.session, requestId }),
    ]);
    if (ctx.isLatestSelectionRequest(requestId)) ctx.setSessions(nextSessions);
  } finally {
    ctx.setIsBusy(false);
  }
}

export async function handleSessionRemoveOp(
  ctx: ProjectSelectionHandlerOpsContext,
  session: SessionRecord,
  onCloseRename: () => void,
) {
  ctx.setSidebarError(null);
  onCloseRename();
  const requestId = ctx.beginSelectionRequest();
  const isRemovingCurrentSession = ctx.getCurrentSession()?.sessionId === session.sessionId;
  ctx.setIsBusy(true);
  try {
    const result = await window.electronAPI.session.remove(session.sessionId);
    if (!result.success) {
      ctx.setSidebarError({ contextKey: 'sidebar.removeSessionFailed', detail: result.error });
      return;
    }

    useSessionProjectionStore.getState().evictSession(session.sessionId);
    useAgentStore.getState().clearScope(session.sessionId);

    const nextSessions = await ctx.loadProjectSessionList(session.projectId);
    if (!ctx.isLatestSelectionRequest(requestId)) {
      return;
    }

    if (ctx.getCurrentProject()?.projectId === session.projectId) {
      ctx.setSessions(nextSessions);

      if (!isRemovingCurrentSession) {
        return;
      }

      const nextSession = result.nextSession ?? nextSessions[0] ?? null;
      applySessionSwitchHygiene({
        previousSessionId: session.sessionId,
        nextSessionId: nextSession?.sessionId ?? null,
      });
      ctx.setCurrentSession(nextSession);
      if (nextSession) {
        ctx.setRightRailTarget('session');
        ctx.setCurrentRun(result.nextRun ?? null);
        ctx.setCaptures(result.nextRun?.captures ?? []);
        await selectSessionOp(ctx, nextSession.sessionId, { optimisticSession: nextSession, requestId });
      } else {
        ctx.setRightRailTarget('project');
        ctx.setCurrentRun(null);
        ctx.setCaptures([]);
        ctx.setRuns([]);
        useConversationStore.getState().setTimeline([]);
      }
    }
  } finally {
    ctx.setIsBusy(false);
  }
}

export async function handleSessionActivateOp(
  ctx: ProjectSelectionHandlerOpsContext,
  project: ProjectRecord,
  session: SessionRecord,
  onCloseRename: () => void,
) {
  ctx.setSidebarError(null);
  const requestId = ctx.beginSelectionRequest();
  const rollbackState = captureSelectionSnapshot();
  const priorProjectId = ctx.getCurrentProject()?.projectId;
  const previousSessionId = ctx.getCurrentSession()?.sessionId ?? null;
  onCloseRename();
  if (previousSessionId !== session.sessionId) {
    applySessionSwitchHygiene({ previousSessionId, nextSessionId: session.sessionId });
  }
  useSessionStore.getState().clearUsageSnapshot();
  ctx.setCurrentProject(project);
  ctx.setCurrentSession(session);
  ctx.setRightRailTarget('session');
  ctx.setCurrentRun(null);
  ctx.setCaptures([]);
  ctx.setRuns([]);
  ctx.ensureProjectExpanded(project.projectId);
  ctx.setIsBusy(true);
  try {
    if (priorProjectId !== project.projectId) {
      await ctx.loadSessions(project, {
        preferredSessionId: session.sessionId,
        autoSelectSession: true,
        rightRailTarget: 'session',
        requestId,
        rollbackState,
      });
      return;
    }

    await ctx.selectSession(session.sessionId, {
      optimisticSession: session,
      requestId,
      rollbackState,
    });
  } finally {
    ctx.setIsBusy(false);
  }
}

