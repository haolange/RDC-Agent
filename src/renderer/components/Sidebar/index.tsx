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

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed = false,
}) => {
  const { t } = useI18n();
  const [isBusy, setIsBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [renamePopover, setRenamePopover] = useState<SessionRenamePopoverState | null>(null);

  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renamePopoverRef = useRef<HTMLDivElement | null>(null);

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
    const result = await window.electronAPI.session.list(project.projectId);
    const nextSessions = result.sessions ?? [];
    setSessions(nextSessions);
    setCurrentProject(project);
    setProjectInputs(project.inputs ?? []);

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
  }, [selectSession, setCaptures, setCurrentProject, setCurrentRun, setCurrentSession, setProjectInputs, setRuns, setSessions]);

  const loadProjects = useCallback(async (preferredProjectId?: string | null, preferredSessionId?: string | null) => {
    const result = await window.electronAPI.project.list();
    const nextProjects = result.projects ?? [];
    setProjects(nextProjects);

    const targetProject = nextProjects.find((project) => project.projectId === preferredProjectId)
      || nextProjects[0]
      || null;

    if (!targetProject) {
      setCurrentProject(null);
      setCurrentSession(null);
      setCurrentRun(null);
      setProjectInputs([]);
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
    if (!renamePopover) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!renamePopoverRef.current?.contains(target)) {
        setRenamePopover(null);
      }
    };

    const handleDismiss = () => {
      setRenamePopover(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRenamePopover(null);
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
  }, [renamePopover]);

  useEffect(() => {
    if (!renamePopover) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamePopover]);

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

  const handleRemoveProject = useCallback(async () => {
    if (!currentProject) return;

    setIsBusy(true);
    try {
      await window.electronAPI.project.remove(currentProject.projectId);
      await loadProjects();
    } finally {
      setIsBusy(false);
    }
  }, [currentProject, loadProjects]);

  const handleProjectSelect = useCallback(async (project: ProjectRecord) => {
    setIsBusy(true);
    try {
      await loadSessions(project);
    } finally {
      setIsBusy(false);
    }
  }, [loadSessions]);

  const handleSessionCreate = useCallback(async () => {
    if (!currentProject) return;

    setIsBusy(true);
    try {
      const result = await window.electronAPI.session.create(currentProject.projectId);
      if (!result.success || !result.session) {
        return;
      }

      await loadProjects(currentProject.projectId, result.session.sessionId);
    } finally {
      setIsBusy(false);
    }
  }, [currentProject, loadProjects]);

  const handleSessionSelect = useCallback(async (session: SessionRecord) => {
    setRenamePopover(null);
    setIsBusy(true);
    try {
      await selectSession(session.sessionId);
    } finally {
      setIsBusy(false);
    }
  }, [selectSession]);

  const handleSessionRemove = useCallback(async (session: SessionRecord) => {
    setRenamePopover(null);
    setIsBusy(true);
    try {
      const result = await window.electronAPI.session.remove(session.sessionId);
      if (!result.success) {
        return;
      }

      if (currentProject) {
        const sessionsResult = await window.electronAPI.session.list(currentProject.projectId);
        const nextSessions = sessionsResult.sessions ?? [];
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
  }, [currentProject, selectSession, setCaptures, setCurrentRun, setCurrentSession, setRuns, setSessions]);

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

      if (currentProject) {
        const sessionsResult = await window.electronAPI.session.list(currentProject.projectId);
        const nextSessions = sessionsResult.sessions ?? [];
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
  }, [closeRenamePopover, currentProject, currentSession, renamePopover, setCurrentSession, setSessions]);

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
          ) : projects.length === 0 ? (
            <div className="session-empty">
              <div className="session-empty-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" />
                </svg>
              </div>
              <div className="session-empty-text">{t('sidebar.noProjects')}</div>
              <div className="session-empty-hint">{t('sidebar.noProjectsHint')}</div>
            </div>
          ) : (
            <div className="project-stack">
              {projects.map((project) => {
                const isActive = currentProject?.projectId === project.projectId;
                return (
                  <section key={project.projectId} className={`project-stack-item ${isActive ? 'active' : ''}`}>
                    <button
                      type="button"
                      className={`session-item project-item ${isActive ? 'active' : ''}`}
                      onClick={() => void handleProjectSelect(project)}
                    >
                      <div className="session-item-header">
                        <span className="session-item-title">{project.name}</span>
                      </div>
                      <span className="session-item-time">{project.rootPath}</span>
                    </button>

                    {isActive && (
                      <div className="project-sessions-panel">
                        <div className="project-sessions-header">
                          <div className="project-sessions-heading">
                            <span className="project-sessions-title">{t('sidebar.sessions')}</span>
                            {sessions.length > 0 && (
                              <span className="session-section-count">{sessions.length}</span>
                            )}
                          </div>
                          <div className="session-section-actions">
                            {currentSession && (
                              <button
                                type="button"
                                className="session-section-action"
                                title={t('sidebar.removeSession')}
                                onClick={() => void handleSessionRemove(currentSession)}
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
                              title={t('sidebar.addSession')}
                              onClick={() => void handleSessionCreate()}
                              disabled={isBusy}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 5v14" />
                                <path d="M5 12h14" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {sessions.length === 0 ? (
                          <div className="session-empty compact nested">
                            <div className="session-empty-text">{t('sidebar.noSessions')}</div>
                            <div className="session-empty-hint">{t('sidebar.noSessionsHint')}</div>
                          </div>
                        ) : (
                          <div className="session-list nested-session-list">
                            {sessions.map((session) => (
                              <button
                                key={session.sessionId}
                                type="button"
                                className={`session-item session-subitem ${currentSession?.sessionId === session.sessionId ? 'active' : ''}`}
                                onClick={() => void handleSessionSelect(session)}
                                onContextMenu={(event) => handleSessionContextMenu(event, session)}
                              >
                                <div className="session-item-header">
                                  <span className="session-item-title">{session.title}</span>
                                  <span className="session-item-actions">
                                    <span className="session-item-action-hint">{t('sidebar.renameSession')}</span>
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
                                  </span>
                                </div>
                                <span className="session-item-time">
                                  {session.goal ? session.goal : new Date(session.updatedAt).toLocaleString()}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
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
    </div>
  );
};

export default Sidebar;
