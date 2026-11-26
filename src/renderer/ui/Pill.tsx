import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import './Pill.css';

export interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  running?: boolean;
  children: ReactNode;
}

export const Pill = forwardRef<HTMLButtonElement, PillProps>(function Pill(
  { selected = false, running = false, className, disabled, type = 'button', children, ...rest },
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
