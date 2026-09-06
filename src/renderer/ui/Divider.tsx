import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn';
import './Divider.css';

export interface DividerProps extends HTMLAttributes<HTMLHRElement> {
  orientation?: 'horizontal' | 'vertical';
}

export function Divider({ orientation = 'horizontal', className, ...rest }: DividerProps) {
  return (
    <hr
      className={cn('ui-divider', orientation === 'vertical' ? 'is-vertical' : 'is-horizontal', className)}
      aria-orientation={orientation}
      {...rest}
    />
  );
}
