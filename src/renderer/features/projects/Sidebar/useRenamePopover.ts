import { useEffect, useRef } from 'react';
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

  useEffect(() => {
    if (!renamePopover && !projectMenuPopover && !projectRenamePopover) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (renamePopover && !renamePopoverRef.current?.contains(target)) {
        onCloseRename();
      }
      if (projectMenuPopover && !projectMenuRef.current?.contains(target)) {
        onCloseProjectMenu();
      }
      if (projectRenamePopover && !projectRenameRef.current?.contains(target)) {
        onCloseProjectRename();
      }
    };

    const handleDismiss = () => {
      onCloseRename();
      onCloseProjectMenu();
      onCloseProjectRename();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRename();
        onCloseProjectMenu();
        onCloseProjectRename();
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
