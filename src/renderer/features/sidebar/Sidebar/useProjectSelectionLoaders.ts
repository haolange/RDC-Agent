import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RevisionLanes } from '../../../lib/revisionLanes';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { useCaptureStore } from '../../../stores/captureStore';
import { useProjectStore } from '../../../stores/projectStore';
import { getCurrentSessionView } from '../../../stores/sessionRecordStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useI18n } from '../../../i18n';
import {
  captureSelectionSnapshot,
  loadRunsForSession,
  restoreSelectionSnapshot,
  type ProjectSelectionLoaderOpsContext,
  type SidebarError,
} from './projectSelectionContext';
import { loadProjectsOp, loadSessionsOp } from './projectSelectionProjectOps';
import { selectSessionOp } from './projectSelectionSessionOps';
import type {
  LoadProjectsOptions,
  LoadSessionsOptions,
  SelectSessionOptions,
  SelectionSnapshot,
} from './types';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';

export interface UseProjectSelectionLoadersOptions {
  ensureProjectExpanded: (projectId: string) => void;
  loadProjectSessionList: (projectId: string) => Promise<SessionRecord[]>;
  pruneTreeForProjects: (visibleProjectIds: Set<string>) => void;
  resetTree: () => void;
  setSidebarError: (error: SidebarError | null) => void;
}

export function useProjectSelectionLoaders({
  ensureProjectExpanded,
  loadProjectSessionList,
  pruneTreeForProjects,
  resetTree,
  setSidebarError,
}: UseProjectSelectionLoadersOptions) {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(true);

  // The sidebar selection is one revision lane: a project or session load applies only while it is the newest one.
  const [selectionLane] = useState(() => new RevisionLanes());
  const didRunInitialLoadRef = useRef(false);

  const setProjects = useProjectStore((state) => state.setProjects);
  const setSessions = useProjectStore((state) => state.setSessions);
  const setCurrentProject = useProjectStore((state) => state.setCurrentProject);
  const setCurrentSessionId = useProjectStore((state) => state.setCurrentSessionId);
  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);
  const setRuns = useSessionStore((state) => state.setRuns);
  const setCaptures = useCaptureStore((state) => state.setCaptures);
  const setProjectInputs = useProjectStore((state) => state.setProjectInputs);
  const updateProjectInputs = useProjectStore((state) => state.updateProjectInputs);
  const setRightRailTarget = useProjectStore((state) => state.setRightRailTarget);

  const beginSelectionRequest = useCallback(() => selectionLane.begin('selection'), [selectionLane]);

  const isLatestSelectionRequest = useCallback((requestId?: number) => (
    requestId === undefined || selectionLane.isLatest('selection', requestId)
  ), [selectionLane]);

  const loaderCtx = useMemo((): ProjectSelectionLoaderOpsContext => ({
    t,
    setSidebarError,
    ensureProjectExpanded,
    loadProjectSessionList,
    pruneTreeForProjects,
    resetTree,
    isLatestSelectionRequest,
    setProjects,
    setSessions,
    setCurrentProject,
    setCurrentSessionId,
    setProjectInputs,
    updateProjectInputs,
    setRightRailTarget,
    setCurrentRun,
    setRuns,
    setCaptures,
    getCurrentSession: getCurrentSessionView,
    reloadSettings: (projectId) => useAppSettingsStore.getState().reloadSettings(projectId),
  }), [
    t,
    setSidebarError,
    ensureProjectExpanded,
    loadProjectSessionList,
    pruneTreeForProjects,
    resetTree,
    isLatestSelectionRequest,
    setProjects,
    setSessions,
    setCurrentProject,
    setCurrentSessionId,
    setProjectInputs,
    updateProjectInputs,
    setRightRailTarget,
    setCurrentRun,
    setRuns,
    setCaptures,
  ]);

  const loadRuns = useCallback((sessionId: string) => loadRunsForSession(sessionId), []);
  const captureSelectionSnapshotFn = useCallback(() => captureSelectionSnapshot(), []);
  const restoreSelectionSnapshotFn = useCallback(
    (snapshot: SelectionSnapshot) => restoreSelectionSnapshot(loaderCtx, snapshot),
    [loaderCtx],
  );
  const selectSession = useCallback(
    (sessionId: string, options: SelectSessionOptions = {}) => selectSessionOp(loaderCtx, sessionId, options),
    [loaderCtx],
  );
  const loadSessions = useCallback(
    (project: ProjectRecord, options: LoadSessionsOptions = {}) => loadSessionsOp(loaderCtx, project, options),
    [loaderCtx],
  );
  const loadProjects = useCallback(
    (preferredProjectId?: string | null, preferredSessionId?: string | null, options: LoadProjectsOptions = {}) => (
      loadProjectsOp(loaderCtx, preferredProjectId, preferredSessionId, options)
    ),
    [loaderCtx],
  );

  useEffect(() => {
    if (didRunInitialLoadRef.current) {
      return;
    }
    didRunInitialLoadRef.current = true;

    void (async () => {
      await loadProjects(undefined, undefined, {
        onProjectsListed: () => setIsLoading(false),
      });
      setIsLoading(false);
    })();
  }, [loadProjects]);

  return {
    didRunInitialLoadRef,
    isLoading,
    beginSelectionRequest,
    isLatestSelectionRequest,
    loadRuns,
    captureSelectionSnapshot: captureSelectionSnapshotFn,
    restoreSelectionSnapshot: restoreSelectionSnapshotFn,
    selectSession,
    loadSessions,
    loadProjects,
    loaderCtx,
  };
}
