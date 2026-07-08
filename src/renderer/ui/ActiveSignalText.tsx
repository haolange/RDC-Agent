import type { HTMLAttributes, ReactNode } from 'react';

export type ActiveSignalTone =
  | 'neutral'
  | 'info'
  | 'interaction'
  | 'response';

interface ActiveSignalTextProps extends HTMLAttributes<HTMLSpanElement> {
  active?: boolean;
  tone?: ActiveSignalTone;
  children: ReactNode;
}

export function ActiveSignalText({
  active = false,
  tone = 'neutral',
  className = '',
  children,
  ...rest
}: ActiveSignalTextProps) {
  const classes = [
    'active-signal-text',
    active ? 'is-active' : '',
    `tone-${tone}`,
    className,
  ].filter(Boolean).join(' ');

  return (
    <span
      {...rest}
      className={classes}
      data-active-signal={active ? tone : undefined}
    >
      {children}
    </span>
  );
}
