import React from 'react';
import { useI18n } from '../../../i18n';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';
import { getProjectOriginName } from './useProjectTree';
import { SessionList } from './SessionList';

export interface ProjectGroupProps {
  project: ProjectRecord;
  isCurrentProject: boolean;
  isProjectRailActive: boolean;
  isExpanded: boolean;
  projectSessions: SessionRecord[];
  showAllSessions: boolean;
  currentSessionId?: string;
  rightRailTarget: string;
  onProjectSelect: (project: ProjectRecord) => void;
  onProjectChevronClick: (event: React.SyntheticEvent, project: ProjectRecord) => void;
  onToggleProjectExpanded: (project: ProjectRecord) => void;
  onOpenProjectMenu: (project: ProjectRecord, x: number, y: number) => void;
  onSessionActivate: (project: ProjectRecord, session: SessionRecord) => void;
  onSessionContextMenu: (event: React.MouseEvent, session: SessionRecord) => void;
  onRenameClick: (event: React.MouseEvent, session: SessionRecord) => void;
  onRemoveClick: (event: React.MouseEvent, session: SessionRecord) => void;
  onRenameKeyDown: (event: React.KeyboardEvent, session: SessionRecord) => void;
  onRemoveKeyDown: (event: React.KeyboardEvent, session: SessionRecord) => void;
  onToggleShowAll: (event: React.MouseEvent, projectId: string) => void;
}

export const ProjectGroup: React.FC<ProjectGroupProps> = ({
  project,
  isCurrentProject,
  isProjectRailActive,
  isExpanded,
  projectSessions,
  showAllSessions,
  currentSessionId,
  rightRailTarget,
  onProjectSelect,
  onProjectChevronClick,
  onToggleProjectExpanded,
  onOpenProjectMenu,
  onSessionActivate,
  onSessionContextMenu,
  onRenameClick,
  onRemoveClick,
  onRenameKeyDown,
  onRemoveKeyDown,
  onToggleShowAll,
}) => {
  const { t } = useI18n();

  const hasOverflowSessions = projectSessions.length > 5;
  const visibleSessions = hasOverflowSessions && !showAllSessions
    ? projectSessions.slice(0, 5)
    : projectSessions;
  const projectOriginName = getProjectOriginName(project);
  const shouldShowProjectOriginName = project.name.trim() !== projectOriginName.trim();

  return (
    <section
      className={`project-stack-item ${isCurrentProject ? 'current' : ''} ${isProjectRailActive ? 'active' : ''} ${isExpanded ? 'expanded' : ''}`}
    >
      <div
        className={`session-item project-item ${isProjectRailActive ? 'active' : ''}`}
      >
        <div className="session-item-header">
          <span className="project-item-leading">
            <button
              type="button"
              className={`project-item-chevron ${isExpanded ? 'expanded' : ''}`}
              title={t('sidebar.toggleProjectSessions')}
              aria-label={t('sidebar.toggleProjectSessions')}
              aria-expanded={isExpanded}
              onClick={(event) => void onProjectChevronClick(event, project)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  void onToggleProjectExpanded(project);
                }
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
            <button
              type="button"
              className="session-item-select project-item-select"
              title={shouldShowProjectOriginName ? `${project.name} / ${projectOriginName}` : project.name}
              onClick={() => void onProjectSelect(project)}
            >
              <span className="project-item-title-wrap">
                <span className="project-item-title">{project.name}</span>
                {shouldShowProjectOriginName && (
                  <span className="project-item-origin-name">/ {projectOriginName}</span>
                )}
              </span>
            </button>
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
                  onOpenProjectMenu(project, rect.right, rect.bottom + 8);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    onOpenProjectMenu(project, rect.right, rect.bottom + 8);
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
          <SessionList
            project={project}
            projectSessions={projectSessions}
            visibleSessions={visibleSessions}
            hasOverflowSessions={hasOverflowSessions}
            showAllSessions={showAllSessions}
            isSessionRailActive={(sessionId) => rightRailTarget === 'session' && currentSessionId === sessionId}
            onActivate={onSessionActivate}
            onContextMenu={onSessionContextMenu}
            onRenameClick={onRenameClick}
            onRemoveClick={onRemoveClick}
            onRenameKeyDown={onRenameKeyDown}
            onRemoveKeyDown={onRemoveKeyDown}
            onToggleShowAll={onToggleShowAll}
          />
        </div>
      )}
    </section>
  );
};
