import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../lib/cn';
import './Details.css';

export interface DetailsProps extends Omit<ComponentPropsWithoutRef<'details'>, 'title'> {
  summary: ReactNode;
  summaryClassName?: string;
}

/** Native disclosure keeps hidden detail out of the tab order and supports Enter/Space. */
export function Details({ summary, summaryClassName, className, children, ...props }: DetailsProps) {
  return <details className={cn('ui-details', className)} {...props}>
    <summary className={summaryClassName}>{summary}</summary>
    {children}
  </details>;
}
