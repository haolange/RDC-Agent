import { useCaptureStore } from '../../../stores/captureStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSessionProjectionStore } from '../../../stores/sessionProjectionStore';
import type { TranslationKey } from '../../../i18n';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';
import type { RightRailTarget } from './types';
import type { SelectionSnapshot } from './types';

export interface ProjectSelectionLoaderOpsContext {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  setSidebarError: (error: string | null) => void;
  ensureProjectExpanded: (projectId: string) => void;
  loadProjectSessionList: (projectId: string) => Promise<SessionRecord[]>;
  pruneTreeForProjects: (visibleProjectIds: Set<string>) => void;
  resetTree: () => void;
  isLatestSelectionRequest: (requestId?: number) => boolean;
  setProjects: ReturnType<typeof useProjectStore.getState>['setProjects'];
  setSessions: ReturnType<typeof useProjectStore.getState>['setSessions'];
  setCurrentProject: ReturnType<typeof useProjectStore.getState>['setCurrentProject'];
  setCurrentSession: ReturnType<typeof useProjectStore.getState>['setCurrentSession'];
  setProjectInputs: ReturnType<typeof useProjectStore.getState>['setProjectInputs'];
  updateProjectInputs: ReturnType<typeof useProjectStore.getState>['updateProjectInputs'];
  setRightRailTarget: ReturnType<typeof useProjectStore.getState>['setRightRailTarget'];
  setCurrentRun: ReturnType<typeof useSessionStore.getState>['setCurrentRun'];
  setRuns: ReturnType<typeof useSessionStore.getState>['setRuns'];
  setCaptures: ReturnType<typeof useCaptureStore.getState>['setCaptures'];
  getCurrentSession: () => ReturnType<typeof useProjectStore.getState>['currentSession'];
  reloadSettings: () => Promise<unknown>;
}

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

export async function loadRunsForSession(sessionId: string) {
  const result = await window.electronAPI.run.list(sessionId);
  return result.runs ?? [];
}

export function captureSelectionSnapshot(): SelectionSnapshot {
  const project = useProjectStore.getState();
  const session = useSessionStore.getState();
  const capture = useCaptureStore.getState();
  return {
    currentProject: project.currentProject,
    currentSession: project.currentSession,
    rightRailTarget: project.rightRailTarget,
    currentRun: session.currentRun,
    captures: capture.captures,
    runs: session.runs,
  };
}

export function restoreSelectionSnapshot(
  ctx: ProjectSelectionLoaderOpsContext,
  snapshot: SelectionSnapshot,
) {
  ctx.setCurrentProject(snapshot.currentProject);
  ctx.setCurrentSession(snapshot.currentSession);
  ctx.setRightRailTarget(snapshot.rightRailTarget);
  ctx.setCurrentRun(snapshot.currentRun);
  ctx.setCaptures(snapshot.captures);
  ctx.setRuns(snapshot.runs);
  if (snapshot.currentSession) {
    useSessionProjectionStore.getState().activateSession(snapshot.currentSession.sessionId);
  }
}

