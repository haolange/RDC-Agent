import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'button button-primary',
  secondary: 'button button-secondary',
  ghost: 'button button-ghost',
  danger: 'button button-danger',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'button-sm',
  md: '',
  lg: 'button-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    className = '',
    type = 'button',
    children,
    ...rest
  },
  ref,
) {
  const classes = [variantClass[variant], sizeClass[size], className]
    .filter(Boolean)
    .join(' ');
  return (
    <button ref={ref} type={type} className={classes} {...rest}>
      {children}
    </button>
  );
});
