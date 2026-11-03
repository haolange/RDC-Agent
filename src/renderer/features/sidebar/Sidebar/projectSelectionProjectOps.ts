import { useSessionStore } from '../../../stores/sessionStore';
import { applySessionSwitchHygiene } from '../../../stores/sessionSwitchHygiene';
import type { ProjectRecord } from '@shared/types/session';
import type { LoadProjectsOptions, LoadSessionsOptions } from './types';
import { selectSessionOp } from './projectSelectionSessionOps';
import {
  captureSelectionSnapshot,
  restoreSelectionSnapshot,
  type ProjectSelectionHandlerOpsContext,
  type ProjectSelectionLoaderOpsContext,
} from './projectSelectionContext';

export async function loadSessionsOp(
  ctx: ProjectSelectionLoaderOpsContext,
  project: ProjectRecord,
  options: LoadSessionsOptions = {},
) {
  const autoSelectSession = options.autoSelectSession !== false;
  const projectSelection = await window.electronAPI.project.select(project.projectId).catch((error) => ({
    success: false,
    project: undefined,
    currentSession: null,
    currentRun: null,
    error: error instanceof Error ? error.message : String(error),
  }));
  if (!ctx.isLatestSelectionRequest(options.requestId)) {
    return;
  }
  if (!projectSelection.success || !projectSelection.project) {
    if (options.rollbackState) {
      restoreSelectionSnapshot(ctx, options.rollbackState);
    }
    ctx.setSidebarError(projectSelection.error || ctx.t('sidebar.selectProjectFailed'));
    return;
  }

  const selectedProject = projectSelection.project;
  const nextSessions = await ctx.loadProjectSessionList(selectedProject.projectId);
  if (!ctx.isLatestSelectionRequest(options.requestId)) {
    return;
  }

  ctx.setSessions(nextSessions);
  await ctx.reloadSettings();
  if (!ctx.isLatestSelectionRequest(options.requestId)) {
    return;
  }
  ctx.setCurrentProject(selectedProject);
  ctx.updateProjectInputs(selectedProject.projectId, selectedProject.inputs ?? []);
  ctx.ensureProjectExpanded(selectedProject.projectId);

  const currentSession = ctx.getCurrentSession();
  if (!autoSelectSession) {
    ctx.setRightRailTarget(options.rightRailTarget ?? 'project');
    if (currentSession?.projectId && currentSession.projectId !== selectedProject.projectId) {
      applySessionSwitchHygiene({ previousSessionId: currentSession.sessionId, nextSessionId: null });
      ctx.setCurrentSession(null);
      ctx.setCurrentRun(null);
      ctx.setCaptures([]);
      ctx.setRuns([]);
    }
    return;
  }

  // 选择目标会话的优先级：当前活跃会话（来自 selection.json / currentSession）
  // 优先于 registry.lastSessionId（持久化、可能 stale）。任何候选 id 都必须仍存在于
  // nextSessions 中，否则回退到剩余会话之首，避免选中已删除的会话导致 "Session not found"。
  const existingSessionIds = new Set(nextSessions.map((session) => session.sessionId));
  const candidateChain = [
    options.preferredSessionId,
    currentSession?.sessionId,
    selectedProject.lastSessionId,
    nextSessions[0]?.sessionId,
  ];
  const targetSessionId = candidateChain.find((id) => id && existingSessionIds.has(id)) ?? null;

  if (!targetSessionId) {
    if (currentSession) {
      applySessionSwitchHygiene({ previousSessionId: currentSession.sessionId, nextSessionId: null });
    }
    ctx.setRightRailTarget(options.rightRailTarget ?? 'project');
    ctx.setCurrentSession(null);
    ctx.setCurrentRun(null);
    ctx.setCaptures([]);
    ctx.setRuns([]);
    return;
  }

  const optimisticSession = nextSessions.find((session) => session.sessionId === targetSessionId);
  await selectSessionOp(ctx, targetSessionId, {
    optimisticSession,
    requestId: options.requestId,
    rollbackState: options.rollbackState,
  });
}

