import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import './ListRow.css';

export interface ListRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Second line under the title; the row grows to two lines instead of truncating context away. */
  description?: ReactNode;
  selected?: boolean;
  children: ReactNode;
}

export const ListRow = forwardRef<HTMLButtonElement, ListRowProps>(function ListRow(
  {
    leading,
    trailing,
    description,
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
        description !== undefined && description !== null && 'has-description',
        className,
      )}
      {...rest}
    >
      {leading ? <span className="ui-list-row-leading">{leading}</span> : null}
      <span className="ui-list-row-body">
        <span className="ui-list-row-title">{children}</span>
        {description !== undefined && description !== null
          ? <span className="ui-list-row-description">{description}</span> : null}
      </span>
      {trailing ? <span className="ui-list-row-trailing">{trailing}</span> : null}
    </button>
  );
});
