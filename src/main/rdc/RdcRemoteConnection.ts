import { createHash } from 'node:crypto';
import { rdcCliInvokerService } from './RdcCliInvokerService';
import { parseRdcNativeResult } from './RdcNativeProtocol';
import { parseRdcProcessIdentity } from './RdcProcessIdentity';
import { parseRemoteBootstrap } from './captures/replayDeviceParse';
import type { RdcTurnBinding } from './RdcTurnBindings';
import type { ReplayDeviceEntry, AndroidBootstrapMetadata } from '@shared/types/device';

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
export function assertRemotePreparationContract(binding: RdcTurnBinding): void {
  const definition = binding.definitions.find(value => value.name === 'rd.remote.connect');
  const schema = definition?.input_schema as { properties?: { options?: { properties?: {
    transport?: { enum?: string[] };
  } }; timeout_ms?: { type?: string } } } | undefined;
  const inspection = binding.definitions.find(value => value.name === 'rd.remote.inspect_installation');
  const inspectionSchema = inspection?.input_schema as { properties?: { device_serial?: { type?: string } } } | undefined;
  const policy = definition?.timeout_policy as Record<string, unknown> | undefined;
  if (!schema?.properties?.options?.properties?.transport?.enum?.includes('adb_android')
    || definition?.preparation_policy !== 'automatic') {
    throw new Error('RDC_REMOTE_UPGRADE_REQUIRED: configured Tools lacks automatic Android preparation.');
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
  binding: RdcTurnBinding, signal?: AbortSignal): Promise<RdcRemoteConnection> {
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
    } }), '--daemon-context', contextId,
  ], { contextId, abortSignal: signal, settings: binding.cli, timeout: processTimeout }), contextId, 'rd.remote.connect');
  signal?.throwIfAborted();
  const remoteId = payload.data.remote_id;
  if (typeof remoteId !== 'string' || !remoteId.trim()) throw new Error('RDC_CLI_PROTOCOL: remote_id is required.');
  return { deviceId: device.id, serial: device.serial, contextId, remoteId, bootstrap: parseRemoteBootstrap(payload.data) };
}

/** Ping lacks a context field; bind it to the same native remote and process before and after. */
export async function revalidateSessionReplayDevice(connection: RdcRemoteConnection,
  binding: RdcTurnBinding, signal?: AbortSignal): Promise<void> {
  const { contextId, remoteId, serial } = connection;
  const invoke = async (operation: string, args: Record<string, unknown>) => {
    signal?.throwIfAborted();
    const result = await rdcCliInvokerService.executeCLI('call', [
      operation, '--args-json', JSON.stringify(args), '--daemon-context', contextId,
    ], { contextId, settings: binding.cli, abortSignal: signal });
    signal?.throwIfAborted();
    const payload = parseRdcNativeResult(result, undefined, operation);
    if (payload.data.context_id !== undefined && payload.data.context_id !== contextId) {
      throw new Error('RDC_CONTEXT_MISMATCH: native response does not belong to the owning daemon context.');
    }
    return payload;
  };
  const processOf = (payload: Awaited<ReturnType<typeof invoke>>) => {
    const process = parseRdcProcessIdentity((payload.meta as Record<string, unknown> | undefined)?.process_identity);
    if (payload.data.process_identity && JSON.stringify(parseRdcProcessIdentity(payload.data.process_identity)) !== JSON.stringify(process)) {
      throw new Error('RDC_PROCESS_IDENTITY_MISMATCH: native process identities disagree.');
    }
    return JSON.stringify(process);
  };
  const readContext = async () => {
    const payload = await invoke('rd.session.get_context', {});
    const remote = payload.data.remote as Record<string, unknown> | undefined;
    if (payload.data.context_id !== contextId || remote?.state !== 'live_handle' || remote.remote_id !== remoteId
      || remote.origin_context_id !== contextId || remote.context_locality !== 'strict' || remote.device_serial !== serial) {
      throw new Error('RDC_REMOTE_IDENTITY_MISMATCH: prepared remote is not bound to the owning context and device.');
    }
    return processOf(payload);
  };
  const process = await readContext();
  const ping = await invoke('rd.remote.ping', { remote_id: remoteId });
  const detail = ping.data.detail as Record<string, unknown> | undefined;
  if (detail?.remote_id !== remoteId || detail.connected !== true) {
    throw new Error('RDC_REMOTE_IDENTITY_MISMATCH: ping did not confirm the prepared remote.');
  }
  if (processOf(ping) !== process || await readContext() !== process) {
    throw new Error('RDC_PROCESS_IDENTITY_MISMATCH: prepared remote process changed during verification.');
  }
}
