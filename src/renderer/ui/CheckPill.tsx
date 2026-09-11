import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import './CheckPill.css';

export interface CheckPillProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Secondary text shown under the label, e.g. a tool's purpose. */
  hint?: ReactNode;
  children: ReactNode;
}

/**
 * Lightweight multi-select control: a check mark plus text, never a large
 * checkbox card. Used for tool permissions and knowledge filters.
 */
export const CheckPill = forwardRef<HTMLButtonElement, CheckPillProps>(function CheckPill(
  { checked, onCheckedChange, hint, className, disabled, type = 'button', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      className={cn('ui-check-pill', checked && 'is-selected', disabled && 'is-disabled', className)}
      onClick={() => onCheckedChange(!checked)}
      {...rest}
    >
      <span className="ui-check-pill-box" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M5 12.5 9.5 17 19 7" />
        </svg>
      </span>
      <span className="ui-check-pill-text">
        <span className="ui-check-pill-label">{children}</span>
        {hint ? <span className="ui-check-pill-hint">{hint}</span> : null}
      </span>
    </button>
  );
});
