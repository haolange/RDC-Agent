import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';
import { useOverlayLayer } from '../lib/overlayStack';
import { useModalFocus } from '../lib/useModalFocus';
import { IconButton } from './IconButton';
import { Icon } from './Icon';
import './TaskDialog.css';

export type TaskDialogSize = 'sm' | 'md' | 'lg';

export interface TaskDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  closeLabel: string;
  size?: TaskDialogSize;
  busy?: boolean;
  /** Renders as `alertdialog` with no dismiss affordance in the header. */
  variant?: 'task' | 'alert';
  className?: string;
  dataTestId?: string;
}

/**
 * Shared task sub-dialog: fixed title / body / footer, layered above the page
 * it was launched from without replacing it. Escape only reaches the topmost
 * layer; focus returns to the trigger on close.
 */
export function TaskDialog({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  closeLabel,
  size = 'md',
  busy = false,
  variant = 'task',
  className,
  dataTestId,
}: TaskDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const { layerId } = useOverlayLayer(open);

  useModalFocus({ open, containerRef: dialogRef, onClose, busy, layerId });

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="task-dialog-overlay"
      data-overlay-layer
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={cn('task-dialog', `is-size-${size}`, className)}
        role={variant === 'alert' ? 'alertdialog' : 'dialog'}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={busy}
        data-task-dialog
        data-testid={dataTestId}
      >
        <header className="task-dialog-header">
          <div className="task-dialog-heading">
            <h2 id={titleId} className="task-dialog-title">{title}</h2>
            {description ? (
              <p id={descriptionId} className="task-dialog-description">{description}</p>
            ) : null}
          </div>
          {variant === 'task' ? (
            <IconButton label={closeLabel} size="sm" disabled={busy} onClick={onClose}>
              <Icon name="close" size={16} />
            </IconButton>
          ) : null}
        </header>
        <div className="task-dialog-body">{children}</div>
        {footer ? <footer className="task-dialog-footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
