import type { ReactNode } from 'react';

/** The hidden semibold copy reserves space for mouse and keyboard emphasis. */
export function WorkRowTitle({ text, children, className, wrap = false }: {
  text: string;
  children?: ReactNode;
  className?: string;
  wrap?: boolean;
}) {
  const classes = ['work-row-title', wrap && 'is-wrapping', className].filter(Boolean).join(' ');
  return <span className={classes} data-text={text}><span>{children ?? text}</span></span>;
}
