import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import './Toast.css';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  message?: ReactNode;
  tone?: ToastTone;
  onDismiss?: () => void;
  dismissLabel?: string;
}

export function Toast({
  title,
  message,
  tone = 'info',
  onDismiss,
  dismissLabel = 'Dismiss',
  className,
  ...rest
}: ToastProps) {
  return (
    <div
      className={cn('ui-toast', `is-tone-${tone}`, className)}
      role="status"
      {...rest}
    >
      <div className="ui-toast-copy">
        <span className="ui-toast-title notification-toast-title">{title}</span>
        {message ? <span className="ui-toast-message notification-toast-message">{message}</span> : null}
      </div>
      {onDismiss ? (
        <IconButton label={dismissLabel} size="sm" className="ui-toast-dismiss notification-toast-close" onClick={onDismiss}>
          <Icon name="close" size={12} />
        </IconButton>
      ) : null}
    </div>
  );
}

export function ToastStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('ui-toast-stack', className)}>{children}</div>;
}
