import { useCallback, useState } from 'react';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';
import type {
  ProjectMenuPopoverState,
  ProjectRenamePopoverState,
  SessionRenamePopoverState,
} from './types';
import { getRenamePopoverPosition } from './renamePopoverPosition';

export function useSidebarPopovers() {
  const [renamePopover, setRenamePopover] = useState<SessionRenamePopoverState | null>(null);
  const [projectMenuPopover, setProjectMenuPopover] = useState<ProjectMenuPopoverState | null>(null);
  const [projectRenamePopover, setProjectRenamePopover] = useState<ProjectRenamePopoverState | null>(null);

  const closeRenamePopover = useCallback(() => setRenamePopover(null), []);
  const closeProjectMenu = useCallback(() => setProjectMenuPopover(null), []);
  const closeProjectRename = useCallback(() => setProjectRenamePopover(null), []);

  const openRenamePopover = useCallback((session: SessionRecord, x: number, y: number) => {
    const position = getRenamePopoverPosition(x, y);
    setRenamePopover({ session, x: position.x, y: position.y, titleDraft: session.title });
  }, []);

  const openProjectMenuPopover = useCallback((project: ProjectRecord, x: number, y: number) => {
    const position = getRenamePopoverPosition(x, y);
    setProjectMenuPopover({ project, x: position.x, y: position.y });
  }, []);

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

  const handleRenameKeyDown = useCallback((event: React.KeyboardEvent, session: SessionRecord) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      openRenamePopover(session, rect.right - 24, rect.bottom + 8);
    }
  }, [openRenamePopover]);

  const startProjectRename = useCallback(() => {
    if (!projectMenuPopover) return;
    const { project, x, y } = projectMenuPopover;
    setProjectMenuPopover(null);
    setProjectRenamePopover({ project, x, y, titleDraft: project.name });
  }, [projectMenuPopover]);

  return {
    renamePopover,
    projectMenuPopover,
    projectRenamePopover,
    closeRenamePopover,
    closeProjectMenu,
    closeProjectRename,
    openProjectMenuPopover,
    handleSessionContextMenu,
    handleRenameButtonClick,
    handleRenameKeyDown,
    startProjectRename,
    setRenamePopover,
    setProjectRenamePopover,
  };
}
