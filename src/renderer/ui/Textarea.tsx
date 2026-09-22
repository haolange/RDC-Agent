import { forwardRef, useLayoutEffect, useRef, useImperativeHandle, type TextareaHTMLAttributes } from 'react';
import { observeTextareaSizing } from '../lib/textareaSizing';
import { cn } from '../lib/cn';
import './Input.css';

export type TextareaSize = 'md' | 'lg';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  inputSize?: TextareaSize;
  error?: boolean;
  sizing?: 'content' | 'fill';
  /** `plain` is the shell writing surface: no field fill, border, or radius. */
  chrome?: 'field' | 'plain';
  minRows?: number;
  maxRows?: number;
  minHeight?: number;
  maxHeight?: number;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    inputSize = 'md',
    error = false,
    className,
    disabled,
    rows,
    sizing = 'content',
    chrome = 'field',
    minRows = 1,
    maxRows = 8,
    minHeight,
    maxHeight,
    ...rest
  },
  ref,
) {
  const element = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => element.current!, []);
  useLayoutEffect(() => {
    if (sizing === 'content' && element.current) {
      return observeTextareaSizing(element.current, minRows, maxRows, { minHeight, maxHeight });
    }
  }, [sizing, minRows, maxRows, minHeight, maxHeight, rest.value, rest.defaultValue]);
  return (
    <textarea
      ref={element}
      rows={rows ?? minRows}
      disabled={disabled}
      aria-invalid={error || undefined}
      className={cn(
        'ui-textarea',
        chrome === 'plain' && 'is-chrome-plain',
        `is-sizing-${sizing}`,
        chrome === 'field' && inputSize !== 'md' && `is-size-${inputSize}`,
        error && 'is-error',
        disabled && 'is-disabled',
        className,
      )}
      {...rest}
    />
  );
});
