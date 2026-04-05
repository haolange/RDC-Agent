import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useI18n } from '../../i18n';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';
import './Sidebar.css';

interface SidebarProps {
  collapsed?: boolean;
}

interface SessionContextMenuState {
  session: SessionRecord;
  x: number;
  y: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed = false,
}) => {
  const { t } = useI18n();
  const [isBusy, setIsBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [contextMenu, setContextMenu] = useState<SessionContextMenuState | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

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
    if (!contextMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!contextMenuRef.current?.contains(target)) {
        setContextMenu(null);
      }
    };

    const handleDismiss = () => {
      setContextMenu(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
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
  }, [contextMenu]);

  useEffect(() => {
    if (!editingSessionId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [editingSessionId]);

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
    setContextMenu(null);
    setIsBusy(true);
    try {
      await selectSession(session.sessionId);
    } finally {
      setIsBusy(false);
    }
  }, [selectSession]);

  const startSessionRename = useCallback((session: SessionRecord) => {
    setContextMenu(null);
    setEditingSessionId(session.sessionId);
    setEditingTitle(session.title);
  }, []);

  const cancelSessionRename = useCallback(() => {
    setEditingSessionId(null);
    setEditingTitle('');
  }, []);

  const commitSessionRename = useCallback(async (session: SessionRecord) => {
    const trimmedTitle = editingTitle.trim();
    if (!trimmedTitle || trimmedTitle === session.title) {
      cancelSessionRename();
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
      } else {
        setSessions(
          sessions.map((entry) => entry.sessionId === session.sessionId ? result.session! : entry),
        );
        if (currentSession?.sessionId === session.sessionId) {
          setCurrentSession(result.session);
        }
      }
      cancelSessionRename();
    } finally {
      setIsBusy(false);
    }
  }, [cancelSessionRename, currentProject, currentSession, editingTitle, sessions, setCurrentSession, setSessions]);

  const handleSessionContextMenu = useCallback((event: React.MouseEvent, session: SessionRecord) => {
    event.preventDefault();
    setContextMenu({
      session,
      x: event.clientX,
      y: event.clientY,
    });
  }, []);

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
            <div className="session-list project-list">
              {projects.map((project) => (
                <button
                  key={project.projectId}
                  type="button"
                  className={`session-item project-item ${currentProject?.projectId === project.projectId ? 'active' : ''}`}
                  onClick={() => void handleProjectSelect(project)}
                >
                  <div className="session-item-header">
                    <span className="session-item-title">{project.name}</span>
                  </div>
                  <span className="session-item-time">{project.rootPath}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={`session-section ${collapsed ? 'hidden' : ''}`}>
          <div className="session-section-header">
            <div className="session-section-heading">
              <span className="session-section-title">{t('sidebar.sessions')}</span>
              {sessions.length > 0 && (
                <span className="session-section-count">{sessions.length}</span>
              )}
            </div>
            <div className="session-section-actions">
              <button
                type="button"
                className="session-section-action"
                title={t('sidebar.addSession')}
                onClick={() => void handleSessionCreate()}
                disabled={isBusy || !currentProject}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="session-list">
              <div className="ui-skeleton ui-skeleton--card" style={{ height: '56px', marginBottom: 'var(--space-2)' }} />
              <div className="ui-skeleton ui-skeleton--card" style={{ height: '56px' }} />
            </div>
          ) : !currentProject ? (
            <div className="session-empty compact">
              <div className="session-empty-text">{t('sidebar.projectRequired')}</div>
            </div>
          ) : sessions.length === 0 ? (
            <div className="session-empty compact">
              <div className="session-empty-text">{t('sidebar.noSessions')}</div>
              <div className="session-empty-hint">{t('sidebar.noSessionsHint')}</div>
            </div>
          ) : (
            <div className="session-list">
              {sessions.map((session) => (
                editingSessionId === session.sessionId ? (
                  <div
                    key={session.sessionId}
                    className={`session-item session-item-editing ${currentSession?.sessionId === session.sessionId ? 'active' : ''}`}
                  >
                    <div className="session-item-header">
                      <input
                        ref={renameInputRef}
                        type="text"
                        className="session-item-input"
                        value={editingTitle}
                        onChange={(event) => setEditingTitle(event.target.value)}
                        onBlur={() => void commitSessionRename(session)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void commitSessionRename(session);
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            cancelSessionRename();
                          }
                        }}
                        maxLength={80}
                      />
                    </div>
                    <span className="session-item-time">Enter 保存，Esc 取消</span>
                  </div>
                ) : (
                  <button
                    key={session.sessionId}
                    type="button"
                    className={`session-item ${currentSession?.sessionId === session.sessionId ? 'active' : ''}`}
                    onClick={() => void handleSessionSelect(session)}
                    onContextMenu={(event) => handleSessionContextMenu(event, session)}
                  >
                    <div className="session-item-header">
                      <span className="session-item-title">{session.title}</span>
                    </div>
                    <span className="session-item-time">
                      {session.goal ? session.goal : new Date(session.updatedAt).toLocaleString()}
                    </span>
                  </button>
                )
              ))}
            </div>
          )}
        </div>
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="session-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            type="button"
            className="session-context-menu-item"
            onClick={() => startSessionRename(contextMenu.session)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
            <span>重命名</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default Sidebar;
