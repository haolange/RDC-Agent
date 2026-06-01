import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'ui-btn ui-btn--primary',
  secondary: 'ui-btn ui-btn--secondary',
  ghost: 'ui-btn ui-btn--ghost',
};

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${variantClass[variant]} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
