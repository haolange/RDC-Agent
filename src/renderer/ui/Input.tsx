import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../lib/cn';
import './Input.css';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  inputSize?: InputSize;
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    inputSize = 'md',
    error = false,
    className,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <input
      ref={ref}
      disabled={disabled}
      aria-invalid={error || undefined}
      className={cn(
        'input',
        'ui-input',
        inputSize !== 'md' && `is-size-${inputSize}`,
        error && 'is-error',
        disabled && 'is-disabled',
        className,
      )}
      {...rest}
    />
  );
});
