import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Icon } from './Icon';
import './InlineError.css';

export interface InlineErrorProps extends HTMLAttributes<HTMLParagraphElement> {
  children: ReactNode;
}

export function InlineError({ children, className, ...rest }: InlineErrorProps) {
  return (
    <p className={cn('ui-inline-error', className)} role="alert" {...rest}>
      <Icon name="error" size={12} className="ui-inline-error-icon" />
      <span>{children}</span>
    </p>
  );
}
