import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type PlainButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * A native button with no look of its own, for controls whose appearance belongs to their domain: list and tree rows,
 * navigation items, window controls, disclosure headers. It defaults to `type="button"` and forwards its ref; actions
 * that look like buttons use `Button` or `IconButton` instead.
 */
export const PlainButton = forwardRef<HTMLButtonElement, PlainButtonProps>(function PlainButton(
  { type = 'button', ...rest },
  ref,
) {
  return <button ref={ref} type={type} {...rest} />;
});
