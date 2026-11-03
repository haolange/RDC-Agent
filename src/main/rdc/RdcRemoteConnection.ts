import type { ReplayDeviceEntry, AndroidBootstrapMetadata } from '@shared/types/device';
import type { RdcTurnBinding } from './RdcTurnBindings';
import { rdcCliInvokerService } from './RdcCliInvokerService';
import { parseRdcNativeResult } from './RdcNativeProtocol';
import { parseRemoteBootstrap } from './captures/replayDeviceParse';
import { createHash } from 'node:crypto';
import { settingsService } from '../settings/settings-core/SettingsService';
import { withRdcHostRuntimeEnv } from './withRdcHostRuntimeEnv';
import { freezeRdcTurnBinding } from './RdcTurnBindings';

export interface RdcRemoteConnection {
  deviceId: string;
  serial: string;
  contextId: string;
  remoteId: string;
  bootstrap?: AndroidBootstrapMetadata;
}
export interface RemoteInstallationInspection {
  deviceSerial: string; packageName: string; apkSha256: string;
  state: 'clear' | 'pending' | 'unknown'; diagnostic?: string;
}
export function remotePreparationBindingIdentity(binding: RdcTurnBinding): string {
  return createHash('sha256').update(JSON.stringify({ cli: binding.cli, catalog: binding.definitionsFingerprint })).digest('hex');
}
export async function configuredRemotePreparationIdentity(): Promise<string> {
  const cli = withRdcHostRuntimeEnv(structuredClone(settingsService.getAll().tooling.rdcCli));
  const catalog = await rdcCliInvokerService.loadCatalog(cli);
  return remotePreparationBindingIdentity(freezeRdcTurnBinding(cli, catalog.tools));
}

export function assertRemotePreparationContract(binding: RdcTurnBinding): void {
  const definition = binding.definitions.find(value => value.name === 'rd.remote.connect');
  const schema = definition?.input_schema as { properties?: { options?: { properties?: {
    repair_policy?: { enum?: string[] }; repair_confirmation?: { properties?: { fingerprint?: { type?: string } } };
  } }; timeout_ms?: { type?: string } } } | undefined;
  const options = schema?.properties?.options?.properties;
  const inspection = binding.definitions.find(value => value.name === 'rd.remote.inspect_installation');
  const inspectionSchema = inspection?.input_schema as { properties?: { device_serial?: { type?: string } } } | undefined;
  const policy = definition?.timeout_policy as Record<string, unknown> | undefined;
  if (!options?.repair_policy?.enum?.includes('auto_safe') || !options.repair_policy.enum.includes('confirmed')
    || options.repair_confirmation?.properties?.fingerprint?.type !== 'string') {
    throw new Error('RDC_REMOTE_UPGRADE_REQUIRED: configured Tools lacks the remote preparation and repair contract.');
  }
  if (schema?.properties?.timeout_ms?.type !== 'integer' || policy?.argument !== 'timeout_ms' || !['default_timeout_ms', 'worker_grace_ms', 'transport_grace_ms', 'process_grace_ms']
    .every(key => Number.isSafeInteger(policy[key]) && Number(policy[key]) > 0)) {
    throw new Error('RDC_REMOTE_UPGRADE_REQUIRED: configured Tools lacks the canonical remote timeout policy.');
  }
  if (inspection?.scope !== 'global' || !Array.isArray(inspection.effects) || inspection.effects.length !== 0
    || inspectionSchema?.properties?.device_serial?.type !== 'string') throw new Error('RDC_REMOTE_UPGRADE_REQUIRED: configured Tools lacks read-only installation verification.');
}

export async function inspectSessionReplayInstallation(device: ReplayDeviceEntry, contextId: string,
  binding: RdcTurnBinding, signal?: AbortSignal): Promise<RemoteInstallationInspection> {
  assertRemotePreparationContract(binding);
  if (device.type !== 'android' || !device.serial || !contextId || contextId === 'default') throw new Error('RDC_REMOTE_CONTEXT_REQUIRED');
  signal?.throwIfAborted();
  const result = parseRdcNativeResult(await rdcCliInvokerService.executeCLI('call', [
    'rd.remote.inspect_installation', '--args-json', JSON.stringify({ device_serial: device.serial }), '--daemon-context', contextId,
  ], { contextId, settings: binding.cli, abortSignal: signal }), contextId, 'rd.remote.inspect_installation');
  signal?.throwIfAborted(); const data = result.data;
  if (data.device_serial !== device.serial || typeof data.package_name !== 'string' || !data.package_name.trim()
    || typeof data.apk_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.apk_sha256)
    || !Array.isArray(data.sessions)
    || !['clear', 'pending', 'unknown'].includes(String(data.installation_state))
    || ({ clear: 'verified', pending: 'pending', unknown: 'unreadable' } as Record<string, string>)[String(data.installation_state)] !== data.observation) {
    throw new Error('RDC_REMOTE_INSTALLATION_PROTOCOL: inspection identity or state is invalid.');
  }
  return { deviceSerial: data.device_serial, packageName: data.package_name, apkSha256: data.apk_sha256,
    state: data.installation_state as RemoteInstallationInspection['state'], ...(typeof data.diagnostic === 'string' ? { diagnostic: data.diagnostic } : {}) };
}

/** A connection is returned directly to its owning runtime, never to global discovery. */
export async function connectSessionReplayDevice(device: ReplayDeviceEntry, contextId: string,
  binding: RdcTurnBinding, signal?: AbortSignal, repairFingerprint?: string): Promise<RdcRemoteConnection> {
  if (device.type !== 'android' || !device.serial || !contextId || contextId === 'default') throw new Error('RDC_REMOTE_CONTEXT_REQUIRED');
  assertRemotePreparationContract(binding);
  if (device.adbState && device.adbState !== 'device') throw new Error(device.adbState === 'unauthorized' ? 'remote_unauthorized' : 'remote_device_offline');
  signal?.throwIfAborted();
  const policy = binding.definitions.find(value => value.name === 'rd.remote.connect')!.timeout_policy as Record<string, number>;
  const timeoutMs = binding.cli.timeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('RDC_REMOTE_TIMEOUT_INVALID');
  const processTimeout = Math.ceil(timeoutMs / 1000) * 1000 + policy.worker_grace_ms + policy.transport_grace_ms + policy.process_grace_ms;
  if (!Number.isSafeInteger(processTimeout)) throw new Error('RDC_REMOTE_TIMEOUT_INVALID');
  const payload = parseRdcNativeResult(await rdcCliInvokerService.executeCLI('call', [
    'rd.remote.connect', '--args-json', JSON.stringify({ timeout_ms: timeoutMs, options: {
      transport: 'adb_android', device_serial: device.serial,
      repair_policy: repairFingerprint ? 'confirmed' : 'auto_safe',
      ...(repairFingerprint ? { repair_confirmation: { fingerprint: repairFingerprint } } : {}),
    } }), '--daemon-context', contextId,
  ], { contextId, abortSignal: signal, settings: binding.cli, timeout: processTimeout }), contextId, 'rd.remote.connect');
  signal?.throwIfAborted();
  const remoteId = payload.data.remote_id;
  if (typeof remoteId !== 'string' || !remoteId.trim()) throw new Error('RDC_CLI_PROTOCOL: remote_id is required.');
  return { deviceId: device.id, serial: device.serial, contextId, remoteId, bootstrap: parseRemoteBootstrap(payload.data) };
}
