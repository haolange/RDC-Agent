import type { HTMLAttributes, ReactNode } from 'react';

export type BadgeTone = 'primary' | 'accent' | 'success' | 'warning' | 'error';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  children: ReactNode;
}

export function Badge({ tone = 'primary', className = '', children, ...rest }: BadgeProps) {
  return (
    <span className={`ui-badge ui-badge--${tone} ${className}`.trim()} {...rest}>
      {children}
    </span>
  );
}
