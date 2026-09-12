import React, { useEffect, useRef } from 'react';
import { Button } from './Button';
import { TaskDialog } from './TaskDialog';

export interface UnsavedChangesDialogProps {
  title: string;
  message: string;
  /** Primary, non-destructive: returns to the form. */
  keepEditingLabel: string;
  /** Secondary, drops only this form's uncommitted draft. */
  discardLabel: string;
  onKeepEditing: () => void;
  onDiscard: () => void;
}

/**
 * Shared exit guard for manually saved forms. Auto-saving editors keep their
 * own retry semantics and must not use this template.
 */
export const UnsavedChangesDialog: React.FC<UnsavedChangesDialogProps> = ({
  title,
  message,
  keepEditingLabel,
  discardLabel,
  onKeepEditing,
  onDiscard,
}) => {
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => keepEditingRef.current?.focus());
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  return (
  <TaskDialog
    open
    variant="alert"
    size="sm"
    title={title}
    onClose={onKeepEditing}
    closeLabel={keepEditingLabel}
    footer={(
      <>
        <Button variant="ghost" size="md" onClick={onDiscard}>{discardLabel}</Button>
        <Button ref={keepEditingRef} variant="primary" size="md" onClick={onKeepEditing}>{keepEditingLabel}</Button>
      </>
    )}
  >
    <p className="confirmation-message">{message}</p>
  </TaskDialog>
  );
};
