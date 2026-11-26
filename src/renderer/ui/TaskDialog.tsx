import { useId, type ReactNode, type RefObject } from 'react';
import { cn } from '../lib/cn';
import { IconButton } from './IconButton';
import { Icon } from './Icon';
import { ModalLayer } from './ModalLayer';
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
  variant = 'task',
  className,
  dataTestId,
}: TaskDialogProps) {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <ModalLayer
      open={open}
      onClose={onClose}
      busy={busy}
      fallbackFocusRef={fallbackFocusRef}
      overlayClassName="task-dialog-overlay"
      className={cn('task-dialog', `is-size-${size}`, className)}
      role={variant === 'alert' ? 'alertdialog' : 'dialog'}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={busy}
      data-task-dialog
      data-testid={dataTestId}
    >
      <header className="task-dialog-header">
        <div className="task-dialog-heading">
          <h2 id={titleId} className="task-dialog-title">
            {titleIcon ? (
              <span className="task-dialog-title-with-icon">
                {titleIcon}
                {title}
              </span>
            ) : (
              title
            )}
          </h2>
          {description ? (
            <p id={descriptionId} className="task-dialog-description">
              {description}
            </p>
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
    </ModalLayer>
  );
}
