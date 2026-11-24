import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { Icon } from './Icon';
import './CopyButton.css';

/** How long the check mark stays before the button returns to its copy glyph. */
const CONFIRM_MS = 1600;

export interface CopyButtonProps {
  /** Writes to the clipboard and reports whether it succeeded. */
  onCopy: () => Promise<boolean>;
  label: string;
  copiedLabel: string;
  className?: string;
  'data-testid'?: string;
}

export function useCopyFeedback(onCopy: () => Promise<boolean>) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    if (!(await onCopy())) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), CONFIRM_MS);
  };
  return { copied, copy };
}

/** Confirmation appears once the clipboard accepts the text. */
export function CopyButton({ onCopy, label, copiedLabel, className, 'data-testid': testId }: CopyButtonProps) {
  const { copied, copy } = useCopyFeedback(onCopy);
  const current = copied ? copiedLabel : label;
  return (
    <button
      type="button"
      className={cn('ui-copy-button', copied && 'is-copied', className)}
      aria-label={current}
      data-tooltip={current}
      data-copied={copied ? 'true' : 'false'}
      data-testid={testId}
      onClick={(event) => {
        event.stopPropagation();
        void copy();
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={14} />
    </button>
  );
}
