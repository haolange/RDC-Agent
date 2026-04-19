import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useI18n } from '../../i18n';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';
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

  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renamePopoverRef = useRef<HTMLDivElement | null>(null);
  
  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  const projectRenameRef = useRef<HTMLDivElement | null>(null);
  const projectRenameInputRef = useRef<HTMLInputElement | null>(null);

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
    setRuns(result.runs ?? []);
    return result.runs ?? [];
  }, [setRuns]);

  const selectSession = useCallback(async (sessionId: string) => {
    const result = await window.electronAPI.session.select(sessionId);
    if (!result.success || !result.session) {
      return;
    }

    setCurrentSession(result.session);
    setCurrentRun(result.currentRun ?? null);
    setCaptures(result.currentRun?.captures ?? []);
    await loadRuns(sessionId);
  }, [loadRuns, setCaptures, setCurrentRun, setCurrentSession]);

  const loadSessions = useCallback(async (project: ProjectRecord, preferredSessionId?: string | null) => {
    const nextSessions = await loadProjectSessionList(project.projectId);
    setSessions(nextSessions);
    setCurrentProject(project);
    setProjectInputs(project.inputs ?? []);
    ensureProjectExpanded(project.projectId);

    const targetSessionId = preferredSessionId
      || project.lastSessionId
      || nextSessions[0]?.sessionId
      || null;

    if (!targetSessionId) {
      setCurrentSession(null);
      setCurrentRun(null);
      setCaptures([]);
      setRuns([]);
      return;
    }

    await selectSession(targetSessionId);
  }, [ensureProjectExpanded, loadProjectSessionList, selectSession, setCaptures, setCurrentProject, setCurrentRun, setCurrentSession, setProjectInputs, setRuns, setSessions]);

  const loadProjects = useCallback(async (preferredProjectId?: string | null, preferredSessionId?: string | null) => {
    const result = await window.electronAPI.project.list();
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
      setCurrentRun(null);
      setProjectInputs([]);
      setShowAllSessionsByProject({});
      setProjectSessionsByProject({});
      setCaptures([]);
      setSessions([]);
      setRuns([]);
      return;
    }

    await loadSessions(targetProject, preferredSessionId);
  }, [loadSessions, setCaptures, setCurrentProject, setCurrentRun, setCurrentSession, setProjectInputs, setProjects, setRuns, setSessions]);

  useEffect(() => {
    if (navigator.webdriver) {
      setIsLoading(false);
      return;
    }

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
    if (renamePopover) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamePopover]);

  useEffect(() => {
    if (projectRenamePopover) {
      projectRenameInputRef.current?.focus();
      projectRenameInputRef.current?.select();
    }
  }, [projectRenamePopover]);

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
    const rootPath = await window.electronAPI.selectDirectory();
    if (!rootPath) return;

    setIsBusy(true);
    try {
      const result = await window.electronAPI.project.add(rootPath);
      if (!result.success || !result.project) {
        return;
      }

      await loadProjects(result.project.projectId);
    } finally {
      setIsBusy(false);
    }
  }, [loadProjects]);

  const handleRemoveProject = useCallback(async (project?: ProjectRecord) => {
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
    setIsBusy(true);
    try {
      await loadSessions(project);
    } finally {
      setIsBusy(false);
    }
  }, [loadSessions]);

  const handleSessionCreate = useCallback(async (project?: ProjectRecord) => {
    const targetProject = project || currentProject;
    if (!targetProject) return;

    if (projectMenuPopover) {
      setProjectMenuPopover(null);
    }

    setIsBusy(true);
    try {
      const result = await window.electronAPI.session.create(targetProject.projectId);
      if (!result.success || !result.session) {
        return;
      }

      await loadProjects(targetProject.projectId, result.session.sessionId);
    } finally {
      setIsBusy(false);
    }
  }, [currentProject, loadProjects, projectMenuPopover]);

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
        await loadProjects(currentProject?.projectId, currentSession?.sessionId);
      } finally {
        setIsBusy(false);
      }
    }
    setProjectRenamePopover(null);
  }, [projectRenamePopover, loadProjects, currentProject, currentSession]);

  const handleSessionRemove = useCallback(async (session: SessionRecord) => {
    setRenamePopover(null);
    setIsBusy(true);
    try {
      const result = await window.electronAPI.session.remove(session.sessionId);
      if (!result.success) {
        return;
      }

      const nextSessions = await loadProjectSessionList(session.projectId);
      if (currentProject?.projectId === session.projectId) {
        setSessions(nextSessions);
        const nextSession = nextSessions[0] ?? null;
        setCurrentSession(nextSession);
        if (nextSession) {
          await selectSession(nextSession.sessionId);
        } else {
          setCurrentRun(null);
          setCaptures([]);
          setRuns([]);
          useSessionStore.getState().setTimeline([]);
        }
      }
    } finally {
      setIsBusy(false);
    }
  }, [currentProject, loadProjectSessionList, selectSession, setCaptures, setCurrentRun, setCurrentSession, setRuns, setSessions]);

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
    setRenamePopover(null);
    setIsBusy(true);
    try {
      if (currentProject?.projectId !== project.projectId) {
        await loadSessions(project, session.sessionId);
        return;
      }

      await selectSession(session.sessionId);
    } finally {
      setIsBusy(false);
    }
  }, [currentProject, loadSessions, selectSession]);

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
              {projects.map((project) => {
                const isActive = currentProject?.projectId === project.projectId;
                const isExpanded = expandedProjectIds.includes(project.projectId);
                const projectSessions = projectSessionsByProject[project.projectId]
                  ?? (isActive ? sessions : []);
                const showAllSessions = showAllSessionsByProject[project.projectId] ?? false;
                const hasOverflowSessions = projectSessions.length > 5;
                const visibleSessions = hasOverflowSessions && !showAllSessions
                  ? projectSessions.slice(0, 5)
                  : projectSessions;
                return (
                  <section
                    key={project.projectId}
                    className={`project-stack-item ${isActive ? 'active' : ''} ${isExpanded ? 'expanded' : ''}`}
                  >
                    <button
                      type="button"
                      className={`session-item project-item ${isActive ? 'active' : ''}`}
                      onClick={() => void handleProjectSelect(project)}
                    >
                      <div className="session-item-header">
                        <span className="project-item-leading">
                          <span
                            role="button"
                            tabIndex={0}
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
                          </span>
                          <span className="session-item-title project-item-title">{project.name}</span>
                        </span>
                        {isActive && (
                          <span className="session-item-actions">
                            <span
                              role="button"
                              tabIndex={0}
                              className="session-item-icon-button"
                              title={t('sidebar.menu')}
                              onClick={(e) => {
                                e.stopPropagation();
                                const rect = e.currentTarget.getBoundingClientRect();
                                openProjectMenuPopover(project, rect.right, rect.bottom + 8);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
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
                            </span>
                          </span>
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="project-sessions-panel">
                        {projectSessions.length > 0 ? (
                          <div className="session-list nested-session-list">
                            {visibleSessions.map((session) => (
                              <button
                                key={session.sessionId}
                                type="button"
                                className={`session-item session-subitem ${currentSession?.sessionId === session.sessionId ? 'active' : ''}`}
                                onClick={() => void handleSessionActivate(project, session)}
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
                                    <span
                                      role="button"
                                      tabIndex={0}
                                      className="session-item-icon-button"
                                      title={t('sidebar.renameSession')}
                                      onClick={(event) => handleRenameButtonClick(event, session)}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                          event.preventDefault();
                                          const rect = event.currentTarget.getBoundingClientRect();
                                          openRenamePopover(session, rect.right - 24, rect.bottom + 8);
                                        }
                                      }}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M12 20h9" />
                                        <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                                      </svg>
                                    </span>
                                    <span
                                      role="button"
                                      tabIndex={0}
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
                                    </span>
                                  </span>
                                </div>
                              </button>
                            ))}
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
