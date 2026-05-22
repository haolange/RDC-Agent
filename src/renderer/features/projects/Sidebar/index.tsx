import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionStore } from '../../../stores/sessionStore';
import { useI18n } from '../../../i18n';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';
import type { RightRailTarget } from '../../../stores/sessionStore';
import './Sidebar.css';

interface SidebarProps {
  collapsed?: boolean;
}

interface SessionRenamePopoverState {
  session: SessionRecord;
  x: number;
  y: number;
  titleDraft: string;
}

interface ProjectMenuPopoverState {
  project: ProjectRecord;
  x: number;
  y: number;
}

interface ProjectRenamePopoverState {
  project: ProjectRecord;
  x: number;
  y: number;
  titleDraft: string;
}

interface LoadSessionsOptions {
  preferredSessionId?: string | null;
  autoSelectSession?: boolean;
  rightRailTarget?: RightRailTarget;
  requestId?: number;
  rollbackState?: SelectionSnapshot;
}

interface LoadProjectsOptions {
  autoSelectSession?: boolean;
  rightRailTarget?: RightRailTarget;
  requestId?: number;
}

interface SelectSessionOptions {
  optimisticSession?: SessionRecord;
  requestId?: number;
  rollbackState?: SelectionSnapshot;
}

interface SelectionSnapshot {
  currentProject: ProjectRecord | null;
  currentSession: SessionRecord | null;
  rightRailTarget: RightRailTarget;
  currentRun: ReturnType<typeof useSessionStore.getState>['currentRun'];
  captures: ReturnType<typeof useSessionStore.getState>['captures'];
  runs: ReturnType<typeof useSessionStore.getState>['runs'];
}

