import { useCallback, useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '../../../stores/projectStore';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';
import {
  commitSessionRenameOp,
  handleAddProjectOp,
  handleOpenExplorerOp,
  handleProjectRenameSubmitOp,
  handleProjectSelectOp,
  handleRemoveProjectOp,
  handleSessionActivateOp,
  handleSessionCreateOp,
  handleSessionRemoveOp,
  type ProjectSelectionHandlerOpsContext,
} from './projectSelectionHandlerOps';
import { useProjectSelectionLoaders } from './useProjectSelectionLoaders';

interface UseProjectSelectionOptions {
  ensureProjectExpanded: (projectId: string) => void;
  loadProjectSessionList: (projectId: string) => Promise<SessionRecord[]>;
  pruneTreeForProjects: (visibleProjectIds: Set<string>) => void;
  resetTree: () => void;
  onCloseProjectMenu: () => void;
  projectMenuOpen: boolean;
}

export function useProjectSelection({
  ensureProjectExpanded,
  loadProjectSessionList,
  pruneTreeForProjects,
  resetTree,
  onCloseProjectMenu,
  projectMenuOpen,
}: UseProjectSelectionOptions) {
  const [isBusy, setIsBusy] = useState(false);
  const [sidebarError, setSidebarError] = useState<string | null>(null);

  const projects = useProjectStore((state) => state.projects);
  const sessions = useProjectStore((state) => state.sessions);
  const currentProject = useProjectStore((state) => state.currentProject);
  const currentSession = useProjectStore((state) => state.currentSession);
  const rightRailTarget = useProjectStore((state) => state.rightRailTarget);

  const loaders = useProjectSelectionLoaders({
    ensureProjectExpanded,
    loadProjectSessionList,
    pruneTreeForProjects,
    resetTree,
    setSidebarError,
  });

  const {
    isLoading,
    beginSelectionRequest,
    loadProjects,
    loaderCtx,
  } = loaders;

  useEffect(() => {
    if (currentProject?.projectId) {
      ensureProjectExpanded(currentProject.projectId);
    }
  }, [currentProject, ensureProjectExpanded]);

  const handlerCtx = useMemo((): ProjectSelectionHandlerOpsContext => ({
    ...loaderCtx,
    setIsBusy,
    setSidebarError,
    beginSelectionRequest,
    loadProjects: loaders.loadProjects,
    loadSessions: loaders.loadSessions,
    selectSession: loaders.selectSession,
    getCurrentProject: () => useProjectStore.getState().currentProject,
    getCurrentSession: () => useProjectStore.getState().currentSession,
    getRightRailTarget: () => useProjectStore.getState().rightRailTarget,
    projectMenuOpen,
    onCloseProjectMenu,
  }), [loaderCtx, beginSelectionRequest, loaders.loadProjects, loaders.loadSessions, loaders.selectSession, onCloseProjectMenu, projectMenuOpen]);

  const handleAddProject = useCallback(() => handleAddProjectOp(handlerCtx), [handlerCtx]);
  const handleRemoveProject = useCallback(
    (project?: ProjectRecord) => handleRemoveProjectOp(handlerCtx, project),
    [handlerCtx],
  );
  const handleProjectSelect = useCallback(
    (project: ProjectRecord) => handleProjectSelectOp(handlerCtx, project),
    [handlerCtx],
  );
  const handleSessionCreate = useCallback(
    (project?: ProjectRecord) => handleSessionCreateOp(handlerCtx, project),
    [handlerCtx],
  );
  const handleOpenExplorer = useCallback(
    (project: ProjectRecord) => handleOpenExplorerOp(handlerCtx, project),
    [handlerCtx],
  );
  const handleProjectRenameSubmit = useCallback(
    (projectRenamePopover: { project: ProjectRecord; titleDraft: string } | null, onClose: () => void) => (
      handleProjectRenameSubmitOp(handlerCtx, projectRenamePopover, onClose)
    ),
    [handlerCtx],
  );
  const handleSessionRemove = useCallback(
    (session: SessionRecord, onCloseRename: () => void) => handleSessionRemoveOp(handlerCtx, session, onCloseRename),
    [handlerCtx],
  );
  const commitSessionRename = useCallback(
    (renamePopover: { session: SessionRecord; titleDraft: string } | null, onClose: () => void) => (
      commitSessionRenameOp(handlerCtx, renamePopover, onClose)
    ),
    [handlerCtx],
  );
  const handleSessionActivate = useCallback(
    (project: ProjectRecord, session: SessionRecord, onCloseRename: () => void) => (
      handleSessionActivateOp(handlerCtx, project, session, onCloseRename)
    ),
    [handlerCtx],
  );

  return {
    isBusy,
    isLoading,
    sidebarError,
    projects,
    sessions,
    currentProject,
    currentSession,
    rightRailTarget,
    beginSelectionRequest,
    loadProjects,
    handleAddProject,
    handleRemoveProject,
    handleProjectSelect,
    handleSessionCreate,
    handleOpenExplorer,
    handleProjectRenameSubmit,
    handleSessionRemove,
    commitSessionRename,
    handleSessionActivate,
  };
}
