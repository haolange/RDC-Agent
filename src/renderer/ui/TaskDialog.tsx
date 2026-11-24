import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';
import { useOverlayLayer } from '../lib/overlayStack';
import { useModalFocus } from '../lib/useModalFocus';
import { IconButton } from './IconButton';
import { Icon } from './Icon';
import { usePresence } from './usePresence';
import './TaskDialog.css';

export type TaskDialogSize = 'sm' | 'md' | 'lg';

export interface TaskDialogProps {
  open: boolean;
  title: string;
  titleIcon?: ReactNode;
  headerActions?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  fallbackFocusRef?: RefObject<HTMLElement>;
  closeLabel: string;
  size?: TaskDialogSize;
  busy?: boolean;
  /** Image editors keep drafts open when the surrounding backdrop is pressed. */
  dismissOnBackdrop?: boolean;
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
  titleIcon,
  headerActions,
  description,
  children,
  footer,
  onClose,
  fallbackFocusRef,
  closeLabel,
  size = 'md',
  busy = false,
  dismissOnBackdrop = true,
  variant = 'task',
  className,
  dataTestId,
}: TaskDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const { layerId } = useOverlayLayer(open);
  const presence = usePresence(open, overlayRef);

  useModalFocus({ open, containerRef: dialogRef, onClose, busy, layerId, fallbackFocusRef });

  if (!presence.mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="task-dialog-overlay"
      data-state={presence.state}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissOnBackdrop && !busy) onClose();
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
            <h2 id={titleId} className="task-dialog-title">
              {titleIcon ? <span className="task-dialog-title-with-icon">{titleIcon}{title}</span> : title}
            </h2>
            {description ? (
              <p id={descriptionId} className="task-dialog-description">{description}</p>
            ) : null}
          </div>
          {headerActions}
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
