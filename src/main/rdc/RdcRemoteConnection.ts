import { createHash } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
import { rdcCliInvokerService } from './RdcCliInvokerService';
import { parseRdcNativeResult } from './RdcNativeProtocol';
import { parseRdcProcessIdentity } from './RdcProcessIdentity';
import { parseRemoteBootstrap } from './captures/replayDeviceParse';
import {
  deviceInstallationIdentity,
  unconfirmedDeviceAction,
  type DeviceInstallationIdentity,
} from './captures/ReplayDeviceIssue';
import type { RdcOperationFrame } from './RdcOperationWatcher';
import type { RdcTurnBinding } from './RdcTurnBindings';
import type {
  AndroidBootstrapMetadata,
  DevicePreparationPhase,
  RemoteInstallationReceipt,
  ReplayDeviceEntry,
  ReplayDeviceIssue,
} from '@shared/types/device';

/** What the owning connect reports while it runs, read from its own progress stream. */
export interface RdcRemoteProgress {
  onPreparationStage?: (stage: DevicePreparationPhase) => void;
  onInstallation?: (receipt: RemoteInstallationReceipt) => void;
  onDeviceAction?: (issue: ReplayDeviceIssue, identity?: DeviceInstallationIdentity) => void;
}
const PREPARATION_PHASES = new Set<string>(['checking', 'installing', 'starting', 'verifying']);
const INSTALL_MODES = new Set<string>(['existing', 'install', 'update', 'force_replace']);
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/**
 * Maps the connect's progress frames onto the preparation UI. Only RDC-Tool's own stages are forwarded; a cancelled
 * connect reports the facts it settled with (a committed installation, an unconfirmed PackageManager result) in its
 * final `cancelled` stage, which is never read as a rollback.
 */
function remoteConnectProgress(progress: RdcRemoteProgress): (frame: RdcOperationFrame) => void {
  return (frame) => {
    if (frame.kind !== 'progress' || frame.operation !== 'rd.remote.connect') return;
    if (PREPARATION_PHASES.has(frame.stage)) {
      progress.onPreparationStage?.(frame.stage as DevicePreparationPhase);
      return;
    }
    if (frame.stage !== 'cancelled') return;
    const deviceAction = unconfirmedDeviceAction(frame.details);
    const identity = deviceInstallationIdentity(frame.details);
    if (deviceAction)
      progress.onDeviceAction?.(
        {
          code: 'remote_install_unconfirmed',
          stage: 'installing',
          diagnostic: frame.message || 'Native PackageManager result remains unconfirmed.',
          recovery: identity ? 'retry' : null,
          deviceAction,
        },
        identity,
      );
    const receipt = record(frame.details.installation);
    if (
      typeof receipt?.installed_apk === 'boolean' &&
      typeof receipt.uninstalled_existing === 'boolean' &&
      INSTALL_MODES.has(String(receipt.install_mode))
    )
      progress.onInstallation?.({
        installedApk: receipt.installed_apk,
        uninstalledExisting: receipt.uninstalled_existing,
        installMode: receipt.install_mode as RemoteInstallationReceipt['installMode'],
      });
  };
}

export interface RdcRemoteConnection {
  deviceId: string;
  serial: string;
  contextId: string;
  remoteId: string;
  bootstrap?: AndroidBootstrapMetadata;
}
export interface RemoteInstallationInspection {
  deviceSerial: string;
  packageName: string;
  apkSha256: string;
  state: 'clear' | 'pending' | 'unknown';
  diagnostic?: string;
}
export function remotePreparationBindingIdentity(binding: RdcTurnBinding): string {
  return createHash('sha256')
    .update(JSON.stringify({ cli: binding.cli, catalog: binding.definitionsFingerprint }))
    .digest('hex');
}
export function assertRemotePreparationContract(binding: RdcTurnBinding): void {
  const definition = binding.definitions.find((value) => value.name === 'rd.remote.connect');
  const schema = definition?.input_schema as
    | {
        properties?: {
          options?: {
            properties?: {
              transport?: { enum?: string[] };
            };
          };
        };
      }
    | undefined;
  const inspection = binding.definitions.find((value) => value.name === 'rd.remote.inspect_installation');
  const inspectionSchema = inspection?.input_schema as
    { properties?: { device_serial?: { type?: string } } } | undefined;
  if (
    !schema?.properties?.options?.properties?.transport?.enum?.includes('adb_android') ||
    definition?.preparation_policy !== 'automatic'
  ) {
    throw new AppError('RDC_REMOTE_UPGRADE_REQUIRED', 'configured Tools lacks automatic Android preparation.');
  }
  if (
    inspection?.scope !== 'global' ||
    !Array.isArray(inspection.effects) ||
    inspection.effects.length !== 0 ||
    inspectionSchema?.properties?.device_serial?.type !== 'string'
  )
    throw new AppError('RDC_REMOTE_UPGRADE_REQUIRED', 'configured Tools lacks read-only installation verification.');
}

