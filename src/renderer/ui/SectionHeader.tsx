import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import './SectionHeader.css';

export interface SectionHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function SectionHeader({
  title,
  description,
  actions,
  className,
  ...rest
}: SectionHeaderProps) {
  return (
    <div className={cn('ui-section-header', className)} {...rest}>
      <div className="ui-section-header-copy">
        <h3 className="ui-section-header-title">{title}</h3>
        {description ? <p className="ui-section-header-description">{description}</p> : null}
      </div>
      {actions ? <div className="ui-section-header-actions">{actions}</div> : null}
    </div>
  );
}
