import React, { useCallback, useState } from 'react';
import { useI18n } from '../../../i18n';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';
import { ProjectGroup } from './ProjectGroup';
import { RenamePopover, useSidebarPopovers } from './RenamePopover';
import { useProjectSelection } from './useProjectSelection';
import { useProjectTree } from './useProjectTree';
import { ConfirmationDialog } from '../../../ui/ConfirmationDialog';
import './Sidebar.css';

interface SidebarProps {
  collapsed?: boolean;
}

type PendingRemoval =
  | { kind: 'session'; session: SessionRecord }
  | { kind: 'project'; project: ProjectRecord };

export const Sidebar: React.FC<SidebarProps> = ({ collapsed = false }) => {
  const { t } = useI18n();
  const tree = useProjectTree();
  const popovers = useSidebarPopovers();
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const selection = useProjectSelection({
    ensureProjectExpanded: tree.ensureProjectExpanded,
    loadProjectSessionList: tree.loadProjectSessionList,
    pruneTreeForProjects: tree.pruneTreeForProjects,
    resetTree: tree.resetTree,
    onCloseProjectMenu: popovers.closeProjectMenu,
    projectMenuOpen: popovers.projectMenuPopover !== null,
  });

  const handleRemoveClick = useCallback((event: React.MouseEvent, session: SessionRecord) => {
    event.preventDefault();
    event.stopPropagation();
    setPendingRemoval({ kind: 'session', session });
  }, [popovers.closeRenamePopover, selection]);

  const handleRemoveKeyDown = useCallback((event: React.KeyboardEvent, session: SessionRecord) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      setPendingRemoval({ kind: 'session', session });
    }
  }, [popovers.closeRenamePopover, selection]);

  const confirmRemoval = useCallback(async () => {
    const target = pendingRemoval;
    if (!target) return;
    if (target.kind === 'session') {
      await selection.handleSessionRemove(target.session, popovers.closeRenamePopover);
    } else {
      popovers.closeProjectMenu();
      await selection.handleRemoveProject(target.project);
    }
    setPendingRemoval(null);
  }, [pendingRemoval, popovers.closeProjectMenu, popovers.closeRenamePopover, selection]);

  const handleProjectChevronClick = useCallback(async (event: React.SyntheticEvent, project: ProjectRecord) => {
    event.preventDefault();
    event.stopPropagation();
    await tree.toggleProjectExpanded(project);
  }, [tree]);

  return (
    <div className={`sidebar-content ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-scroll" data-testid="sidebar-scroll">
        <div className={`session-section ${collapsed ? 'hidden' : ''}`}>
          <div className="session-section-header">
            <div className="session-section-heading">
              <span className="session-section-title">{t('sidebar.projects')}</span>
              {selection.projects.length > 0 && (
                <span className="session-section-count">{selection.projects.length}</span>
              )}
            </div>
            <div className="session-section-actions">
              {selection.currentProject && (
                <button type="button" className="session-section-action" title={t('sidebar.removeProject')}
                  onClick={() => setPendingRemoval({ kind: 'project', project: selection.currentProject! })} disabled={selection.isBusy}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" />
                  </svg>
                </button>
              )}
              <button type="button" className="session-section-action" title={t('sidebar.addProject')}
                onClick={() => void selection.handleAddProject()} disabled={selection.isBusy}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14" /><path d="M5 12h14" />
                </svg>
              </button>
            </div>
          </div>

          {selection.isLoading ? (
            <div className="session-list project-list">
              <div className="ui-skeleton ui-skeleton--card ui-skeleton--card-stack" />
              <div className="ui-skeleton ui-skeleton--card ui-skeleton--card-stack" />
              <div className="ui-skeleton ui-skeleton--card" />
            </div>
          ) : selection.projects.length > 0 ? (
            <div className="project-stack">
              {selection.sidebarError && (
                <div className="sidebar-inline-error" role="alert">{selection.sidebarError}</div>
              )}
              {selection.projects.map((project) => {
                const isCurrentProject = selection.currentProject?.projectId === project.projectId;
                const isProjectRailActive = isCurrentProject && selection.rightRailTarget === 'project';
                const isExpanded = tree.expandedProjectIds.includes(project.projectId);
                const projectSessions = isCurrentProject
                  ? selection.sessions
                  : (tree.projectSessionsByProject[project.projectId] ?? []);
                return (
                  <ProjectGroup
                    key={project.projectId}
                    project={project}
                    isCurrentProject={isCurrentProject}
                    isProjectRailActive={isProjectRailActive}
                    isExpanded={isExpanded}
                    projectSessions={projectSessions}
                    showAllSessions={tree.showAllSessionsByProject[project.projectId] ?? false}
                    currentSessionId={selection.currentSession?.sessionId}
                    rightRailTarget={selection.rightRailTarget}
                    onProjectSelect={selection.handleProjectSelect}
                    onProjectChevronClick={handleProjectChevronClick}
                    onToggleProjectExpanded={tree.toggleProjectExpanded}
                    onOpenProjectMenu={popovers.openProjectMenuPopover}
                    onSessionActivate={(p, s) => void selection.handleSessionActivate(p, s, popovers.closeRenamePopover)}
                    onSessionContextMenu={popovers.handleSessionContextMenu}
                    onRenameClick={popovers.handleRenameButtonClick}
                    onRemoveClick={handleRemoveClick}
                    onRenameKeyDown={popovers.handleRenameKeyDown}
                    onRemoveKeyDown={handleRemoveKeyDown}
                    onToggleShowAll={tree.toggleShowAllSessions}
                  />
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <RenamePopover
        isBusy={selection.isBusy}
        renamePopover={popovers.renamePopover}
        projectMenuPopover={popovers.projectMenuPopover}
        projectRenamePopover={popovers.projectRenamePopover}
        onRenameDraftChange={(titleDraft) => popovers.setRenamePopover((c) => (c ? { ...c, titleDraft } : c))}
        onProjectRenameDraftChange={(titleDraft) => popovers.setProjectRenamePopover((c) => (c ? { ...c, titleDraft } : c))}
        onCloseRename={popovers.closeRenamePopover}
        onCloseProjectMenu={popovers.closeProjectMenu}
        onCloseProjectRename={popovers.closeProjectRename}
        onCommitSessionRename={() => void selection.commitSessionRename(popovers.renamePopover, popovers.closeRenamePopover)}
        onCommitProjectRename={() => void selection.handleProjectRenameSubmit(popovers.projectRenamePopover, popovers.closeProjectRename)}
        onOpenExplorer={() => void selection.handleOpenExplorer(popovers.projectMenuPopover!.project)}
        onStartProjectRename={popovers.startProjectRename}
        onSessionCreate={() => void selection.handleSessionCreate(popovers.projectMenuPopover!.project)}
        onRemoveProject={() => {
          const project = popovers.projectMenuPopover?.project;
          if (!project) return;
          popovers.closeProjectMenu();
          setPendingRemoval({ kind: 'project', project });
        }}
      />

      {pendingRemoval ? (
        <ConfirmationDialog
          title={pendingRemoval.kind === 'session'
            ? t('sidebar.removeSessionTitle')
            : t('sidebar.removeProjectTitle')}
          message={pendingRemoval.kind === 'session'
            ? t('sidebar.removeSessionConfirm', { title: pendingRemoval.session.title })
            : t('sidebar.removeProjectConfirm', { name: pendingRemoval.project.name })}
          confirmLabel={selection.isBusy ? t('dialog.deleting') : t('dialog.delete')}
          cancelLabel={t('dialog.cancel')}
          busy={selection.isBusy}
          onCancel={() => setPendingRemoval(null)}
          onConfirm={confirmRemoval}
        />
      ) : null}
    </div>
  );
};

export default Sidebar;
