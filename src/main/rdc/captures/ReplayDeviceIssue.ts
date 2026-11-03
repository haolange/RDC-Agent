import type { DevicePreparationPhase, ReplayDeviceIssue, RemoteRepairAssessment } from '@shared/types/device';
import { RdcNativeFailure } from '../RdcNativeProtocol';

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown) => typeof value === 'string' ? value : undefined;
const stages = new Set<DevicePreparationPhase>(['checking', 'installing', 'starting', 'verifying']);
export function unconfirmedDeviceAction(details: Record<string, unknown> | undefined): ReplayDeviceIssue['deviceAction'] {
  const action = record(details?.device_action); const installation = record(details?.installation);
  return action?.kind === 'android_install' && action.state === 'unconfirmed'
    ? { kind: 'package_install', outcome: 'unconfirmed', uninstalledExisting: installation?.uninstalled_existing === true } : undefined;
}
export interface DeviceInstallationIdentity { deviceSerial: string; packageName: string; apkSha256: string }
export function deviceInstallationIdentity(details: Record<string, unknown> | undefined): DeviceInstallationIdentity | undefined {
  const action = record(details?.device_action);
  return action?.kind === 'android_install' && action.state === 'unconfirmed' && typeof action.device_serial === 'string'
    && Boolean(action.device_serial.trim()) && typeof action.package_name === 'string' && Boolean(action.package_name.trim())
    && typeof action.apk_sha256 === 'string' && /^[a-f0-9]{64}$/.test(action.apk_sha256)
    ? { deviceSerial: action.device_serial, packageName: action.package_name, apkSha256: action.apk_sha256 } : undefined;
}

function repairAssessment(value: unknown): RemoteRepairAssessment | undefined {
  const item = record(value);
  if (!item || typeof item.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(item.fingerprint)
    || !Array.isArray(item.actions) || !item.actions.length
    || !item.actions.every(action => ['restart_helper', 'reinstall_helper', 'downgrade_helper'].includes(String(action)))
    || !['package_name', 'device_serial', 'apk_sha256', 'installed_identity'].every(key => typeof item[key] === 'string')
    || !Array.isArray(item.service_identity) || !item.service_identity.every(value => typeof value === 'string')) return undefined;
  return { fingerprint: item.fingerprint, actions: item.actions as RemoteRepairAssessment['actions'],
    packageName: String(item.package_name), deviceSerial: String(item.device_serial), apkSha256: String(item.apk_sha256),
    installedIdentity: String(item.installed_identity), serviceIdentity: item.service_identity as string[] };
}

export function replayDeviceIssue(error: unknown, stage: DevicePreparationPhase = 'checking'): ReplayDeviceIssue {
  const native = error instanceof RdcNativeFailure ? error.nativeError : null;
  const remote = record(native?.details?.remote);
  const deviceAction = unconfirmedDeviceAction(native?.details);
  const code = text(remote?.code) ?? native?.code ?? (error instanceof Error ? error.message.split(':', 1)[0] : 'RDC_DEVICE_PREPARATION_FAILED');
  const repair = repairAssessment(remote?.repair);
  return { code, stage: stages.has(remote?.stage as DevicePreparationPhase) ? remote!.stage as DevicePreparationPhase : stage,
    diagnostic: error instanceof Error ? error.message : String(error),
    recovery: deviceAction ? deviceInstallationIdentity(native?.details) ? 'verify_installation' : null : repair ? 'repair' : ['android_apk_missing', 'remote_apk_missing', 'RDC_CLI_CONTRACT_INVALID', 'RDC_REMOTE_UPGRADE_REQUIRED'].includes(code) ? 'configure_tools' : 'retry',
    ...(text(remote?.expected_version) ? { expectedVersion: text(remote?.expected_version) } : {}),
    ...(text(remote?.actual_version) ? { actualVersion: text(remote?.actual_version) } : {}),
    ...(repair && !deviceAction ? { repair } : {}), ...(deviceAction ? { deviceAction } : {}) };
}
