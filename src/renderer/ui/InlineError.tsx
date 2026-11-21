import { useUiLabels } from '../lib/useUiLabels';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { Details } from './Details';
import { Icon } from './Icon';
import type { ReactNode } from 'react';
import './InlineError.css';

export interface InlineErrorProps {
  /** One human sentence: what failed and what it means. */
  children: ReactNode;
  /** The technical reason, kept one click away under「诊断」. */
  detail?: string;
  /** A recovery that acts on the cause; the button reads「重试」unless labelled. */
  onRetry?: () => void;
  retryLabel?: string;
  retryDisabled?: boolean;
  className?: string;
  id?: string;
  'data-testid'?: string;
}

/** The single error presentation: icon, sentence, optional retry, optional diagnostics. */
export function InlineError({ children, detail, onRetry, retryLabel, retryDisabled, className, id, 'data-testid': testId }: InlineErrorProps) {
  const labels = useUiLabels();
  return (
    <div className={cn('ui-inline-error', className)} role="alert" id={id} data-testid={testId}>
      <div className="ui-inline-error-line">
        <Icon name="error" size={16} className="ui-inline-error-icon" />
        <span className="ui-inline-error-message">{children}</span>
        {onRetry ? (
          <Button variant="ghost" size="sm" disabled={retryDisabled} onClick={onRetry}>{retryLabel ?? labels.retry}</Button>
        ) : null}
      </div>
      {detail ? (
        <Details className="ui-inline-error-detail" summary={labels.diagnostics}>
          <pre className="ui-inline-error-detail-text">{detail}</pre>
        </Details>
      ) : null}
    </div>
  );
}
