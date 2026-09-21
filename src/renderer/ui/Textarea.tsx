import { forwardRef, useLayoutEffect, useRef, useImperativeHandle, type TextareaHTMLAttributes } from 'react';
import { observeTextareaSizing } from '../lib/textareaSizing';
import { cn } from '../lib/cn';
import './Input.css';

export type TextareaSize = 'md' | 'lg';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  inputSize?: TextareaSize;
  error?: boolean;
  sizing?: 'content' | 'fill';
  minRows?: number;
  maxRows?: number;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    inputSize = 'md',
    error = false,
    className,
    disabled,
    rows,
    sizing = 'content',
    minRows = 1,
    maxRows = 8,
    ...rest
  },
  ref,
) {
  const element = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => element.current!, []);
  useLayoutEffect(() => {
    if (sizing === 'content' && element.current) {
      return observeTextareaSizing(element.current, minRows, maxRows);
    }
  }, [sizing, minRows, maxRows, rest.value, rest.defaultValue]);
  return (
    <textarea
      ref={element}
      rows={rows ?? minRows}
      disabled={disabled}
      aria-invalid={error || undefined}
      className={cn(
        'ui-textarea',
        `is-sizing-${sizing}`,
        inputSize !== 'md' && `is-size-${inputSize}`,
        error && 'is-error',
        disabled && 'is-disabled',
        className,
      )}
      {...rest}
    />
  );
});
