import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { useCaptureStore } from '../../../stores/captureStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useI18n } from '../../../i18n';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';
import type {
  LoadProjectsOptions,
  LoadSessionsOptions,
  SelectSessionOptions,
  SelectionSnapshot,
} from './types';
import {
  captureSelectionSnapshot,
  loadProjectsOp,
  loadRunsForSession,
  loadSessionsOp,
  restoreSelectionSnapshot,
  selectSessionOp,
  type ProjectSelectionLoaderOpsContext,
} from './projectSelectionLoaderOps';

export interface UseProjectSelectionLoadersOptions {
  ensureProjectExpanded: (projectId: string) => void;
  loadProjectSessionList: (projectId: string) => Promise<SessionRecord[]>;
  pruneTreeForProjects: (visibleProjectIds: Set<string>) => void;
  resetTree: () => void;
  setSidebarError: (error: string | null) => void;
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

  const selectionRequestRef = useRef(0);
  const didRunInitialLoadRef = useRef(false);

  const setProjects = useProjectStore((state) => state.setProjects);
  const setSessions = useProjectStore((state) => state.setSessions);
  const setCurrentProject = useProjectStore((state) => state.setCurrentProject);
  const setCurrentSession = useProjectStore((state) => state.setCurrentSession);
  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);
  const setRuns = useSessionStore((state) => state.setRuns);
  const setCaptures = useCaptureStore((state) => state.setCaptures);
  const setProjectInputs = useProjectStore((state) => state.setProjectInputs);
  const updateProjectInputs = useProjectStore((state) => state.updateProjectInputs);
  const setRightRailTarget = useProjectStore((state) => state.setRightRailTarget);

  const beginSelectionRequest = useCallback(() => {
    selectionRequestRef.current += 1;
    return selectionRequestRef.current;
  }, []);

  const isLatestSelectionRequest = useCallback((requestId?: number) => (
    requestId === undefined || selectionRequestRef.current === requestId
  ), []);

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
    setCurrentSession,
    setProjectInputs,
    updateProjectInputs,
    setRightRailTarget,
    setCurrentRun,
    setRuns,
    setCaptures,
    getCurrentSession: () => useProjectStore.getState().currentSession,
    reloadSettings: () => useAppSettingsStore.getState().reloadSettings(),
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
    setCurrentSession,
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
      await loadProjects();
      setIsLoading(false);
    })();
  }, [loadProjects]);

  return {
    selectionRequestRef,
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