const getProjectOriginName = (project: ProjectRecord): string => {
  const normalizedRootPath = project.rootPath.trim().replace(/[\\/]+$/, '');
  const segments = normalizedRootPath.split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] || project.rootPath;
};

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed = false,
}) => {
  const { t } = useI18n();
  const [isBusy, setIsBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([]);
  const [showAllSessionsByProject, setShowAllSessionsByProject] = useState<Record<string, boolean>>({});
  const [projectSessionsByProject, setProjectSessionsByProject] = useState<Record<string, SessionRecord[]>>({});
  const [renamePopover, setRenamePopover] = useState<SessionRenamePopoverState | null>(null);
  const [projectMenuPopover, setProjectMenuPopover] = useState<ProjectMenuPopoverState | null>(null);
  const [projectRenamePopover, setProjectRenamePopover] = useState<ProjectRenamePopoverState | null>(null);
  const [sidebarError, setSidebarError] = useState<string | null>(null);

  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renamePopoverRef = useRef<HTMLDivElement | null>(null);
  const initializedRenameTargetRef = useRef<string | null>(null);
  
  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  const projectRenameRef = useRef<HTMLDivElement | null>(null);
  const projectRenameInputRef = useRef<HTMLInputElement | null>(null);
  const initializedProjectRenameTargetRef = useRef<string | null>(null);
  const selectionRequestRef = useRef(0);
  const didRunInitialLoadRef = useRef(false);

  const projects = useSessionStore((state) => state.projects);
  const sessions = useSessionStore((state) => state.sessions);
  const currentProject = useSessionStore((state) => state.currentProject);
  const currentSession = useSessionStore((state) => state.currentSession);
  const setProjects = useSessionStore((state) => state.setProjects);
  const setSessions = useSessionStore((state) => state.setSessions);
  const setCurrentProject = useSessionStore((state) => state.setCurrentProject);
  const setCurrentSession = useSessionStore((state) => state.setCurrentSession);
  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);
  const setRuns = useSessionStore((state) => state.setRuns);
  const setCaptures = useSessionStore((state) => state.setCaptures);
  const setProjectInputs = useSessionStore((state) => state.setProjectInputs);
  const updateProjectInputs = useSessionStore((state) => state.updateProjectInputs);
  const rightRailTarget = useSessionStore((state) => state.rightRailTarget);
  const setRightRailTarget = useSessionStore((state) => state.setRightRailTarget);

  const beginSelectionRequest = useCallback(() => {
    selectionRequestRef.current += 1;
    return selectionRequestRef.current;
  }, []);

  const isLatestSelectionRequest = useCallback((requestId?: number) => (
    requestId === undefined || selectionRequestRef.current === requestId
  ), []);

  const ensureProjectExpanded = useCallback((projectId: string) => {
    setExpandedProjectIds((current) => (
      current.includes(projectId) ? current : [...current, projectId]
    ));
  }, []);

  const loadProjectSessionList = useCallback(async (projectId: string) => {
    const result = await window.electronAPI.session.list(projectId);
    const nextSessions = result.sessions ?? [];
    setProjectSessionsByProject((current) => ({
      ...current,
      [projectId]: nextSessions,
    }));
    return nextSessions;
  }, []);

  const loadRuns = useCallback(async (sessionId: string) => {
    const result = await window.electronAPI.run.list(sessionId);
    return result.runs ?? [];
  }, []);

  const captureSelectionSnapshot = useCallback((): SelectionSnapshot => {
    const state = useSessionStore.getState();
    return {
      currentProject: state.currentProject,
      currentSession: state.currentSession,
      rightRailTarget: state.rightRailTarget,
      currentRun: state.currentRun,
      captures: state.captures,
      runs: state.runs,
    };
  }, []);

  const restoreSelectionSnapshot = useCallback((snapshot: SelectionSnapshot) => {
    setCurrentProject(snapshot.currentProject);
    setCurrentSession(snapshot.currentSession);
    setRightRailTarget(snapshot.rightRailTarget);
    setCurrentRun(snapshot.currentRun);
    setCaptures(snapshot.captures);
    setRuns(snapshot.runs);
  }, [setCaptures, setCurrentProject, setCurrentRun, setCurrentSession, setRightRailTarget, setRuns]);

  const selectSession = useCallback(async (sessionId: string, options: SelectSessionOptions = {}): Promise<boolean> => {
    const rollbackState = options.rollbackState ?? captureSelectionSnapshot();
    if (options.optimisticSession) {
      setCurrentSession(options.optimisticSession);
      setRightRailTarget('session');
      setCurrentRun(null);
      setCaptures([]);
      setRuns([]);
    }

    const result = await window.electronAPI.session.select(sessionId).catch((error) => ({
      success: false,
      session: undefined,
      currentRun: null,
      error: error instanceof Error ? error.message : String(error),
    }));
    if (!isLatestSelectionRequest(options.requestId)) {
      return false;
    }
    if (!result.success || !result.session) {
      restoreSelectionSnapshot(rollbackState);
      setSidebarError(result.error || t('sidebar.selectSessionFailed'));
      if (options.optimisticSession?.projectId) {
        await loadProjectSessionList(options.optimisticSession.projectId).catch(() => undefined);
      }
      return false;
    }

    setCurrentSession(result.session);
    setRightRailTarget('session');
    setCurrentRun(result.currentRun ?? null);
    setCaptures(result.currentRun?.captures ?? []);
    const nextRuns = await loadRuns(sessionId);
    if (!isLatestSelectionRequest(options.requestId)) {
      return false;
    }
    setRuns(nextRuns);
    return true;
  }, [captureSelectionSnapshot, isLatestSelectionRequest, loadProjectSessionList, loadRuns, restoreSelectionSnapshot, setCaptures, setCurrentRun, setCurrentSession, setRightRailTarget, setRuns, t]);

  const loadSessions = useCallback(async (project: ProjectRecord, options: LoadSessionsOptions = {}) => {
    const autoSelectSession = options.autoSelectSession !== false;
    const projectSelection = await window.electronAPI.project.select(project.projectId).catch((error) => ({
      success: false,
      project: undefined,
      currentSession: null,
      currentRun: null,
      error: error instanceof Error ? error.message : String(error),
    }));
    if (!isLatestSelectionRequest(options.requestId)) {
      return;
    }
    if (!projectSelection.success || !projectSelection.project) {
      setSidebarError(projectSelection.error || t('sidebar.selectProjectFailed'));
      return;
    }

    const selectedProject = projectSelection.project;
    const nextSessions = await loadProjectSessionList(selectedProject.projectId);
    if (!isLatestSelectionRequest(options.requestId)) {
      return;
    }

    setSessions(nextSessions);
    setCurrentProject(selectedProject);
    updateProjectInputs(selectedProject.projectId, selectedProject.inputs ?? []);
    ensureProjectExpanded(selectedProject.projectId);

    if (!autoSelectSession) {
      setRightRailTarget(options.rightRailTarget ?? 'project');
      if (currentSession?.projectId && currentSession.projectId !== selectedProject.projectId) {
        setCurrentSession(null);
        setCurrentRun(null);
        setCaptures([]);
        setRuns([]);
      }
      return;
    }

    const targetSessionId = options.preferredSessionId
      || selectedProject.lastSessionId
      || nextSessions[0]?.sessionId
      || null;

    if (!targetSessionId) {
      setRightRailTarget(options.rightRailTarget ?? 'project');
      setCurrentSession(null);
      setCurrentRun(null);
      setCaptures([]);
      setRuns([]);
      return;
    }

    const optimisticSession = nextSessions.find((session) => session.sessionId === targetSessionId);
    await selectSession(targetSessionId, {
      optimisticSession,
      requestId: options.requestId,
      rollbackState: options.rollbackState,
    });
  }, [currentSession, ensureProjectExpanded, isLatestSelectionRequest, loadProjectSessionList, selectSession, setCaptures, setCurrentProject, setCurrentRun, setCurrentSession, setRightRailTarget, setRuns, setSessions, t, updateProjectInputs]);

  const loadProjects = useCallback(async (preferredProjectId?: string | null, preferredSessionId?: string | null, options: LoadProjectsOptions = {}) => {
    const result = await window.electronAPI.project.list();
    if (!isLatestSelectionRequest(options.requestId)) {
      return;
    }

    const nextProjects = result.projects ?? [];
    setProjects(nextProjects);
    const visibleProjectIds = new Set(nextProjects.map((project) => project.projectId));
    setExpandedProjectIds((current) => current.filter((projectId) => visibleProjectIds.has(projectId)));
    setShowAllSessionsByProject((current) => Object.fromEntries(
      Object.entries(current).filter(([projectId]) => visibleProjectIds.has(projectId)),
    ));
    setProjectSessionsByProject((current) => Object.fromEntries(
      Object.entries(current).filter(([projectId]) => visibleProjectIds.has(projectId)),
    ));

    const targetProject = nextProjects.find((project) => project.projectId === preferredProjectId)
      || nextProjects[0]
      || null;

    if (!targetProject) {
      setCurrentProject(null);
      setCurrentSession(null);
      setRightRailTarget('project');
      setCurrentRun(null);
      setProjectInputs([]);
      setShowAllSessionsByProject({});
      setProjectSessionsByProject({});
      setCaptures([]);
      setSessions([]);
      setRuns([]);
      return;
    }

    await loadSessions(targetProject, {
      preferredSessionId,
      autoSelectSession: options.autoSelectSession,
      rightRailTarget: options.rightRailTarget,
      requestId: options.requestId,
    });
  }, [isLatestSelectionRequest, loadSessions, setCaptures, setCurrentProject, setCurrentRun, setCurrentSession, setProjectInputs, setProjects, setRightRailTarget, setRuns, setSessions]);

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

  useEffect(() => {
    if (!renamePopover && !projectMenuPopover && !projectRenamePopover) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (renamePopover && !renamePopoverRef.current?.contains(target)) {
        setRenamePopover(null);
      }
      if (projectMenuPopover && !projectMenuRef.current?.contains(target)) {
        setProjectMenuPopover(null);
      }
      if (projectRenamePopover && !projectRenameRef.current?.contains(target)) {
        setProjectRenamePopover(null);
      }
    };

    const handleDismiss = () => {
      setRenamePopover(null);
      setProjectMenuPopover(null);
      setProjectRenamePopover(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRenamePopover(null);
        setProjectMenuPopover(null);
        setProjectRenamePopover(null);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', handleDismiss);
    window.addEventListener('scroll', handleDismiss, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', handleDismiss);
      window.removeEventListener('scroll', handleDismiss, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [renamePopover, projectMenuPopover, projectRenamePopover]);

  useEffect(() => {
    const targetSessionId = renamePopover?.session.sessionId ?? null;
    if (!targetSessionId) {
      initializedRenameTargetRef.current = null;
      return;
    }
    if (initializedRenameTargetRef.current !== targetSessionId) {
      initializedRenameTargetRef.current = targetSessionId;
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamePopover?.session.sessionId]);

  useEffect(() => {
    const targetProjectId = projectRenamePopover?.project.projectId ?? null;
    if (!targetProjectId) {
      initializedProjectRenameTargetRef.current = null;
      return;
    }
    if (initializedProjectRenameTargetRef.current !== targetProjectId) {
      initializedProjectRenameTargetRef.current = targetProjectId;
      projectRenameInputRef.current?.focus();
      projectRenameInputRef.current?.select();
    }
  }, [projectRenamePopover?.project.projectId]);

  useEffect(() => {
    if (currentProject?.projectId) {
      ensureProjectExpanded(currentProject.projectId);
    }
  }, [currentProject, ensureProjectExpanded]);

  const getRenamePopoverPosition = useCallback((x: number, y: number) => {
    const width = 320;
    const height = 168;
    const gutter = 12;
    const maxX = Math.max(gutter, window.innerWidth - width - gutter);
    const maxY = Math.max(gutter, window.innerHeight - height - gutter);

    return {
      x: Math.min(Math.max(x, gutter), maxX),
      y: Math.min(Math.max(y, gutter), maxY),
    };
  }, []);

  const handleAddProject = useCallback(async () => {
    setSidebarError(null);
    const rootPath = await window.electronAPI.selectDirectory();
    if (!rootPath) return;

    const requestId = beginSelectionRequest();
    setIsBusy(true);
    try {
      const result = await window.electronAPI.project.add(rootPath);
      if (!result.success || !result.project) {
        return;
      }

      await loadProjects(result.project.projectId, null, {
        autoSelectSession: false,
        rightRailTarget: 'project',
        requestId,
      });
    } finally {
      setIsBusy(false);
    }
  }, [beginSelectionRequest, loadProjects]);

  const handleRemoveProject = useCallback(async (project?: ProjectRecord) => {
    setSidebarError(null);
    const targetProject = project || currentProject;
    if (!targetProject) return;

    if (projectMenuPopover) {
      setProjectMenuPopover(null);
    }

    setIsBusy(true);
    try {
      await window.electronAPI.project.remove(targetProject.projectId);
      await loadProjects();
    } finally {
      setIsBusy(false);
    }
  }, [currentProject, loadProjects, projectMenuPopover]);

  const handleProjectSelect = useCallback(async (project: ProjectRecord) => {
    setSidebarError(null);
    const requestId = beginSelectionRequest();
    setCurrentProject(project);
    updateProjectInputs(project.projectId, project.inputs ?? []);
    setRightRailTarget('project');
    ensureProjectExpanded(project.projectId);
    if (currentSession?.projectId && currentSession.projectId !== project.projectId) {
      setCurrentSession(null);
      setCurrentRun(null);
      setCaptures([]);
      setRuns([]);
    }

    setIsBusy(true);
    try {
      await loadSessions(project, {
        autoSelectSession: false,
        rightRailTarget: 'project',
        requestId,
      });
    } finally {
      setIsBusy(false);
    }
  }, [beginSelectionRequest, currentSession, ensureProjectExpanded, loadSessions, setCaptures, setCurrentProject, setCurrentRun, setCurrentSession, setRightRailTarget, setRuns, updateProjectInputs]);

  const handleSessionCreate = useCallback(async (project?: ProjectRecord) => {
    setSidebarError(null);
    const targetProject = project || currentProject;
    if (!targetProject) return;

    if (projectMenuPopover) {
      setProjectMenuPopover(null);
    }

    const requestId = beginSelectionRequest();
    setIsBusy(true);
    try {
      const result = await window.electronAPI.session.create(targetProject.projectId);
      if (!result.success || !result.session) {
        return;
      }

      if (!isLatestSelectionRequest(requestId)) {
        return;
      }

      setCurrentProject(targetProject);
      setCurrentSession(result.session);
      setRightRailTarget('session');
      setCurrentRun(null);
      setCaptures([]);
      setRuns([]);
      ensureProjectExpanded(targetProject.projectId);
      await loadProjects(targetProject.projectId, result.session.sessionId, {
        autoSelectSession: true,
        rightRailTarget: 'session',
        requestId,
      });
    } finally {
      setIsBusy(false);
    }
  }, [beginSelectionRequest, currentProject, ensureProjectExpanded, isLatestSelectionRequest, loadProjects, projectMenuPopover, setCaptures, setCurrentProject, setCurrentRun, setCurrentSession, setRightRailTarget, setRuns]);

  const handleOpenExplorer = useCallback(async (project: ProjectRecord) => {
    if (projectMenuPopover) {
      setProjectMenuPopover(null);
    }
    await window.electronAPI.appShell.openPath(project.rootPath);
  }, [projectMenuPopover]);

  const openProjectMenuPopover = useCallback((project: ProjectRecord, x: number, y: number) => {
    const position = getRenamePopoverPosition(x, y);
    setProjectMenuPopover({ project, x: position.x, y: position.y });
  }, [getRenamePopoverPosition]);

  const handleProjectRenameSubmit = useCallback(async () => {
    if (!projectRenamePopover) return;
    const newName = projectRenamePopover.titleDraft.trim();
    const oldName = projectRenamePopover.project.name.trim();

    if (newName !== oldName && newName.length > 0) {
      setIsBusy(true);
      try {
        await window.electronAPI.project.rename(projectRenamePopover.project.projectId, newName);
        await loadProjects(currentProject?.projectId, currentSession?.sessionId, {
          autoSelectSession: rightRailTarget === 'session',
          rightRailTarget,
        });
      } finally {
        setIsBusy(false);
      }
    }
    setProjectRenamePopover(null);
  }, [projectRenamePopover, loadProjects, currentProject, currentSession, rightRailTarget]);

  const handleSessionRemove = useCallback(async (session: SessionRecord) => {
    setSidebarError(null);
    setRenamePopover(null);
    const requestId = beginSelectionRequest();
    const isRemovingCurrentSession = currentSession?.sessionId === session.sessionId;
    setIsBusy(true);
    try {
      const result = await window.electronAPI.session.remove(session.sessionId);
      if (!result.success) {
        setSidebarError(result.error || t('sidebar.removeSessionFailed'));
        return;
      }

      const nextSessions = await loadProjectSessionList(session.projectId);
      if (!isLatestSelectionRequest(requestId)) {
        return;
      }

      if (currentProject?.projectId === session.projectId) {
        setSessions(nextSessions);

        if (!isRemovingCurrentSession) {
          return;
        }

        const nextSession = result.nextSession ?? nextSessions[0] ?? null;
        setCurrentSession(nextSession);
        if (nextSession) {
          setRightRailTarget('session');
          setCurrentRun(result.nextRun ?? null);
          setCaptures(result.nextRun?.captures ?? []);
          const nextRuns = await loadRuns(nextSession.sessionId);
          if (!isLatestSelectionRequest(requestId)) {
            return;
          }
          setRuns(nextRuns);
        } else {
          setRightRailTarget('project');
          setCurrentRun(null);
          setCaptures([]);
          setRuns([]);
          useSessionStore.getState().setTimeline([]);
        }
      }
    } finally {
      setIsBusy(false);
    }
  }, [beginSelectionRequest, currentProject, currentSession, isLatestSelectionRequest, loadProjectSessionList, loadRuns, setCaptures, setCurrentRun, setCurrentSession, setRightRailTarget, setRuns, setSessions, t]);

  const closeRenamePopover = useCallback(() => {
    setRenamePopover(null);
  }, []);

  const commitSessionRename = useCallback(async () => {
    if (!renamePopover) return;

    const trimmedTitle = renamePopover.titleDraft.trim();
    const { session } = renamePopover;
    if (!trimmedTitle || trimmedTitle === session.title) {
      closeRenamePopover();
      return;
    }

    setIsBusy(true);
    try {
      const result = await window.electronAPI.session.rename(session.sessionId, trimmedTitle);
      if (!result.success || !result.session) {
        return;
      }

      const nextSessions = await loadProjectSessionList(session.projectId);
      if (currentProject?.projectId === session.projectId) {
        setSessions(nextSessions);
        if (currentSession?.sessionId === session.sessionId) {
          const matchedSession = nextSessions.find((entry) => entry.sessionId === session.sessionId) ?? result.session;
          setCurrentSession(matchedSession);
        }
      }
    } finally {
      closeRenamePopover();
      setIsBusy(false);
    }
  }, [closeRenamePopover, currentProject, currentSession, loadProjectSessionList, renamePopover, setCurrentSession, setSessions]);

  const openRenamePopover = useCallback((session: SessionRecord, x: number, y: number) => {
    const position = getRenamePopoverPosition(x, y);
    setRenamePopover({
      session,
      x: position.x,
      y: position.y,
      titleDraft: session.title,
    });
  }, [getRenamePopoverPosition]);

  const handleSessionContextMenu = useCallback((event: React.MouseEvent, session: SessionRecord) => {
    event.preventDefault();
    openRenamePopover(session, event.clientX, event.clientY);
  }, [openRenamePopover]);

  const handleRenameButtonClick = useCallback((event: React.MouseEvent, session: SessionRecord) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    openRenamePopover(session, rect.right - 24, rect.bottom + 8);
  }, [openRenamePopover]);

  const handleRemoveButtonClick = useCallback((event: React.MouseEvent, session: SessionRecord) => {
    event.preventDefault();
    event.stopPropagation();
    void handleSessionRemove(session);
  }, [handleSessionRemove]);

  const toggleProjectExpanded = useCallback(async (project: ProjectRecord) => {
    const isExpanded = expandedProjectIds.includes(project.projectId);
    if (isExpanded) {
      setExpandedProjectIds((current) => current.filter((projectId) => projectId !== project.projectId));
      return;
    }

    ensureProjectExpanded(project.projectId);
    if (!projectSessionsByProject[project.projectId]) {
      await loadProjectSessionList(project.projectId);
    }
  }, [ensureProjectExpanded, expandedProjectIds, loadProjectSessionList, projectSessionsByProject]);

  const handleProjectChevronClick = useCallback(async (event: React.SyntheticEvent, project: ProjectRecord) => {
    event.preventDefault();
    event.stopPropagation();
    await toggleProjectExpanded(project);
  }, [toggleProjectExpanded]);

  const toggleShowAllSessions = useCallback((event: React.MouseEvent, projectId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setShowAllSessionsByProject((current) => ({
      ...current,
      [projectId]: !current[projectId],
    }));
  }, []);

  const handleSessionActivate = useCallback(async (project: ProjectRecord, session: SessionRecord) => {
    setSidebarError(null);
    const requestId = beginSelectionRequest();
    const rollbackState = captureSelectionSnapshot();
    setRenamePopover(null);
    setCurrentProject(project);
    setCurrentSession(session);
    setRightRailTarget('session');
    setCurrentRun(null);
    setCaptures([]);
    setRuns([]);
    ensureProjectExpanded(project.projectId);
    setIsBusy(true);
    try {
      if (currentProject?.projectId !== project.projectId) {
        await loadSessions(project, {
          preferredSessionId: session.sessionId,
          autoSelectSession: true,
          rightRailTarget: 'session',
          requestId,
          rollbackState,
        });
        return;
      }

      await selectSession(session.sessionId, {
        optimisticSession: session,
        requestId,
        rollbackState,
      });
    } finally {
      setIsBusy(false);
    }
  }, [beginSelectionRequest, captureSelectionSnapshot, currentProject, ensureProjectExpanded, loadSessions, selectSession, setCaptures, setCurrentProject, setCurrentRun, setCurrentSession, setRightRailTarget, setRuns]);

  return (
    <div className={`sidebar-content ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-scroll" data-testid="sidebar-scroll">
        <div className={`session-section ${collapsed ? 'hidden' : ''}`}>
          <div className="session-section-header">
            <div className="session-section-heading">
              <span className="session-section-title">{t('sidebar.projects')}</span>
              {projects.length > 0 && (
                <span className="session-section-count">{projects.length}</span>
              )}
            </div>
            <div className="session-section-actions">
              {currentProject && (
                <button
                  type="button"
                  className="session-section-action"
                  title={t('sidebar.removeProject')}
                  onClick={() => void handleRemoveProject()}
                  disabled={isBusy}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="M19 6l-1 14H6L5 6" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                className="session-section-action"
                title={t('sidebar.addProject')}
                onClick={() => void handleAddProject()}
                disabled={isBusy}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="session-list project-list">
              <div className="ui-skeleton ui-skeleton--card" style={{ height: '56px', marginBottom: 'var(--space-2)' }} />
              <div className="ui-skeleton ui-skeleton--card" style={{ height: '56px', marginBottom: 'var(--space-2)' }} />
              <div className="ui-skeleton ui-skeleton--card" style={{ height: '56px' }} />
            </div>
          ) : projects.length > 0 ? (
            <div className="project-stack">
              {sidebarError && (
                <div className="sidebar-inline-error" role="alert">
                  {sidebarError}
                </div>
              )}
              {projects.map((project) => {
                const isCurrentProject = currentProject?.projectId === project.projectId;
                const isProjectRailActive = isCurrentProject && rightRailTarget === 'project';
                const isExpanded = expandedProjectIds.includes(project.projectId);
                const projectSessions = projectSessionsByProject[project.projectId]
                  ?? (isCurrentProject ? sessions : []);
                const showAllSessions = showAllSessionsByProject[project.projectId] ?? false;
                const hasOverflowSessions = projectSessions.length > 5;
                const visibleSessions = hasOverflowSessions && !showAllSessions
                  ? projectSessions.slice(0, 5)
                  : projectSessions;
                const projectOriginName = getProjectOriginName(project);
                const shouldShowProjectOriginName = project.name.trim() !== projectOriginName.trim();
                return (
                  <section
                    key={project.projectId}
                    className={`project-stack-item ${isCurrentProject ? 'current' : ''} ${isProjectRailActive ? 'active' : ''} ${isExpanded ? 'expanded' : ''}`}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      className={`session-item project-item ${isProjectRailActive ? 'active' : ''}`}
                      onClick={() => void handleProjectSelect(project)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          void handleProjectSelect(project);
                        }
                      }}
                    >
                      <div className="session-item-header">
                        <span className="project-item-leading">
                          <button
                            type="button"
                            className={`project-item-chevron ${isExpanded ? 'expanded' : ''}`}
                            onClick={(event) => void handleProjectChevronClick(event, project)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                event.stopPropagation();
                                void toggleProjectExpanded(project);
                              }
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M9 6l6 6-6 6" />
                            </svg>
                          </button>
                          <span
                            className="project-item-title-wrap"
                            title={shouldShowProjectOriginName ? `${project.name} / ${projectOriginName}` : project.name}
                          >
                            <span className="project-item-title">{project.name}</span>
                            {shouldShowProjectOriginName && (
                              <span className="project-item-origin-name">/ {projectOriginName}</span>
                            )}
                          </span>
                        </span>
                        {isCurrentProject && (
                          <span className="session-item-actions">
                            <button
                              type="button"
                              className="session-item-icon-button"
                              title={t('sidebar.menu')}
                              onClick={(e) => {
                                e.stopPropagation();
                                const rect = e.currentTarget.getBoundingClientRect();
                                openProjectMenuPopover(project, rect.right, rect.bottom + 8);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  openProjectMenuPopover(project, rect.right, rect.bottom + 8);
                                }
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="1.5" />
                                <circle cx="19" cy="12" r="1.5" />
                                <circle cx="5" cy="12" r="1.5" />
                              </svg>
                            </button>
                          </span>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="project-sessions-panel">
                        {projectSessions.length > 0 ? (
                          <div className="session-list nested-session-list">
                            {visibleSessions.map((session) => {
                              const isSessionRailActive = rightRailTarget === 'session' && currentSession?.sessionId === session.sessionId;
                              return (
                              <div
                                key={session.sessionId}
                                role="button"
                                tabIndex={0}
                                className={`session-item session-subitem ${isSessionRailActive ? 'active' : ''}`}
                                onClick={() => void handleSessionActivate(project, session)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    void handleSessionActivate(project, session);
                                  }
                                }}
                                onContextMenu={(event) => handleSessionContextMenu(event, session)}
                              >
                                <div className="session-item-header">
                                  <span className="session-item-leading">
                                    <span className="session-item-gutter" aria-hidden="true">
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                        <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.8" opacity="0.55" />
                                        <circle cx="12" cy="12" r="2.5" fill="currentColor" opacity="0.9" />
                                      </svg>
                                    </span>
                                    <span className="session-item-title">{session.title}</span>
                                  </span>
                                  <span className="session-item-actions">
                                    <button
                                      type="button"
                                      className="session-item-icon-button"
                                      title={t('sidebar.renameSession')}
                                      onClick={(event) => handleRenameButtonClick(event, session)}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          const rect = event.currentTarget.getBoundingClientRect();
                                          openRenamePopover(session, rect.right - 24, rect.bottom + 8);
                                        }
                                      }}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M12 20h9" />
                                        <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      className="session-item-icon-button danger"
                                      title={t('sidebar.removeSession')}
                                      onClick={(event) => handleRemoveButtonClick(event, session)}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          void handleSessionRemove(session);
                                        }
                                      }}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M3 6h18" />
                                        <path d="M8 6V4h8v2" />
                                        <path d="M19 6l-1 14H6L5 6" />
                                      </svg>
                                    </button>
                                  </span>
                                </div>
                              </div>
                              );
                            })}
                            {hasOverflowSessions && (
                              <button
                                type="button"
                                className="session-list-toggle"
                                onClick={(event) => toggleShowAllSessions(event, project.projectId)}
                              >
                                {showAllSessions ? t('sidebar.showLess') : t('sidebar.showMore')}
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="session-empty compact nested">
                            <div className="session-empty-text">{t('sidebar.noSessions')}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {renamePopover && (
        <div
          ref={renamePopoverRef}
          className="session-rename-popover"
          style={{ top: renamePopover.y, left: renamePopover.x }}
        >
          <div className="session-rename-popover-title">{t('sidebar.renameSessionTitle')}</div>
          <input
            ref={renameInputRef}
            type="text"
            className="session-rename-popover-input"
            value={renamePopover.titleDraft}
            onChange={(event) => setRenamePopover((current) => (current
              ? { ...current, titleDraft: event.target.value }
              : current))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void commitSessionRename();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                closeRenamePopover();
              }
            }}
            maxLength={80}
            disabled={isBusy}
          />
          <div className="session-rename-popover-actions">
            <button
              type="button"
              className="session-rename-popover-button session-rename-popover-button-secondary"
              onClick={closeRenamePopover}
              disabled={isBusy}
            >
              {t('sidebar.cancel')}
            </button>
            <button
              type="button"
              className="session-rename-popover-button session-rename-popover-button-primary"
              onClick={() => void commitSessionRename()}
              disabled={isBusy}
            >
              {t('sidebar.save')}
            </button>
          </div>
        </div>
      )}
      {projectMenuPopover && (
        <div
          ref={projectMenuRef}
          className="sidebar-context-menu"
          style={{ top: projectMenuPopover.y, left: projectMenuPopover.x }}
        >
          <button
            type="button"
            className="sidebar-context-menu-item"
            onClick={() => void handleOpenExplorer(projectMenuPopover.project)}
            title={t('sidebar.menuExplorer')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span>{t('sidebar.openInExplorer') || 'Explorer'}</span>
          </button>
          <button
            type="button"
            className="sidebar-context-menu-item"
            onClick={() => {
              const { project, x, y } = projectMenuPopover;
              setProjectMenuPopover(null);
              setProjectRenamePopover({ project, x, y, titleDraft: project.name });
            }}
            title={t('sidebar.menuRename')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
            <span>{t('sidebar.renameProject') || 'Rename'}</span>
          </button>
          <button
            type="button"
            className="sidebar-context-menu-item"
            onClick={() => void handleSessionCreate(projectMenuPopover.project)}
            title={t('sidebar.menuNewSession')}
            disabled={isBusy}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            <span>{t('sidebar.addSession') || 'New Session'}</span>
          </button>
          <div className="sidebar-context-menu-divider" />
          <button
            type="button"
            className="sidebar-context-menu-item danger"
            onClick={() => void handleRemoveProject(projectMenuPopover.project)}
            title={t('sidebar.menuDelete')}
            disabled={isBusy}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
            </svg>
            <span>{t('sidebar.removeProject') || 'Delete'}</span>
          </button>
        </div>
      )}

      {projectRenamePopover && (
        <div
          ref={projectRenameRef}
          className="session-rename-popover"
          style={{ top: projectRenamePopover.y, left: projectRenamePopover.x }}
        >
          <div className="session-rename-popover-title">{t('sidebar.renameProjectTitle') || 'Rename Project'}</div>
          <input
            ref={projectRenameInputRef}
            type="text"
            className="session-rename-popover-input"
            value={projectRenamePopover.titleDraft}
            onChange={(event) => setProjectRenamePopover((current) => (current
              ? { ...current, titleDraft: event.target.value }
              : current))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleProjectRenameSubmit();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setProjectRenamePopover(null);
              }
            }}
            maxLength={80}
            disabled={isBusy}
          />
          <div className="session-rename-popover-actions">
            <button
              type="button"
              className="session-rename-popover-button session-rename-popover-button-secondary"
              onClick={() => setProjectRenamePopover(null)}
              disabled={isBusy}
            >
              {t('sidebar.cancel') || 'Cancel'}
            </button>
            <button
              type="button"
              className="session-rename-popover-button session-rename-popover-button-primary"
              onClick={() => void handleProjectRenameSubmit()}
              disabled={isBusy}
            >
              {t('sidebar.save') || 'Save'}
            </button>
          </div>
        </div>
      )}    </div>
  );
};

export default Sidebar;
