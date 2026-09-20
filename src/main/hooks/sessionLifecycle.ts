import { storageAdapter } from '../sessions/StorageAdapter';
import { dispatchRuntimeHooks } from './runtimeHookDispatch';
import { rdcSessionService } from '../sessions';
import { replayHistoryStore } from '../captures/replay/ReplayHistoryStore';

export async function createSessionWithHooks(
  projectId: string,
  title?: string,
  goal = '',
) {
  const project = storageAdapter.getProjectById(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  const allowed = await dispatchRuntimeHooks('session.before-start', {
    projectRoot: project.rootPath,
    payload: { projectId, title },
  });
  if (!allowed) {
    throw new Error('HOOK_DENIED: session.before-start');
  }
  return storageAdapter.createSession(projectId, title, goal);
}

export async function removeSessionWithHooks(sessionId: string): Promise<void> {
  const session = storageAdapter.readSession(sessionId);
  const project = session ? storageAdapter.getProjectById(session.projectId) : null;
  if (session) await rdcSessionService.clearOpenedCaptureForSession({ projectId: session.projectId, sessionId });
  if (project) await replayHistoryStore.clearSession(project.rootPath, sessionId);
  storageAdapter.removeSession(sessionId);
  if (!session) return;
  await dispatchRuntimeHooks('session.after-end', {
    sessionId,
    projectRoot: project?.rootPath,
    payload: { projectId: session.projectId },
  });
}
