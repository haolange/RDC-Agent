import { cn } from '../lib/cn';
import { HelpTip } from './HelpTip';
import type { HTMLAttributes, ReactNode } from 'react';
import './SectionHeader.css';

export interface SectionHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  /** Explanation of the section; it sits behind a help tip next to the title rather than under it. */
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
        {description ? <HelpTip label={typeof title === 'string' ? title : ''}>{description}</HelpTip> : null}
      </div>
      {actions ? <div className="ui-section-header-actions">{actions}</div> : null}
    </div>
  );
}
