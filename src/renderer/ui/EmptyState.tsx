import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import './EmptyState.css';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  visual?: ReactNode;
}

export function EmptyState({
  title,
  description,
  actions,
  visual,
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div className={cn('ui-empty-state', className)} {...rest}>
      {visual ? <div className="ui-empty-state-visual">{visual}</div> : null}
      <p className="ui-empty-state-title">{title}</p>
      {description ? <p className="ui-empty-state-description">{description}</p> : null}
      {actions ? <div className="ui-empty-state-actions">{actions}</div> : null}
    </div>
  );
}
