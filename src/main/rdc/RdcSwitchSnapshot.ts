import type { CLIResult } from '@shared/types/tool';
import type { RdcContextLease } from './RdcRuntimeContextRegistry';
import { assertRdcContextLeaseOwnership, getDelegatedChildSessionId, getRdcContextLease } from './RdcRuntimeContextRegistry';
import { parseRdcNativeResult, type RdcNativeEnvelope } from './RdcNativeProtocol';
import { parseRdcProcessIdentity, type RdcProcessIdentity } from './RdcProcessIdentity';
import { runRdcOperation } from './RdcOperationCoordinator';
import { rdcCliInvokerService } from './RdcCliInvokerService';
import type { RdcTurnBinding } from './RdcTurnBindings';
import { createHash } from 'node:crypto';
import { canonicalJson } from './RdcOperationCatalog';

export interface RdcSwitchSnapshot {
  contextId: string;
  leaseVersion: number;
  replaySessionId: string;
  captureFileId: string;
  eventId: number;
  processIdentity: RdcProcessIdentity;
  replacementCount: number;
  replacementFingerprint: string;
}

/** Validate native identity and replacement enumeration, not merely UI projection. */
export function validateRdcSwitchSnapshot(payload: RdcNativeEnvelope, lease: RdcContextLease): RdcSwitchSnapshot {
  const runtime = payload.data.runtime as Record<string, unknown> | undefined;
  const sessions = payload.data.sessions;
  const replaySessionId = lease.runtimeContext.replaySessionId;
  const captureFileId = lease.runtimeContext.captureFileId;
  const session = Array.isArray(sessions) ? sessions.find(value => value && typeof value === 'object'
    && (value as Record<string, unknown>).session_id === replaySessionId) as Record<string, unknown> | undefined : undefined;
  if (!replaySessionId || !captureFileId || payload.data.context_id !== lease.contextId
    || payload.data.current_session_id !== replaySessionId || runtime?.session_id !== replaySessionId
    || runtime.capture_file_id !== captureFileId || session?.capture_file_id !== captureFileId
    || !Number.isSafeInteger(runtime.active_event_id) || Number(runtime.active_event_id) < 0
    || !Array.isArray(session.shader_replacements) || session.shader_replacements.some((value: unknown) => !value || typeof value !== 'object'
      || typeof (value as Record<string, unknown>).replacement_id !== 'string' || !(value as Record<string, unknown>).replacement_id)) {
    throw new Error('RDC_SWITCH_IDENTITY_INVALID: the native replay, capture, position or replacement enumeration is unavailable.');
  }
  const processIdentity = parseRdcProcessIdentity((payload.meta as Record<string, unknown> | undefined)?.process_identity);
  if (payload.data.process_identity && JSON.stringify(parseRdcProcessIdentity(payload.data.process_identity)) !== JSON.stringify(processIdentity)) {
    throw new Error('RDC_SWITCH_PROCESS_CHANGED: native process identities disagree.');
  }
  return { contextId: lease.contextId, leaseVersion: lease.version, replaySessionId, captureFileId,
    eventId: Number(runtime.active_event_id), processIdentity, replacementCount: session.shader_replacements.length,
    replacementFingerprint: createHash('sha256').update(canonicalJson(session.shader_replacements)).digest('hex') };
}

export async function readRdcSwitchSnapshot(input: {
  sessionId: string; projectId: string; binding: RdcTurnBinding; signal?: AbortSignal;
  execute?: (binding: RdcTurnBinding, contextId: string, signal?: AbortSignal) => Promise<CLIResult>;
}): Promise<RdcSwitchSnapshot> {
  const lease = assertRdcContextLeaseOwnership({ sessionId: input.sessionId, projectId: input.projectId });
  const identity = input.binding.identity;
  if (!lease || !identity || lease.delegatedFrom || identity.ownerSessionId !== input.sessionId
    || identity.contextId !== lease.contextId || identity.version !== lease.version
    || identity.runtimeContext?.captureFileId !== lease.runtimeContext.captureFileId
    || identity.runtimeContext?.replaySessionId !== lease.runtimeContext.replaySessionId) {
    throw new Error('RDC_SWITCH_BINDING_CHANGED: the prepared replay binding is no longer owned.');
  }
  return runRdcOperation(lease.contextId, async () => {
    input.signal?.throwIfAborted();
    const result = await (input.execute ?? ((binding, contextId, signal) => rdcCliInvokerService.executeCLI('call',
      ['rd.session.get_context', '--args-json', '{}', '--daemon-context', contextId],
      { contextId, settings: binding.cli, abortSignal: signal })))(input.binding, lease.contextId, input.signal);
    const payload = parseRdcNativeResult(result, lease.contextId, 'rd.session.get_context');
    input.signal?.throwIfAborted();
    const current = assertRdcContextLeaseOwnership({ sessionId: input.sessionId, projectId: input.projectId });
    if (!current || current.version !== lease.version || current.contextId !== lease.contextId) {
      throw new Error('RDC_SWITCH_BINDING_CHANGED: the replay changed during observation.');
    }
    return validateRdcSwitchSnapshot(payload, current);
  });
}

/** A quarantined lease may only be observed for recovery, never used for ordinary tools. */
export async function readRdcRecoverySnapshot(input: {
  sessionId: string; projectId: string; binding: RdcTurnBinding; signal?: AbortSignal;
  execute?: (binding: RdcTurnBinding, contextId: string, signal?: AbortSignal) => Promise<CLIResult>;
}): Promise<RdcSwitchSnapshot> {
  const check = (): RdcContextLease => {
    const lease = getRdcContextLease(input.sessionId); const identity = input.binding.identity;
    if (!lease?.quarantineReason || !lease.quarantineCause || lease.delegatedFrom || getDelegatedChildSessionId(input.sessionId)
      || lease.ownerSessionId !== input.sessionId || lease.ownerProjectId !== input.projectId || !identity
      || identity.ownerSessionId !== input.sessionId || identity.contextId !== lease.contextId || identity.version !== lease.version
      || identity.runtimeContext?.captureFileId !== lease.runtimeContext.captureFileId
      || identity.runtimeContext?.replaySessionId !== lease.runtimeContext.replaySessionId) {
      throw new Error('RDC_RECOVERY_IDENTITY_UNVERIFIED: the quarantined owning binding and native failure are required.');
    }
    return lease;
  };
  const lease = check();
  return runRdcOperation(lease.contextId, async () => {
    input.signal?.throwIfAborted();
    const result = await (input.execute ?? ((binding, contextId, signal) => rdcCliInvokerService.executeCLI('call',
      ['rd.session.get_context', '--args-json', '{}', '--daemon-context', contextId],
      { contextId, settings: binding.cli, abortSignal: signal })))(input.binding, lease.contextId, input.signal);
    const payload = parseRdcNativeResult(result, lease.contextId, 'rd.session.get_context');
    input.signal?.throwIfAborted();
    const after = check();
    if (after.version !== lease.version || after.contextId !== lease.contextId
      || JSON.stringify(after.quarantineCause) !== JSON.stringify(lease.quarantineCause)) {
      throw new Error('RDC_RECOVERY_IDENTITY_UNVERIFIED: the quarantined binding changed during observation.');
    }
    return validateRdcSwitchSnapshot(payload, after);
  });
}
