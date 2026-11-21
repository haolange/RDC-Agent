import { cn } from '../lib/cn';
import type { HTMLAttributes, ReactNode } from 'react';
import './Badge.css';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'error';
/** `soft` tints status; `outline` labels metadata (provenance, kind, provider) without implying state. */
export type BadgeVariant = 'soft' | 'outline';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  variant?: BadgeVariant;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', variant = 'soft', className, children, ...rest }: BadgeProps) {
  return (
    <span className={cn('ui-badge', `is-tone-${tone}`, `is-${variant}`, className)} {...rest}>
      {children}
    </span>
  );
}
