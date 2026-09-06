import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import './Panel.css';

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  header?: ReactNode;
  children: ReactNode;
}

export function Panel({ header, children, className, ...rest }: PanelProps) {
  return (
    <section className={cn('ui-panel', className)} {...rest}>
      {header ? <div className="ui-panel-header">{header}</div> : null}
      <div className="ui-panel-body">{children}</div>
    </section>
  );
}
