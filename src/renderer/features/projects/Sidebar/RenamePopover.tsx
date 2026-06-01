import React from 'react';
import type {
  ProjectMenuPopoverState,
  ProjectRenamePopoverState,
  SessionRenamePopoverState,
} from './types';
import { RenamePopoverPanels } from './RenamePopoverPanels';
import { useRenamePopover } from './useRenamePopover';

export { getRenamePopoverPosition } from './renamePopoverPosition';
export { useSidebarPopovers } from './useSidebarPopovers';

export interface RenamePopoverProps {
  isBusy: boolean;
  renamePopover: SessionRenamePopoverState | null;
  projectMenuPopover: ProjectMenuPopoverState | null;
  projectRenamePopover: ProjectRenamePopoverState | null;
  onRenameDraftChange: (titleDraft: string) => void;
  onProjectRenameDraftChange: (titleDraft: string) => void;
  onCloseRename: () => void;
  onCloseProjectMenu: () => void;
  onCloseProjectRename: () => void;
  onCommitSessionRename: () => void;
  onCommitProjectRename: () => void;
  onOpenExplorer: () => void;
  onStartProjectRename: () => void;
  onSessionCreate: () => void;
  onRemoveProject: () => void;
}

export const RenamePopover: React.FC<RenamePopoverProps> = (props) => {
  const refs = useRenamePopover({
    renamePopover: props.renamePopover,
    projectMenuPopover: props.projectMenuPopover,
    projectRenamePopover: props.projectRenamePopover,
    onCloseRename: props.onCloseRename,
    onCloseProjectMenu: props.onCloseProjectMenu,
    onCloseProjectRename: props.onCloseProjectRename,
  });

  return <RenamePopoverPanels {...props} {...refs} />;
};
