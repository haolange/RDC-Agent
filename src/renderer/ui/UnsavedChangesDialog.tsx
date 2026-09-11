import React from 'react';
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
}) => (
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
        <Button variant="primary" size="md" autoFocus onClick={onKeepEditing}>{keepEditingLabel}</Button>
      </>
    )}
  >
    <p className="confirmation-message">{message}</p>
  </TaskDialog>
);
