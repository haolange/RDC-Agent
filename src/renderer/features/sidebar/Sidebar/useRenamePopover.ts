import { useEffect, useRef } from 'react';
import { useDismissable } from '../../../lib/useDismissable';
import type {
  ProjectMenuPopoverState,
  ProjectRenamePopoverState,
  SessionRenamePopoverState,
} from './types';

interface UseRenamePopoverOptions {
  renamePopover: SessionRenamePopoverState | null;
  projectMenuPopover: ProjectMenuPopoverState | null;
  projectRenamePopover: ProjectRenamePopoverState | null;
  onCloseRename: () => void;
  onCloseProjectMenu: () => void;
  onCloseProjectRename: () => void;
}

export function useRenamePopover({
  renamePopover,
  projectMenuPopover,
  projectRenamePopover,
  onCloseRename,
  onCloseProjectMenu,
  onCloseProjectRename,
}: UseRenamePopoverOptions) {
  const renamePopoverRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const initializedRenameTargetRef = useRef<string | null>(null);

  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  const projectRenameRef = useRef<HTMLDivElement | null>(null);
  const projectRenameInputRef = useRef<HTMLInputElement | null>(null);
  const initializedProjectRenameTargetRef = useRef<string | null>(null);

  useDismissable({ open: Boolean(renamePopover), inside: () => [renamePopoverRef.current], onDismiss: onCloseRename });
  useDismissable({ open: Boolean(projectMenuPopover), inside: () => [projectMenuRef.current], onDismiss: onCloseProjectMenu });
  useDismissable({ open: Boolean(projectRenamePopover), inside: () => [projectRenameRef.current], onDismiss: onCloseProjectRename });

  // The popovers are anchored to sidebar rows; a window resize moves the rows, so it closes them.
  useEffect(() => {
    if (!renamePopover && !projectMenuPopover && !projectRenamePopover) return;
    const handleDismiss = () => {
      onCloseRename();
      onCloseProjectMenu();
      onCloseProjectRename();
    };
    window.addEventListener('resize', handleDismiss);
    return () => window.removeEventListener('resize', handleDismiss);
  }, [renamePopover, projectMenuPopover, projectRenamePopover, onCloseRename, onCloseProjectMenu, onCloseProjectRename]);

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

  return {
    renamePopoverRef,
    renameInputRef,
    projectMenuRef,
    projectRenameRef,
    projectRenameInputRef,
  };
}
