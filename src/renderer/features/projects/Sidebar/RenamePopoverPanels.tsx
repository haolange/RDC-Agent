import React from 'react';
import { useI18n } from '../../../i18n';
import type {
  ProjectMenuPopoverState,
  ProjectRenamePopoverState,
  SessionRenamePopoverState,
} from './types';

interface RenamePopoverPanelsProps {
  isBusy: boolean;
  renamePopover: SessionRenamePopoverState | null;
  projectMenuPopover: ProjectMenuPopoverState | null;
  projectRenamePopover: ProjectRenamePopoverState | null;
  renamePopoverRef: React.Ref<HTMLDivElement>;
  renameInputRef: React.Ref<HTMLInputElement>;
  projectMenuRef: React.Ref<HTMLDivElement>;
  projectRenameRef: React.Ref<HTMLDivElement>;
  projectRenameInputRef: React.Ref<HTMLInputElement>;
  onRenameDraftChange: (titleDraft: string) => void;
  onProjectRenameDraftChange: (titleDraft: string) => void;
  onCloseRename: () => void;
  onCloseProjectRename: () => void;
  onCommitSessionRename: () => void;
  onCommitProjectRename: () => void;
  onOpenExplorer: () => void;
  onStartProjectRename: () => void;
  onSessionCreate: () => void;
  onRemoveProject: () => void;
}

export const RenamePopoverPanels: React.FC<RenamePopoverPanelsProps> = ({
  isBusy,
  renamePopover,
  projectMenuPopover,
  projectRenamePopover,
  renamePopoverRef,
  renameInputRef,
  projectMenuRef,
  projectRenameRef,
  projectRenameInputRef,
  onRenameDraftChange,
  onProjectRenameDraftChange,
  onCloseRename,
  onCloseProjectRename,
  onCommitSessionRename,
  onCommitProjectRename,
  onOpenExplorer,
  onStartProjectRename,
  onSessionCreate,
  onRemoveProject,
}) => {
  const { t } = useI18n();

  return (
    <>
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
            onChange={(event) => onRenameDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void onCommitSessionRename();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRename();
              }
            }}
            maxLength={80}
            disabled={isBusy}
          />
          <div className="session-rename-popover-actions">
            <button
              type="button"
              className="session-rename-popover-button session-rename-popover-button-secondary"
              onClick={onCloseRename}
              disabled={isBusy}
            >
              {t('sidebar.cancel')}
            </button>
            <button
              type="button"
              className="session-rename-popover-button session-rename-popover-button-primary"
              onClick={() => void onCommitSessionRename()}
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
            onClick={() => void onOpenExplorer()}
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
            onClick={onStartProjectRename}
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
            onClick={() => void onSessionCreate()}
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
            onClick={() => void onRemoveProject()}
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
            onChange={(event) => onProjectRenameDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void onCommitProjectRename();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                onCloseProjectRename();
              }
            }}
            maxLength={80}
            disabled={isBusy}
          />
          <div className="session-rename-popover-actions">
            <button
              type="button"
              className="session-rename-popover-button session-rename-popover-button-secondary"
              onClick={onCloseProjectRename}
              disabled={isBusy}
            >
              {t('sidebar.cancel') || 'Cancel'}
            </button>
            <button
              type="button"
              className="session-rename-popover-button session-rename-popover-button-primary"
              onClick={() => void onCommitProjectRename()}
              disabled={isBusy}
            >
              {t('sidebar.save') || 'Save'}
            </button>
          </div>
        </div>
      )}
    </>
  );
};
