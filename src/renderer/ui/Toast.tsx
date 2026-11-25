import { useRef, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Icon, type IconName } from './Icon';
import { IconButton } from './IconButton';
import { usePresence } from './usePresence';
import './Toast.css';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

const TONE_ICONS: Record<ToastTone, IconName> = {
  info: 'info',
  success: 'check',
  warning: 'warning',
  error: 'error',
};

export interface ToastProps {
  open: boolean;
  title: ReactNode;
  message?: ReactNode;
  tone?: ToastTone;
  dismissLabel: string;
  onDismiss: () => void;
  /** Runs after the exit animation, when the owner can drop the toast. */
  onExited: () => void;
  /** Hovering or focusing a toast pauses its timer. */
  onHoldChange?: (held: boolean) => void;
  /** A quiet secondary action beside dismiss, such as copying an error's details. */
  action?: ReactNode;
}

/** One toast: a tone icon, one sentence and an optional second, a dismiss button; enters and leaves with motion. */
export function Toast({ open, title, message, tone = 'info', dismissLabel, onDismiss, onExited, onHoldChange, action }: ToastProps) {
  const ref = useRef<HTMLDivElement>(null);
  const presence = usePresence(open, ref, onExited);
  if (!presence.mounted) return null;
  return (
    <div
      ref={ref}
      className={cn('ui-toast', `is-tone-${tone}`)}
      role={tone === 'error' ? 'alert' : 'status'}
      data-state={presence.state}
      onPointerEnter={() => onHoldChange?.(true)}
      onPointerLeave={() => onHoldChange?.(false)}
      onFocus={() => onHoldChange?.(true)}
      onBlur={() => onHoldChange?.(false)}
    >
      <Icon name={TONE_ICONS[tone]} className="ui-toast-icon" />
      <div className="ui-toast-copy">
        <span className="ui-toast-title">{title}</span>
        {message ? <span className="ui-toast-message">{message}</span> : null}
      </div>
      {action ? <div className="ui-toast-action">{action}</div> : null}
      <IconButton label={dismissLabel} size="sm" className="ui-toast-dismiss" onClick={onDismiss}>
        <Icon name="close" size={14} />
      </IconButton>
    </div>
  );
}

export function ToastStack({ children }: { children: ReactNode }) {
  return <div className="ui-toast-stack" aria-live="polite">{children}</div>;
}
