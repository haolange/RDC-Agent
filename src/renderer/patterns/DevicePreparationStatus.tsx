import type { ReplayDeviceIssue, SessionDevicePreparation } from '@shared/types/device';
import { useRef, useState } from 'react';
import { useI18n } from '../i18n';
import type { TranslationKey } from '../i18n';
import { Button } from '../ui/Button';
import { Details } from '../ui/Details';
import './DevicePreparationStatus.css';

const PHASE_KEYS: Record<SessionDevicePreparation['phase'], TranslationKey> = {
  idle: 'device.prepare.idle', checking: 'device.prepare.checking', installing: 'device.prepare.installing',
  starting: 'device.prepare.starting', verifying: 'device.prepare.verifying', ready: 'device.prepare.ready',
  needs_action: 'device.prepare.needsAction', failed: 'device.prepare.failed', cancelled: 'device.prepare.cancelled',
};
export const isDevicePreparing = (phase: SessionDevicePreparation['phase']) => ['checking', 'installing', 'starting', 'verifying'].includes(phase);
export const isDeviceInstallationUnconfirmed = (preparation: SessionDevicePreparation | null | undefined) => preparation?.issue?.deviceAction?.outcome === 'unconfirmed';
const ISSUE_KEYS: Record<string, TranslationKey> = {
  remote_busy: 'device.issue.busy', remote_version_mismatch: 'device.issue.version',
  remote_repair_required: 'device.issue.repair', remote_repair_state_changed: 'device.issue.changed',
  remote_connect_timeout: 'device.issue.timeout', android_apk_missing: 'device.issue.apkMissing',
  android_apk_invalid: 'device.issue.apkInvalid', android_apk_install_failed: 'device.issue.installFailed',
  android_apk_uninstall_failed: 'device.issue.installFailed', android_cleanup_failed: 'device.issue.cleanup',
  android_helper_state_unknown: 'device.issue.unknownHelper', android_package_probe_failed: 'device.issue.unknownHelper',
  android_remote_launch_failed: 'device.issue.launchFailed', android_abi_unsupported: 'device.issue.abi',
  android_abi_unknown: 'device.issue.abi', adb_unavailable: 'device.issue.adb',
  adb_device_unavailable: 'device.issue.deviceUnavailable', adb_device_not_found: 'device.issue.deviceUnavailable',
  adb_device_query_failed: 'device.issue.deviceUnavailable', adb_device_invalid_response: 'device.issue.deviceUnavailable',
  remote_install_unconfirmed: 'device.issue.installUnconfirmed', RDC_DEVICE_ACTION_UNCONFIRMED: 'device.issue.installUnconfirmed',
};

export function DevicePreparationStatus({ preparation, issue: actionIssue, transportError, hasCapture, disabled, onRetry, onCancel }: {
  preparation: SessionDevicePreparation | null;
  issue?: ReplayDeviceIssue | null;
  transportError?: string | null;
  hasCapture?: boolean;
  disabled?: boolean;
  onRetry: () => void;
  onCancel: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const cancelPendingRef = useRef(false);
  const [cancelPending, setCancelPending] = useState(false);
  if (!preparation && !transportError && !actionIssue) return null;
  const issue = isDeviceInstallationUnconfirmed(preparation) ? preparation?.issue : actionIssue ?? preparation?.issue;
  const busy = preparation ? isDevicePreparing(preparation.phase) : false;
  const installUnconfirmed = isDeviceInstallationUnconfirmed(preparation) || issue?.deviceAction?.outcome === 'unconfirmed';
  const diagnostic = issue?.diagnostic || transportError;
  const disconnect = !hasCapture && preparation?.phase === 'ready' && preparation.targetDeviceId !== 'local';
  const canRetry = issue?.recovery === 'retry' || issue?.recovery === 'repair' || preparation?.phase === 'cancelled' || transportError;
  const actionLabel: TranslationKey | null = installUnconfirmed
    ? issue?.recovery === 'verify_installation' ? 'device.prepare.verifyInstallation' : null
    : busy ? 'device.prepare.cancel' : disconnect ? 'device.prepare.disconnect'
      : canRetry ? issue?.recovery === 'repair' ? 'device.prepare.repair' : 'device.prepare.retry' : null;
  const actionPending = cancelPending || (installUnconfirmed && busy);
  const runAction = async () => {
    if (disabled || actionPending || cancelPendingRef.current) return;
    if (installUnconfirmed || (!busy && !disconnect)) { onRetry(); return; }
    cancelPendingRef.current = true; setCancelPending(true);
    try { await onCancel(); }
    finally { cancelPendingRef.current = false; setCancelPending(false); }
  };
  return <section className="device-preparation-status" aria-label={t('device.prepare.title')} aria-busy={busy || cancelPending}>
    <p role="status" className={issue || transportError ? 'device-preparation-heading is-error' : 'device-preparation-heading'}>
      {t(issue ? ISSUE_KEYS[issue.code] ?? 'device.prepare.failed' : transportError ? 'device.prepare.failed'
        : preparation?.phase === 'ready' && hasCapture ? 'device.prepare.connected' : PHASE_KEYS[preparation!.phase])}
    </p>
    {installUnconfirmed && <p>{t('device.prepare.installUnconfirmed')}</p>}
    {installUnconfirmed && issue?.deviceAction?.uninstalledExisting && <p>{t('device.prepare.previousHelperRemoved')}</p>}
    {!installUnconfirmed && preparation?.phase === 'cancelled' && preparation.installation?.installedApk &&
      <p>{t('device.prepare.installedBeforeCancel')}</p>}
    {issue?.expectedVersion && <p>{t('device.prepare.expectedVersion', { version: issue.expectedVersion })}</p>}
    {issue?.actualVersion && <p>{t('device.prepare.actualVersion', { version: issue.actualVersion })}</p>}
    {diagnostic && <Details summary={t('device.prepare.details')}><pre className="device-preparation-diagnostic">{diagnostic}</pre></Details>}
    <div className="device-preparation-actions">
      {actionLabel && <Button variant="secondary" size="sm" className={actionPending || disabled ? 'is-disabled' : undefined}
        aria-busy={actionPending} aria-disabled={actionPending || disabled} onClick={() => { void runAction(); }}>{t(actionLabel)}</Button>}
      {issue?.recovery === 'configure_tools' && <p>{t('device.prepare.configureTools')}</p>}
    </div>
  </section>;
}
