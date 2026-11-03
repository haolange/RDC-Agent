import type { ProjectRecord, SessionRecord } from '@shared/types/session';
import type { ProjectSelectionHandlerOpsContext } from './projectSelectionContext';

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

