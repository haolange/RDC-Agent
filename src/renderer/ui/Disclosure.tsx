import { useId, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import './Disclosure.css';
import { Chevron } from './Chevron';

export interface DisclosureProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Content of the trigger row; the chevron is drawn by the component. */
  summary: ReactNode;
  /** Accessible name when the visible summary is not descriptive on its own. */
  triggerLabel?: string;
  /** Controls beside the trigger (copy, counts); they do not toggle. */
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
  triggerClassName?: string;
  bodyClassName?: string;
}

/**
 * A controlled disclosure whose owner decides when it opens (streaming, latest step, user choice). Closed
 * bodies are not rendered, so long work traces only pay for what is open.
 */
export function Disclosure({
  open,
  onOpenChange,
  summary,
  triggerLabel,
  trailing,
  children,
  className,
  triggerClassName,
  bodyClassName,
}: DisclosureProps) {
  const bodyId = useId();
  return (
    <div className={cn('ui-disclosure', open && 'is-open', className)}>
      <div className="ui-disclosure-header">
        <button
          type="button"
          className={cn('ui-disclosure-trigger', open && 'is-expanded', triggerClassName)}
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          aria-label={triggerLabel}
          onClick={() => onOpenChange(!open)}
        >
          <Chevron open={open} size={12} className="ui-disclosure-chevron" />
          <span className="ui-disclosure-summary">{summary}</span>
        </button>
        {trailing ? <div className="ui-disclosure-trailing">{trailing}</div> : null}
      </div>
      {open ? (
        <div id={bodyId} className={cn('ui-disclosure-body', bodyClassName)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
