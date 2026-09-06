import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import './Pill.css';

export type PillSize = 'sm' | 'md';

export interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: PillSize;
  selected?: boolean;
  running?: boolean;
  children: ReactNode;
}

export const Pill = forwardRef<HTMLButtonElement, PillProps>(function Pill(
  {
    size = 'sm',
    selected = false,
    running = false,
    className,
    disabled,
    type = 'button',
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        'ui-pill',
        size === 'md' && 'is-size-md',
        selected && 'is-selected',
        running && 'is-running',
        disabled && 'is-disabled',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
