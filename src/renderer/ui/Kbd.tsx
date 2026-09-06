import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import './Kbd.css';

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

export function Kbd({ className, children, ...rest }: KbdProps) {
  return (
    <kbd className={cn('ui-kbd', className)} {...rest}>
      {children}
    </kbd>
  );
}
