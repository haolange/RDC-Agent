import { Button } from '../../ui/Button';
import { FailureAlert } from '../../patterns/FailureAlert';
import { useI18n } from '../../i18n';
import type { CaptureRecoveryStatus } from '@shared/types/captureReplay';

/**
 * Offers to recover the session's replay: return to the position an investigation left (naming its capture only when
 * it differs from the current choice), or rebuild a replay that failed with no such position to return to.
 */
export function CaptureRecoveryCallout({
  status,
  error,
  locked,
  disabled,
  restoring,
  showTarget,
  deviceLabel,
  onRestore,
}: {
  status: CaptureRecoveryStatus | null;
  error: { reason: unknown } | null;
  locked: boolean;
  disabled: boolean;
  restoring: boolean;
  showTarget: boolean;
  deviceLabel: (deviceId: string) => string;
  onRestore: () => void;
}) {
  const { t } = useI18n();
  const rebuild = status?.kind === 'rebuild';
  const original = status?.kind === 'restore' ? status.original : null;
  return (
    <>
      {status && (
        <div className="capture-replay-callout is-warning" aria-live="polite">
          <div className="capture-replay-callout-copy">
            <strong>
              {t(
                rebuild
                  ? locked
                    ? 'control.replay.rebuildOwned'
                    : 'control.replay.rebuildPending'
                  : locked
                    ? 'control.replay.recoveryOwned'
                    : 'control.replay.recoveryPending',
              )}
            </strong>
            {rebuild ? (
              <small>{t('control.replay.rebuildDescription')}</small>
            ) : showTarget && original ? (
              <small>
                {original.fileName} · {deviceLabel(original.deviceId)}
              </small>
            ) : !original ? (
              <small>{t('control.replay.recoveryNoCapture')}</small>
            ) : null}
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled}
            aria-busy={restoring}
            data-tooltip={rebuild ? undefined : t('control.replay.recoveryDescription')}
            onClick={onRestore}
          >
            {t(rebuild ? 'control.replay.rebuildAction' : 'control.replay.recoveryAction')}
          </Button>
        </div>
      )}
      {error && <FailureAlert reason={error.reason} contextKey="control.replay.recoveryFailed" />}
    </>
  );
}