export async function loadProjectsOp(
  ctx: ProjectSelectionLoaderOpsContext,
  preferredProjectId?: string | null,
  preferredSessionId?: string | null,
  options: LoadProjectsOptions = {},
) {
  const result = await window.electronAPI.project.list();
  if (!ctx.isLatestSelectionRequest(options.requestId)) {
    return;
  }

  const nextProjects = result.projects ?? [];
  ctx.setProjects(nextProjects);
  const visibleProjectIds = new Set(nextProjects.map((project) => project.projectId));
  ctx.pruneTreeForProjects(visibleProjectIds);
  options.onProjectsListed?.();

  const targetProject = nextProjects.find((project) => project.projectId === preferredProjectId)
    || nextProjects[0]
    || null;

  if (!targetProject) {
    const currentSession = ctx.getCurrentSession();
    if (currentSession) {
      applySessionSwitchHygiene({ previousSessionId: currentSession.sessionId, nextSessionId: null });
    }
    ctx.setCurrentProject(null);
    useSessionStore.getState().clearUsageSnapshot();
    ctx.setCurrentSession(null);
    ctx.setRightRailTarget('project');
    ctx.setCurrentRun(null);
    ctx.setProjectInputs([]);
    ctx.resetTree();
    ctx.setCaptures([]);
    ctx.setSessions([]);
    ctx.setRuns([]);
    await ctx.reloadSettings();
    return;
  }

  await loadSessionsOp(ctx, targetProject, {
    preferredSessionId,
    autoSelectSession: options.autoSelectSession,
    rightRailTarget: options.rightRailTarget,
    requestId: options.requestId,
  });
}

export async function handleAddProjectOp(ctx: ProjectSelectionHandlerOpsContext, rootPath: string) {
  ctx.setSidebarError(null);
  if (!rootPath.trim()) throw new Error('Project path is required');

  const requestId = ctx.beginSelectionRequest();
  ctx.setIsBusy(true);
  try {
    const result = await window.electronAPI.project.add(rootPath);
    if (!result.success || !result.project) {
      throw new Error(result.error || 'Project could not be added');
    }

    await ctx.loadProjects(result.project.projectId, null, {
      autoSelectSession: false,
      rightRailTarget: 'project',
      requestId,
    });
  } finally {
    ctx.setIsBusy(false);
  }
}

export async function handleRemoveProjectOp(
  ctx: ProjectSelectionHandlerOpsContext,
  project?: ProjectRecord,
) {
  ctx.setSidebarError(null);
  const targetProject = project || ctx.getCurrentProject();
  if (!targetProject) return;

  if (ctx.projectMenuOpen) {
    ctx.onCloseProjectMenu();
  }

  ctx.setIsBusy(true);
  try {
    await window.electronAPI.project.remove(targetProject.projectId);
    await ctx.loadProjects();
  } finally {
    ctx.setIsBusy(false);
  }
}

export async function handleProjectSelectOp(
  ctx: ProjectSelectionHandlerOpsContext,
  project: ProjectRecord,
) {
  ctx.setSidebarError(null);
  const requestId = ctx.beginSelectionRequest();
  const rollbackState = captureSelectionSnapshot();
  const currentSession = ctx.getCurrentSession();
  if (currentSession?.projectId && currentSession.projectId !== project.projectId) {
    applySessionSwitchHygiene({ previousSessionId: currentSession.sessionId, nextSessionId: null });
    ctx.setCurrentSession(null);
    ctx.setCurrentRun(null);
    ctx.setCaptures([]);
    ctx.setRuns([]);
  }
  ctx.setCurrentProject(project);
  ctx.updateProjectInputs(project.projectId, project.inputs ?? []);
  ctx.setRightRailTarget('project');
  ctx.ensureProjectExpanded(project.projectId);

  ctx.setIsBusy(true);
  try {
    await ctx.loadSessions(project, {
      autoSelectSession: false,
      rightRailTarget: 'project',
      requestId,
      rollbackState,
    });
  } finally {
    ctx.setIsBusy(false);
  }
}

export async function handleOpenExplorerOp(
  ctx: ProjectSelectionHandlerOpsContext,
  project: ProjectRecord,
) {
  if (ctx.projectMenuOpen) {
    ctx.onCloseProjectMenu();
  }
  await window.electronAPI.appShell.openPath(project.rootPath);
}

