import type { DevicePreparationPhase, RemoteInstallationReceipt, ReplayDeviceIssue } from '@shared/types/device';
import type { RdcCliInvokerSettings } from '@shared/types/settings';
import { rdcCliInvokerService } from '../tools/RdcCliInvokerService';
import { parseRdcNativeResult } from '../tools/RdcNativeProtocol';
import { unconfirmedDeviceAction, deviceInstallationIdentity, type DeviceInstallationIdentity } from '../captures/ReplayDeviceIssue';

export interface RdcRemoteProgress {
  onPreparationStage?: (stage: DevicePreparationPhase) => void;
  onInstallation?: (receipt: RemoteInstallationReceipt) => void;
  onDeviceAction?: (issue: ReplayDeviceIssue, identity?: DeviceInstallationIdentity) => void;
}
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const phases = new Set(['checking', 'installing', 'starting', 'verifying']);

/** Poll the existing owning daemon status; never synthesize an installation stage. */
export async function withRdcRemoteProgress<T>(contextId: string, cli: RdcCliInvokerSettings,
  signal: AbortSignal | undefined, progress: RdcRemoteProgress, operation: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  let traceId: string | undefined;
  const poll = async () => {
    while (!finished && !signal?.aborted && progress.onPreparationStage) {
      try {
        const result = parseRdcNativeResult(await rdcCliInvokerService.executeCLI('daemon', ['status', '--daemon-context', contextId], {
          contextId, timeout: 5000, settings: cli,
        }));
        const state = record(result.data.state); const active = record(state?.active_operation);
        if (!finished && !signal?.aborted && result.result_kind === 'rdc_tool.daemon.status' && state?.context_id === contextId
          && active?.operation === 'rd.remote.connect' && typeof active.started_at_ms === 'number' && active.started_at_ms >= startedAt
          && typeof active.trace_id === 'string' && active.trace_id.trim().length > 0 && (!traceId || active.trace_id === traceId)) {
          traceId = active.trace_id;
          if (phases.has(String(active.stage))) progress.onPreparationStage?.(active.stage as DevicePreparationPhase);
        }
      } catch { /* The connect result remains authoritative when status is unavailable. */ }
      if (!finished && !signal?.aborted) await new Promise<void>(resolve => { wake = resolve; timer = setTimeout(resolve, 250); });
    }
  };
  const polling = poll();
  try { return await operation(); }
  finally {
    finished = true; if (timer) clearTimeout(timer); wake?.(); await polling;
    // The native action has joined. Preserve any committed installation before its context is released.
    if (signal?.aborted && (progress.onInstallation || progress.onDeviceAction)) {
      try {
        const result = parseRdcNativeResult(await rdcCliInvokerService.executeCLI('call', [
          'rd.core.get_operation_history', '--args-json', JSON.stringify({ operation: 'rd.remote.connect', since_ms: startedAt, max_items: 8 }),
          '--daemon-context', contextId,
        ], { contextId, timeout: 5000, settings: cli }), contextId, 'rd.core.get_operation_history');
        const operations = result.data.operations;
        if (Array.isArray(operations)) for (const value of operations) {
          const entry = record(value);
          if (entry?.operation !== 'rd.remote.connect' || typeof entry.started_at_ms !== 'number' || entry.started_at_ms < startedAt
            || typeof entry.trace_id !== 'string' || !entry.trace_id.trim() || (traceId && entry.trace_id !== traceId) || !Array.isArray(entry.stages)) continue;
          const stage = record(entry.stages.at(-1)); const details = record(stage?.details); const receipt = record(details?.installation);
          if (stage?.stage !== 'cancelled') continue;
          const deviceAction = unconfirmedDeviceAction(details ?? undefined);
          const identity = deviceInstallationIdentity(details ?? undefined);
          if (deviceAction) progress.onDeviceAction?.({ code: 'remote_install_unconfirmed', stage: 'installing',
            diagnostic: typeof stage?.message === 'string' ? stage.message : 'Native PackageManager result remains unconfirmed.',
            recovery: identity ? 'verify_installation' : null, deviceAction }, identity);
          if (typeof receipt?.installed_apk !== 'boolean' || typeof receipt.uninstalled_existing !== 'boolean'
            || !['existing', 'install', 'update', 'force_replace'].includes(String(receipt.install_mode))) continue;
          progress.onInstallation?.({ installedApk: receipt.installed_apk, uninstalledExisting: receipt.uninstalled_existing,
            installMode: receipt.install_mode as RemoteInstallationReceipt['installMode'] });
          break;
        }
      } catch { /* Absence of a receipt is unknown, never a rollback claim. */ }
    }
  }
}
