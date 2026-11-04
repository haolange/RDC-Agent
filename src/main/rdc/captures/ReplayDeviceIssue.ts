import type { DevicePreparationPhase, ReplayDeviceIssue } from '@shared/types/device';
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

export function replayDeviceIssue(error: unknown, stage: DevicePreparationPhase = 'checking'): ReplayDeviceIssue {
  const native = error instanceof RdcNativeFailure ? error.nativeError : null;
  const remote = record(native?.details?.remote);
  const deviceAction = unconfirmedDeviceAction(native?.details);
  const code = text(remote?.code) ?? native?.code ?? (error instanceof Error ? error.message.split(':', 1)[0] : 'RDC_DEVICE_PREPARATION_FAILED');
  const output = native?.details && Object.fromEntries(['command', 'returncode', 'stdout', 'stderr']
    .filter(key => native.details?.[key] !== undefined).map(key => [key, native.details![key]]));
  const diagnostic = error instanceof Error ? error.message : String(error);
  return { code, stage: stages.has(remote?.stage as DevicePreparationPhase) ? remote!.stage as DevicePreparationPhase : stage,
    diagnostic: output && Object.keys(output).length ? `${diagnostic}\n${JSON.stringify(output, null, 2)}` : diagnostic,
    recovery: deviceAction ? deviceInstallationIdentity(native?.details) ? 'retry' : null : ['android_apk_missing', 'remote_apk_missing', 'RDC_CLI_CONTRACT_INVALID', 'RDC_REMOTE_UPGRADE_REQUIRED'].includes(code) ? 'configure_tools' : 'retry',
    ...(text(remote?.expected_version) ? { expectedVersion: text(remote?.expected_version) } : {}),
    ...(text(remote?.actual_version) ? { actualVersion: text(remote?.actual_version) } : {}),
    ...(deviceAction ? { deviceAction } : {}) };
}
