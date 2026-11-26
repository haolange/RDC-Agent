import { Button } from '../../ui/Button';
import { FailureAlert } from '../../patterns/FailureAlert';
import { useI18n } from '../../i18n';
import type { CaptureRecoveryStatus } from '@shared/types/captureReplay';

/** Offers to reopen the capture this session had before; names it only when it differs from the current choice. */
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
  const original = status?.original;
  return (
    <>
      {status && (
        <div className="capture-replay-callout is-warning" aria-live="polite">
          <div className="capture-replay-callout-copy">
            <strong>{t(locked ? 'control.replay.recoveryOwned' : 'control.replay.recoveryPending')}</strong>
            {showTarget && original ? (
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
            data-tooltip={t('control.replay.recoveryDescription')}
            onClick={onRestore}
          >
            {t('control.replay.recoveryAction')}
          </Button>
        </div>
      )}
      {error && <FailureAlert reason={error.reason} contextKey="control.replay.recoveryFailed" />}
    </>
  );
}
