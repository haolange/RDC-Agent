import { hydrateLoadedSessionSurface } from '../../../stores/sessionProjectionHydration';
import { useConversationStore } from '../../../stores/conversationStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSessionProjectionStore } from '../../../stores/sessionProjectionStore';
import { useAgentStore } from '../../../stores/agentStore';
import { applySessionSwitchHygiene } from '../../../stores/sessionSwitchHygiene';
import { hydrateComposerAgentFromSession } from '../../../stores/sessionAgentHydration';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';
import type { SelectSessionOptions } from './types';
import {
  captureSelectionSnapshot,
  loadRunsForSession,
  restoreSelectionSnapshot,
  type ProjectSelectionHandlerOpsContext,
  type ProjectSelectionLoaderOpsContext,
} from './projectSelectionContext';

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

  const result = await window.electronAPI.session.select(sessionId).catch((error) => ({
    success: false,
    session: undefined,
    currentRun: null,
    error: error instanceof Error ? error.message : String(error),
  }));
  if (!ctx.isLatestSelectionRequest(options.requestId)) {
    return false;
  }
  if (!result.success || !result.session) {
    restoreSelectionSnapshot(ctx, rollbackState);
    ctx.setSidebarError(result.error || ctx.t('sidebar.selectSessionFailed'));
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
  const history = await window.electronAPI.conversation.getHistory(result.session.sessionId).catch(() => null);
  const trace = await window.electronAPI.trace.getProjection(result.session.sessionId).catch(() => null);
  if (history && ctx.isLatestSelectionRequest(options.requestId)) {
    hydrateLoadedSessionSurface({
      messages: history.messages ?? [],
      branchState: history.branchState ?? null,
      planReview: history.planReview ?? null,
      tracePresentation: trace?.presentation ?? null,
      applyTrace: Boolean(trace?.presentation),
    });
  }
  ctx.setRightRailTarget('session');
  ctx.setCurrentRun(result.currentRun ?? null);
  ctx.setCaptures(result.currentRun?.captures ?? []);
  const nextRuns = await loadRunsForSession(sessionId);
  if (!ctx.isLatestSelectionRequest(options.requestId)) {
    return false;
  }
  ctx.setRuns(nextRuns);
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
      ctx.setSidebarError(result.error || 'Unable to create a new session.');
      return;
    }

    if (!ctx.isLatestSelectionRequest(requestId)) {
      return;
    }

    const previousSessionId = ctx.getCurrentSession()?.sessionId ?? null;
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
    await ctx.loadProjects(targetProject.projectId, result.session.sessionId, {
      autoSelectSession: true,
      rightRailTarget: 'session',
      requestId,
    });
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
      ctx.setSidebarError(result.error || ctx.t('sidebar.removeSessionFailed'));
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
        const nextRuns = await loadRunsForSession(nextSession.sessionId);
        if (!ctx.isLatestSelectionRequest(requestId)) {
          return;
        }
        ctx.setRuns(nextRuns);
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

