import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../lib/cn';
import './Details.css';

export interface DetailsProps extends Omit<ComponentPropsWithoutRef<'details'>, 'title'> {
  summary: ReactNode;
  summaryClassName?: string;
  variant?: 'inline' | 'panel';
}

/** Native disclosure keeps hidden detail out of the tab order and supports Enter/Space. */
export function Details({ summary, summaryClassName, className, children, variant = 'inline', ...props }: DetailsProps) {
  return <details className={cn('ui-details', `ui-details-${variant}`, className)} {...props}>
    <summary className={summaryClassName}>{summary}</summary>
    {children}
  </details>;
}
