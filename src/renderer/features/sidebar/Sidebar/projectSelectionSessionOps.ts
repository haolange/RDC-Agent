import { hydrateLoadedSessionSurface } from '../../../stores/sessionProjectionHydration';
import { useConversationStore } from '../../../stores/conversationStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSessionProjectionStore } from '../../../stores/sessionProjectionStore';
import { applySessionSwitchHygiene } from '../../../stores/sessionSwitchHygiene';
import { acceptSessionSnapshot } from '../../../stores/sessionRecordStore';
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
    ctx.setCurrentSessionId(options.optimisticSession.sessionId);
    ctx.setRightRailTarget('session');
    ctx.setCurrentRun(null);
    ctx.setCaptures([]);
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
      await ctx.loadProjectSessionList(options.optimisticSession.projectId)
        .catch((error: unknown) => console.warn('[sidebar] could not reload the session list', error));
    }
    return false;
  }

  const opened = result.session.record;
  if ((options.optimisticSession?.sessionId ?? previousSessionId) !== opened.sessionId) {
    applySessionSwitchHygiene({
      previousSessionId: options.optimisticSession?.sessionId ?? previousSessionId,
      nextSessionId: opened.sessionId,
    });
  }
  acceptSessionSnapshot(result.session);
  ctx.setCurrentSessionId(opened.sessionId);
  hydrateLoadedSessionSurface({
    sessionId: opened.sessionId,
    messages: result.history.messages,
    branchState: result.history.branchState ?? null,
    planReview: result.history.planReview,
    tracePresentation: result.trace.presentation ?? null,
    applyTrace: Boolean(result.trace.presentation),
  });
  ctx.setRightRailTarget('session');
  ctx.setCurrentRun(result.currentRun);
  ctx.setCaptures(result.currentRun?.captures ?? []);
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

    const created = result.session.record;
    const previousSessionId = ctx.getCurrentSession()?.sessionId ?? null;
    const sameProject = ctx.getCurrentProject()?.projectId === targetProject.projectId;
    applySessionSwitchHygiene({
      previousSessionId,
      nextSessionId: created.sessionId,
    });
    acceptSessionSnapshot(result.session);
    ctx.setCurrentProject(targetProject);
    ctx.setCurrentSessionId(created.sessionId);
    ctx.setRightRailTarget('session');
    ctx.setCurrentRun(null);
    ctx.setCaptures([]);
    ctx.ensureProjectExpanded(targetProject.projectId);
    if (!sameProject) {
      // Another project becomes current: its selection and project-scoped settings load with it.
      await ctx.loadProjects(targetProject.projectId, created.sessionId, {
        autoSelectSession: true,
        rightRailTarget: 'session',
        requestId,
      });
      return;
    }
    // Same project: the list gains the new session, and the session opens in one request alongside it.
    const [nextSessions] = await Promise.all([
      ctx.loadProjectSessionList(targetProject.projectId),
      selectSessionOp(ctx, created.sessionId, { optimisticSession: created, requestId }),
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

    const nextSessions = await ctx.loadProjectSessionList(session.projectId);
    if (!ctx.isLatestSelectionRequest(requestId)) {
      return;
    }

    if (ctx.getCurrentProject()?.projectId === session.projectId) {
      ctx.setSessions(nextSessions);

      if (!isRemovingCurrentSession) {
        return;
      }

      if (result.nextSession) acceptSessionSnapshot(result.nextSession);
      const nextSession = result.nextSession?.record ?? nextSessions[0] ?? null;
      applySessionSwitchHygiene({
        previousSessionId: session.sessionId,
        nextSessionId: nextSession?.sessionId ?? null,
      });
      ctx.setCurrentSessionId(nextSession?.sessionId ?? null);
      if (nextSession) {
        ctx.setRightRailTarget('session');
        ctx.setCurrentRun(result.nextRun ?? null);
        ctx.setCaptures(result.nextRun?.captures ?? []);
        await selectSessionOp(ctx, nextSession.sessionId, { optimisticSession: nextSession, requestId });
      } else {
        ctx.setRightRailTarget('project');
        ctx.setCurrentRun(null);
        ctx.setCaptures([]);
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
  ctx.setCurrentSessionId(session.sessionId);
  ctx.setRightRailTarget('session');
  ctx.setCurrentRun(null);
  ctx.setCaptures([]);
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