export async function inspectSessionReplayInstallation(
  device: ReplayDeviceEntry,
  contextId: string,
  binding: RdcTurnBinding,
  signal?: AbortSignal,
): Promise<RemoteInstallationInspection> {
  assertRemotePreparationContract(binding);
  if (device.type !== 'android' || !device.serial || !contextId || contextId === 'default')
    throw new AppError('RDC_REMOTE_CONTEXT_REQUIRED');
  signal?.throwIfAborted();
  const result = parseRdcNativeResult(
    await rdcCliInvokerService.executeCLI(
      'call',
      [
        'rd.remote.inspect_installation',
        '--args-json',
        JSON.stringify({ device_serial: device.serial }),
        '--daemon-context',
        contextId,
      ],
      { contextId, settings: binding.cli, abortSignal: signal },
    ),
    contextId,
    'rd.remote.inspect_installation',
  );
  signal?.throwIfAborted();
  const data = result.data;
  if (
    data.device_serial !== device.serial ||
    typeof data.package_name !== 'string' ||
    !data.package_name.trim() ||
    typeof data.apk_sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(data.apk_sha256) ||
    !Array.isArray(data.sessions) ||
    !['clear', 'pending', 'unknown'].includes(String(data.installation_state)) ||
    ({ clear: 'verified', pending: 'pending', unknown: 'unreadable' } as Record<string, string>)[
      String(data.installation_state)
    ] !== data.observation
  ) {
    throw new AppError('RDC_REMOTE_INSTALLATION_PROTOCOL', 'inspection identity or state is invalid.');
  }
  return {
    deviceSerial: data.device_serial,
    packageName: data.package_name,
    apkSha256: data.apk_sha256,
    state: data.installation_state as RemoteInstallationInspection['state'],
    ...(typeof data.diagnostic === 'string' ? { diagnostic: data.diagnostic } : {}),
  };
}

/** A connection is returned directly to its owning runtime, never to global discovery. */
export async function connectSessionReplayDevice(
  device: ReplayDeviceEntry,
  contextId: string,
  binding: RdcTurnBinding,
  signal?: AbortSignal,
  progress: RdcRemoteProgress = {},
): Promise<RdcRemoteConnection> {
  if (device.type !== 'android' || !device.serial || !contextId || contextId === 'default')
    throw new AppError('RDC_REMOTE_CONTEXT_REQUIRED');
  assertRemotePreparationContract(binding);
  if (device.adbState && device.adbState !== 'device')
    throw new Error(device.adbState === 'unauthorized' ? 'remote_unauthorized' : 'remote_device_offline');
  signal?.throwIfAborted();
  // The connection has no duration of its own: the request's no-progress budget bounds it (RDC-Tool moves the
  // deadline forward with every bootstrap stage), so the frozen CLI binding is all this call carries.
  const payload = parseRdcNativeResult(
    await rdcCliInvokerService.executeCLI(
      'call',
      [
        'rd.remote.connect',
        '--args-json',
        JSON.stringify({
          options: {
            transport: 'adb_android',
            device_serial: device.serial,
          },
        }),
        '--daemon-context',
        contextId,
      ],
      { contextId, abortSignal: signal, settings: binding.cli, onProgress: remoteConnectProgress(progress) },
    ),
    contextId,
    'rd.remote.connect',
  );
  signal?.throwIfAborted();
  const remoteId = payload.data.remote_id;
  if (typeof remoteId !== 'string' || !remoteId.trim())
    throw new AppError('RDC_CLI_PROTOCOL', 'remote_id is required.');
  return {
    deviceId: device.id,
    serial: device.serial,
    contextId,
    remoteId,
    bootstrap: parseRemoteBootstrap(payload.data),
  };
}

/** Ping lacks a context field; bind it to the same native remote and process before and after. */
export async function revalidateSessionReplayDevice(
  connection: RdcRemoteConnection,
  binding: RdcTurnBinding,
  signal?: AbortSignal,
): Promise<void> {
  const { contextId, remoteId, serial } = connection;
  const invoke = async (operation: string, args: Record<string, unknown>) => {
    signal?.throwIfAborted();
    const result = await rdcCliInvokerService.executeCLI(
      'call',
      [operation, '--args-json', JSON.stringify(args), '--daemon-context', contextId],
      { contextId, settings: binding.cli, abortSignal: signal },
    );
    signal?.throwIfAborted();
    const payload = parseRdcNativeResult(result, undefined, operation);
    if (payload.data.context_id !== undefined && payload.data.context_id !== contextId) {
      throw new AppError('RDC_CONTEXT_MISMATCH', 'native response does not belong to the owning daemon context.');
    }
    return payload;
  };
  const processOf = (payload: Awaited<ReturnType<typeof invoke>>) => {
    const process = parseRdcProcessIdentity((payload.meta as Record<string, unknown> | undefined)?.process_identity);
    if (
      payload.data.process_identity &&
      JSON.stringify(parseRdcProcessIdentity(payload.data.process_identity)) !== JSON.stringify(process)
    ) {
      throw new AppError('RDC_PROCESS_IDENTITY_MISMATCH', 'native process identities disagree.');
    }
    return JSON.stringify(process);
  };
  const readContext = async () => {
    const payload = await invoke('rd.session.get_context', {});
    const remote = payload.data.remote as Record<string, unknown> | undefined;
    if (
      payload.data.context_id !== contextId ||
      remote?.state !== 'live_handle' ||
      remote.remote_id !== remoteId ||
      remote.origin_context_id !== contextId ||
      remote.context_locality !== 'strict' ||
      remote.device_serial !== serial
    ) {
      throw new AppError(
        'RDC_REMOTE_IDENTITY_MISMATCH',
        'prepared remote is not bound to the owning context and device.',
      );
    }
    return processOf(payload);
  };
  const process = await readContext();
  const ping = await invoke('rd.remote.ping', { remote_id: remoteId });
  const detail = ping.data.detail as Record<string, unknown> | undefined;
  if (detail?.remote_id !== remoteId || detail.connected !== true) {
    throw new AppError('RDC_REMOTE_IDENTITY_MISMATCH', 'ping did not confirm the prepared remote.');
  }
  if (processOf(ping) !== process || (await readContext()) !== process) {
    throw new AppError('RDC_PROCESS_IDENTITY_MISMATCH', 'prepared remote process changed during verification.');
  }
}
