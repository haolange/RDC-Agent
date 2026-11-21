import React from 'react';
import { useI18n } from '../../../i18n';
import { useDynStyle } from '../../../lib/useDynStyle';
import { Button } from '../../../ui/Button';
import { Icon } from '../../../ui/Icon';
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

const PositionedSurface: React.FC<{
  className: string;
  x: number;
  y: number;
  surfaceRef: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
}> = ({ className, x, y, surfaceRef, children }) => {
  const dynStyle = useDynStyle({
    top: `${y}px`,
    left: `${x}px`,
  });

  return (
    <div ref={surfaceRef} className={className} {...dynStyle}>
      {children}
    </div>
  );
};

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
        <PositionedSurface
          surfaceRef={renamePopoverRef}
          className="session-rename-popover"
          x={renamePopover.x}
          y={renamePopover.y}
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
            <Button
              variant="secondary"
              size="sm"
              className="session-rename-popover-button session-rename-popover-button-secondary"
              onClick={onCloseRename}
              disabled={isBusy}
            >
              {t('sidebar.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="session-rename-popover-button session-rename-popover-button-primary"
              onClick={() => void onCommitSessionRename()}
              disabled={isBusy}
            >
              {t('sidebar.save')}
            </Button>
          </div>
        </PositionedSurface>
      )}
      {projectMenuPopover && (
        <PositionedSurface
          surfaceRef={projectMenuRef}
          className="sidebar-context-menu"
          x={projectMenuPopover.x}
          y={projectMenuPopover.y}
        >
          <button
            type="button"
            className="sidebar-context-menu-item"
            onClick={() => void onOpenExplorer()}
            data-tooltip={t('sidebar.menuExplorer')}
          >
            <Icon name="folder" size={14} />
            <span>{t('sidebar.openInExplorer')}</span>
          </button>
          <button
            type="button"
            className="sidebar-context-menu-item"
            onClick={onStartProjectRename}
            data-tooltip={t('sidebar.menuRename')}
          >
            <Icon name="edit" size={14} />
            <span>{t('sidebar.renameProject')}</span>
          </button>
          <button
            type="button"
            className="sidebar-context-menu-item"
            onClick={() => void onSessionCreate()}
            data-tooltip={t('sidebar.menuNewSession')}
            disabled={isBusy}
          >
            <Icon name="plus" size={14} />
            <span>{t('sidebar.addSession')}</span>
          </button>
          <div className="sidebar-context-menu-divider" role="separator" />
          <button
            type="button"
            className="sidebar-context-menu-item is-destructive"
            onClick={() => void onRemoveProject()}
            data-tooltip={t('sidebar.menuDelete')}
            disabled={isBusy}
          >
            <Icon name="trash" size={14} />
            <span>{t('sidebar.removeProject')}</span>
          </button>
        </PositionedSurface>
      )}

      {projectRenamePopover && (
        <PositionedSurface
          surfaceRef={projectRenameRef}
          className="session-rename-popover"
          x={projectRenamePopover.x}
          y={projectRenamePopover.y}
        >
          <div className="session-rename-popover-title">{t('sidebar.renameProjectTitle')}</div>
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
            <Button
              variant="secondary"
              size="sm"
              className="session-rename-popover-button session-rename-popover-button-secondary"
              onClick={onCloseProjectRename}
              disabled={isBusy}
            >
              {t('sidebar.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="session-rename-popover-button session-rename-popover-button-primary"
              onClick={() => void onCommitProjectRename()}
              disabled={isBusy}
            >
              {t('sidebar.save')}
            </Button>
          </div>
        </PositionedSurface>
      )}
    </>
  );
};
