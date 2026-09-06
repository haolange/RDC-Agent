import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '../lib/cn';
import './Input.css';

export type TextareaSize = 'md' | 'lg';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  inputSize?: TextareaSize;
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    inputSize = 'md',
    error = false,
    className,
    disabled,
    rows = 4,
    ...rest
  },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      disabled={disabled}
      aria-invalid={error || undefined}
      className={cn(
        'ui-textarea',
        inputSize !== 'md' && `is-size-${inputSize}`,
        error && 'is-error',
        disabled && 'is-disabled',
        className,
      )}
      {...rest}
    />
  );
});
