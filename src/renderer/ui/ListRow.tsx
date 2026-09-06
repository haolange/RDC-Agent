import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import './ListRow.css';

export interface ListRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  leading?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  children: ReactNode;
}

export const ListRow = forwardRef<HTMLButtonElement, ListRowProps>(function ListRow(
  {
    leading,
    trailing,
    selected = false,
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
      aria-selected={selected}
      className={cn(
        'ui-list-row',
        selected && 'is-selected',
        disabled && 'is-disabled',
        className,
      )}
      {...rest}
    >
      {leading ? <span className="ui-list-row-leading">{leading}</span> : null}
      <span className="ui-list-row-body">{children}</span>
      {trailing ? <span className="ui-list-row-trailing">{trailing}</span> : null}
    </button>
  );
});
