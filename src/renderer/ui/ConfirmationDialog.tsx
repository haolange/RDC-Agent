import React, { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button';
import { TaskDialog } from './TaskDialog';
import './ConfirmationDialog.css';

export interface ConfirmationDialogDetail {
  label: string;
  value: string;
}

export interface ConfirmationDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Read-only facts about the target, e.g. resource name and scope. */
  details?: readonly ConfirmationDialogDetail[];
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Danger confirmation built on the shared task dialog: `alertdialog` semantics,
 * destructive primary action, and default focus on Cancel.
 */
export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  title,
  message,
  confirmLabel,
  cancelLabel,
  details,
  busy = false,
  onConfirm,
  onCancel,
}) => {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => cancelRef.current?.focus());
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  const footer: ReactNode = (
    <>
      <Button ref={cancelRef} variant="secondary" size="md" disabled={busy} onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button variant="danger" size="md" disabled={busy} onClick={() => void onConfirm()}>
        {confirmLabel}
      </Button>
    </>
  );

  return (
    <TaskDialog
      open
      variant="alert"
      size="sm"
      title={title}
      onClose={onCancel}
      closeLabel={cancelLabel}
      busy={busy}
      footer={footer}
      className="confirmation-dialog"
    >
      <p className="confirmation-message">{message}</p>
      {details && details.length > 0 ? (
        <dl className="confirmation-details">
          {details.map((detail) => (
            <div key={detail.label} className="confirmation-detail">
              <dt className="confirmation-detail-label">{detail.label}</dt>
              <dd className="confirmation-detail-value">{detail.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </TaskDialog>
  );
};
