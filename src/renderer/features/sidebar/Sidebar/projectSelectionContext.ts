import { useCaptureStore } from '../../../stores/captureStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSessionProjectionStore } from '../../../stores/sessionProjectionStore';
import type { TranslationKey } from '../../../i18n';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';
import type { RightRailTarget } from './types';
import type { SelectionSnapshot } from './types';

/** A failed sidebar operation: its own copy, and the technical reason that only "Copy details" carries. */
export interface SidebarError {
  contextKey: TranslationKey;
  detail?: string;
}

export interface ProjectSelectionLoaderOpsContext {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  setSidebarError: (error: SidebarError | null) => void;
  ensureProjectExpanded: (projectId: string) => void;
  loadProjectSessionList: (projectId: string) => Promise<SessionRecord[]>;
  pruneTreeForProjects: (visibleProjectIds: Set<string>) => void;
  resetTree: () => void;
  isLatestSelectionRequest: (requestId?: number) => boolean;
  setProjects: ReturnType<typeof useProjectStore.getState>['setProjects'];
  setSessions: ReturnType<typeof useProjectStore.getState>['setSessions'];
  setCurrentProject: ReturnType<typeof useProjectStore.getState>['setCurrentProject'];
  setCurrentSessionId: ReturnType<typeof useProjectStore.getState>['setCurrentSessionId'];
  setProjectInputs: ReturnType<typeof useProjectStore.getState>['setProjectInputs'];
  updateProjectInputs: ReturnType<typeof useProjectStore.getState>['updateProjectInputs'];
  setRightRailTarget: ReturnType<typeof useProjectStore.getState>['setRightRailTarget'];
  setCurrentRun: ReturnType<typeof useSessionStore.getState>['setCurrentRun'];
  setRuns: ReturnType<typeof useSessionStore.getState>['setRuns'];
  setCaptures: ReturnType<typeof useCaptureStore.getState>['setCaptures'];
  /** The current session's record view; the sidebar reads only its id and project. */
  getCurrentSession: () => SessionRecord | null;
  /** Brings the settings view to the Agents of `projectId` (null: no project); reads only when they differ. */
  reloadSettings: (projectId: string | null) => Promise<unknown>;
}

export interface ProjectSelectionHandlerOpsContext extends ProjectSelectionLoaderOpsContext {
  setIsBusy: (busy: boolean) => void;
  setSidebarError: (error: SidebarError | null) => void;
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
    currentSessionId: project.currentSessionId,
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
  ctx.setCurrentSessionId(snapshot.currentSessionId);
  ctx.setRightRailTarget(snapshot.rightRailTarget);
  ctx.setCurrentRun(snapshot.currentRun);
  ctx.setCaptures(snapshot.captures);
  ctx.setRuns(snapshot.runs);
  if (snapshot.currentSessionId) {
    useSessionProjectionStore.getState().activateSession(snapshot.currentSessionId);
  }
}

