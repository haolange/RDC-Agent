import { cn } from '../lib/cn';
import type { HTMLAttributes, ReactNode } from 'react';
import './EmptyState.css';

/**
 * `inline` is a quiet line where content would be (a list with no rows); `panel` is a bounded surface for an
 * empty resource that offers a way to create one; `page` fills a column or pane with a centered message.
 */
export type EmptyStateVariant = 'inline' | 'panel' | 'page';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  visual?: ReactNode;
  variant?: EmptyStateVariant;
}

export function EmptyState({
  title,
  description,
  actions,
  visual,
  variant = 'inline',
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div className={cn('ui-empty-state', `is-${variant}`, className)} {...rest}>
      {visual ? <div className="ui-empty-state-visual">{visual}</div> : null}
      <p className="ui-empty-state-title">{title}</p>
      {description ? <p className="ui-empty-state-description">{description}</p> : null}
      {actions ? <div className="ui-empty-state-actions">{actions}</div> : null}
    </div>
  );
}
