import { useEffect, useState } from 'react';
import { Icon } from '../../../../ui/Icon';
import { InlineError } from '../../../../ui/InlineError';
import { Spinner } from '../../../../ui/Spinner';
import type { SettingsAutosaveStatus } from './useSettingsAutosave';

const SAVED_MARK_MS = 1600;

/**
 * Autosave feedback without a sentence: a spinner while saving, a check that fades after a moment once saved, and a
 * one-line error when the save failed.
 */
export function SettingsSaveMark({
  status,
  savingLabel,
  savedLabel,
  errorLabel,
  errorDetail,
  onRetry,
  retryLabel,
  testId,
}: {
  status: SettingsAutosaveStatus;
  savingLabel: string;
  savedLabel: string;
  errorLabel: string;
  /** The technical reason a save failed, kept under 诊断. */
  errorDetail?: string;
  /** Saves again; absent when retrying cannot help (the draft itself is invalid). */
  onRetry?: () => void;
  retryLabel?: string;
  testId?: string;
}) {
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (status !== 'saved') return undefined;
    setShowSaved(true);
    const timer = window.setTimeout(() => setShowSaved(false), SAVED_MARK_MS);
    return () => window.clearTimeout(timer);
  }, [status]);
  if (status === 'error') {
    return (
      <InlineError
        className="settings-save-error"
        detail={errorDetail}
        onRetry={onRetry}
        retryLabel={retryLabel}
        data-testid={testId}
      >
        {errorLabel}
      </InlineError>
    );
  }
  return (
    <span
      className="settings-save-mark"
      role="status"
      data-testid={testId}
      aria-label={status === 'saving' ? savingLabel : showSaved ? savedLabel : undefined}
    >
      {status === 'saving' ? <Spinner size="sm" /> : null}
      <Icon
        name="check"
        size={16}
        className={`settings-save-mark-check${showSaved && status === 'saved' ? ' is-visible' : ''}`}
      />
    </span>
  );
}
