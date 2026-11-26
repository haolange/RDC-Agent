import { AppError } from '@shared/errors/appError';
import { projectWorkspaceStore, sessionRecordStore } from '../sessions/store/sessionStores';
import { dispatchRuntimeHooks } from '../hooks/runtimeHookDispatch';
import { rdcSessionService } from './RdcSessionService';
import { replayHistoryStore } from './captures/replay/ReplayHistoryStore';

export async function createSessionWithHooks(
  projectId: string,
  title?: string,
) {
  const project = projectWorkspaceStore.getProjectById(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  const allowed = await dispatchRuntimeHooks('session.before-start', {
    projectRoot: project.rootPath,
    payload: { projectId, title },
  });
  if (!allowed) {
    throw new AppError('HOOK_DENIED', 'session.before-start');
  }
  return sessionRecordStore.createSession(projectId, title, '');
}

export async function removeSessionWithHooks(sessionId: string): Promise<void> {
  const session = sessionRecordStore.readSession(sessionId);
  const project = session ? projectWorkspaceStore.getProjectById(session.projectId) : null;
  if (session) await rdcSessionService.clearOpenedCaptureForSession({ projectId: session.projectId, sessionId });
  if (project) await replayHistoryStore.clearSession(project.rootPath, sessionId);
  sessionRecordStore.removeSession(sessionId);
  if (!session) return;
  await dispatchRuntimeHooks('session.after-end', {
    sessionId,
    projectRoot: project?.rootPath,
    payload: { projectId: session.projectId },
  });
}
