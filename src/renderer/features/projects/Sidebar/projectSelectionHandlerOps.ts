import { useConversationStore } from '../../../stores/conversationStore';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';
import type { RightRailTarget } from './types';
import type { ProjectSelectionLoaderOpsContext } from './projectSelectionLoaderOps';
import { captureSelectionSnapshot, loadRunsForSession } from './projectSelectionLoaderOps';

export interface ProjectSelectionHandlerOpsContext extends ProjectSelectionLoaderOpsContext {
  setIsBusy: (busy: boolean) => void;
  setSidebarError: (error: string | null) => void;
  beginSelectionRequest: () => number;
  loadProjects: (
    preferredProjectId?: string | null,
    preferredSessionId?: string | null,
    options?: import('./types').LoadProjectsOptions,
  ) => Promise<void>;
  loadSessions: (
    project: ProjectRecord,
    options?: import('./types').LoadSessionsOptions,
  ) => Promise<void>;
  selectSession: (
    sessionId: string,
    options?: import('./types').SelectSessionOptions,
  ) => Promise<boolean>;
  getCurrentProject: () => ProjectRecord | null;
  getCurrentSession: () => SessionRecord | null;
  getRightRailTarget: () => RightRailTarget;
  projectMenuOpen: boolean;
  onCloseProjectMenu: () => void;
}

export async function handleAddProjectOp(ctx: ProjectSelectionHandlerOpsContext) {
  ctx.setSidebarError(null);
  const rootPath = await window.electronAPI.selectDirectory();
  if (!rootPath) return;

  const requestId = ctx.beginSelectionRequest();
  ctx.setIsBusy(true);
  try {
    const result = await window.electronAPI.project.add(rootPath);
    if (!result.success || !result.project) {
      return;
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
  ctx.setCurrentProject(project);
  ctx.updateProjectInputs(project.projectId, project.inputs ?? []);
  ctx.setRightRailTarget('project');
  ctx.ensureProjectExpanded(project.projectId);
  const currentSession = ctx.getCurrentSession();
  if (currentSession?.projectId && currentSession.projectId !== project.projectId) {
    ctx.setCurrentSession(null);
    ctx.setCurrentRun(null);
    ctx.setCaptures([]);
    ctx.setRuns([]);
  }

  ctx.setIsBusy(true);
  try {
    await ctx.loadSessions(project, {
      autoSelectSession: false,
      rightRailTarget: 'project',
      requestId,
    });
  } finally {
    ctx.setIsBusy(false);
  }
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
    const result = await window.electronAPI.session.create(targetProject.projectId);
    if (!result.success || !result.session) {
      return;
    }

    if (!ctx.isLatestSelectionRequest(requestId)) {
      return;
    }

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

export async function handleOpenExplorerOp(
  ctx: ProjectSelectionHandlerOpsContext,
  project: ProjectRecord,
) {
  if (ctx.projectMenuOpen) {
    ctx.onCloseProjectMenu();
  }
  await window.electronAPI.appShell.openPath(project.rootPath);
}

export async function handleProjectRenameSubmitOp(
  ctx: ProjectSelectionHandlerOpsContext,
  projectRenamePopover: { project: ProjectRecord; titleDraft: string } | null,
  onClose: () => void,
) {
  if (!projectRenamePopover) return;
  const newName = projectRenamePopover.titleDraft.trim();
  const oldName = projectRenamePopover.project.name.trim();

  if (newName !== oldName && newName.length > 0) {
    ctx.setIsBusy(true);
    try {
      await window.electronAPI.project.rename(projectRenamePopover.project.projectId, newName);
      await ctx.loadProjects(ctx.getCurrentProject()?.projectId, ctx.getCurrentSession()?.sessionId, {
        autoSelectSession: ctx.getRightRailTarget() === 'session',
        rightRailTarget: ctx.getRightRailTarget(),
      });
    } finally {
      ctx.setIsBusy(false);
    }
  }
  onClose();
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

export async function commitSessionRenameOp(
  ctx: ProjectSelectionHandlerOpsContext,
  renamePopover: { session: SessionRecord; titleDraft: string } | null,
  onClose: () => void,
) {
  if (!renamePopover) return;

  const trimmedTitle = renamePopover.titleDraft.trim();
  const { session } = renamePopover;
  if (!trimmedTitle || trimmedTitle === session.title) {
    onClose();
    return;
  }

  ctx.setIsBusy(true);
  try {
    const result = await window.electronAPI.session.rename(session.sessionId, trimmedTitle);
    if (!result.success || !result.session) {
      return;
    }

    const nextSessions = await ctx.loadProjectSessionList(session.projectId);
    if (ctx.getCurrentProject()?.projectId === session.projectId) {
      ctx.setSessions(nextSessions);
      if (ctx.getCurrentSession()?.sessionId === session.sessionId) {
        const matchedSession = nextSessions.find((entry) => entry.sessionId === session.sessionId) ?? result.session;
        ctx.setCurrentSession(matchedSession);
      }
    }
  } finally {
    onClose();
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
  onCloseRename();
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
