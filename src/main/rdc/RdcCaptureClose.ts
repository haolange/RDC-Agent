import type { SessionScope } from '@shared/types/session';
import { rdcCliInvokerService } from './RdcCliInvokerService';
import { parseRdcNativeResult, type RdcNativeEnvelope } from './RdcNativeProtocol';
import { parseRdcProcessIdentity, type RdcProcessIdentity } from './RdcProcessIdentity';
import { assertRdcContextLeaseOwnership, quarantineRdcContext } from './RdcRuntimeContextRegistry';
import { validateRdcSwitchSnapshot } from './RdcSwitchSnapshot';
import type { RdcTurnBinding } from './RdcTurnBindings';

/** Close a replay and file whose native success payloads do not carry a context identity. */
export async function closeOwnedRemoteCapture(input: {
  scope: SessionScope;
  contextId: string;
  replaySessionId: string;
  captureFileId: string;
  binding: RdcTurnBinding;
  signal?: AbortSignal;
  onReplayClosed: () => void;
  onUnconfirmed: () => void;
}): Promise<void> {
  const { scope, contextId, replaySessionId, captureFileId, binding, signal } = input;
  const lease = assertRdcContextLeaseOwnership({ ...scope, contextId });
  if (!lease || lease.runtimeContext.replaySessionId !== replaySessionId
    || lease.runtimeContext.captureFileId !== captureFileId) {
    throw new Error('RDC_SWITCH_IDENTITY_INVALID: the owning replay lease does not match.');
  }
  const assertLease = () => {
    const current = assertRdcContextLeaseOwnership({ ...scope, contextId });
    if (!current || current.version !== lease.version || current.runtimeContext.replaySessionId !== replaySessionId
      || current.runtimeContext.captureFileId !== captureFileId) throw new Error('RDC_SWITCH_BINDING_CHANGED: the owning replay lease changed.');
  };
  const invoke = async (operation: string, args: Record<string, unknown>): Promise<RdcNativeEnvelope> => {
    signal?.throwIfAborted();
    const result = await rdcCliInvokerService.executeCLI('call', [
      operation, '--args-json', JSON.stringify(args), '--daemon-context', contextId,
    ], { contextId, abortSignal: signal, settings: binding.cli });
    signal?.throwIfAborted();
    const payload = parseRdcNativeResult(result, undefined, operation);
    if (payload.data.context_id !== undefined && payload.data.context_id !== contextId) {
      throw new Error('RDC_CONTEXT_MISMATCH: native response belongs to another context.');
    }
    return payload;
  };
  const readContext = async () => {
    const payload = await invoke('rd.session.get_context', {});
    if (payload.data.context_id !== contextId) throw new Error('RDC_CONTEXT_MISMATCH: context observation is not owned.');
    return payload;
  };
  const checkClosedState = (payload: RdcNativeEnvelope, expectedCapture: string, process: RdcProcessIdentity) => {
    const runtime = payload.data.runtime as Record<string, unknown> | undefined;
    const sessions = payload.data.sessions;
    const observedProcess = parseRdcProcessIdentity((payload.meta as Record<string, unknown> | undefined)?.process_identity);
    if (JSON.stringify(observedProcess) !== JSON.stringify(process)
      || (payload.data.process_identity && JSON.stringify(parseRdcProcessIdentity(payload.data.process_identity)) !== JSON.stringify(process))
      || payload.data.current_session_id !== '' || runtime?.session_id !== '' || runtime.capture_file_id !== expectedCapture
      || !Array.isArray(sessions) || sessions.some(value => value && typeof value === 'object'
        && (value as Record<string, unknown>).session_id === replaySessionId)) {
      throw new Error('RDC_CAPTURE_CLOSE_UNCONFIRMED: native context, process, or closed state does not match.');
    }
  };

  let snapshot;
  try { snapshot = validateRdcSwitchSnapshot(await readContext(), lease); assertLease(); }
  catch (error) {
    quarantineRdcContext(scope.sessionId, lease.version, 'The existing replay identity could not be verified before switching.');
    input.onUnconfirmed();
    throw error;
  }
  if (snapshot.replacementCount) throw new Error('RDC_SWITCH_REPLACEMENTS_ACTIVE: restore active replacements before changing capture.');
  try {
    await invoke('rd.capture.close_replay', { session_id: replaySessionId });
    checkClosedState(await readContext(), captureFileId, snapshot.processIdentity);
    assertLease();
    input.onReplayClosed();
    await invoke('rd.capture.close_file', { capture_file_id: captureFileId });
    checkClosedState(await readContext(), '', snapshot.processIdentity);
  } catch (error) {
    quarantineRdcContext(scope.sessionId, lease.version, 'The previous capture close could not be verified; close the owning context before continuing.');
    input.onUnconfirmed();
    throw error;
  }
}
