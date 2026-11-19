import { afterEach, expect, it } from 'vitest';
import { clearRdcContextLeases, quarantineRdcContext, setRdcRuntimeContextForSession } from './RdcRuntimeContextRegistry';
import { freezeRdcTurnBinding } from './RdcTurnBindings';
import { readRdcRecoverySnapshot, readRdcSwitchSnapshot } from './RdcSwitchSnapshot';

const processIdentity = { status: 'available' as const,
  daemon: { pid: 10, start_generation: 'windows-filetime:1' }, worker: { pid: 11, start_generation: 'windows-filetime:2' } };
const cli = { enabled: true, command: 'rdc', argsPrefix: [], workingDirectory: '', env: {}, timeoutMs: 1000 };
afterEach(clearRdcContextLeases);

it('binds the native snapshot to the owning lease, capture, event and actual process identities', async () => {
  const lease = setRdcRuntimeContextForSession('session', { contextId: 'context', runtimeOwner: 'owner', ownerLeaseId: 'lease',
    captureFileId: 'capture', replaySessionId: 'replay', backend: 'local', updatedAt: 1 }, { projectId: 'project' })!;
  const binding = freezeRdcTurnBinding(cli, [], lease);
  const payload = { ok: true, result_kind: 'rd.session.get_context', meta: { process_identity: processIdentity }, data: {
    context_id: 'context', current_session_id: 'replay', process_identity: processIdentity,
    runtime: { session_id: 'replay', capture_file_id: 'capture', active_event_id: 42 },
    sessions: [{ session_id: 'replay', capture_file_id: 'capture', shader_replacements: [] }],
  } };
  const execute = async () => ({ exitCode: 0, stdout: JSON.stringify(payload), stderr: '', duration_ms: 1 });
  const input = { sessionId: 'session', projectId: 'project', binding, execute };
  expect(await readRdcSwitchSnapshot(input)).toMatchObject({ contextId: 'context', leaseVersion: lease.version,
    captureFileId: 'capture', replaySessionId: 'replay', eventId: 42, replacementCount: 0, processIdentity });
  payload.data.sessions[0].capture_file_id = 'other';
  await expect(readRdcSwitchSnapshot(input)).rejects.toThrow('RDC_SWITCH_IDENTITY_INVALID');
  payload.data.sessions[0].capture_file_id = 'capture';
  payload.data.process_identity = { ...processIdentity, worker: { ...processIdentity.worker, pid: 12 } };
  await expect(readRdcSwitchSnapshot(input)).rejects.toThrow('RDC_SWITCH_PROCESS_CHANGED');
  setRdcRuntimeContextForSession('session', { ...lease.runtimeContext, replaySessionId: 'replacement' }, { projectId: 'project' });
  await expect(readRdcSwitchSnapshot(input)).rejects.toThrow('RDC_SWITCH_BINDING_CHANGED');
});

it('permits only recovery inspection of a quarantined binding with an observed failure', async () => {
  const lease = setRdcRuntimeContextForSession('session', { contextId: 'context', runtimeOwner: 'owner', ownerLeaseId: 'lease',
    captureFileId: 'capture', replaySessionId: 'replay', backend: 'local', updatedAt: 1 }, { projectId: 'project' })!;
  const binding = freezeRdcTurnBinding(cli, [], lease);
  const payload = { ok: true, result_kind: 'rd.session.get_context', meta: { process_identity: processIdentity }, data: {
    context_id: 'context', current_session_id: 'replay', process_identity: processIdentity,
    runtime: { session_id: 'replay', capture_file_id: 'capture', active_event_id: 9 },
    sessions: [{ session_id: 'replay', capture_file_id: 'capture', shader_replacements: [] }],
  } };
  const execute = async () => ({ exitCode: 0, stdout: JSON.stringify(payload), stderr: '', duration_ms: 1 });
  const input = { sessionId: 'session', projectId: 'project', binding, execute };
  await expect(readRdcRecoverySnapshot(input)).rejects.toThrow('RDC_RECOVERY_IDENTITY_UNVERIFIED');
  quarantineRdcContext('session', lease.version, 'uncertain', { operation: 'rd.test', argsFingerprint: 'a'.repeat(64), code: 'failure' });
  await expect(readRdcSwitchSnapshot(input)).rejects.toThrow('RDC_SWITCH_BINDING_CHANGED');
  expect(await readRdcRecoverySnapshot(input)).toMatchObject({ contextId: 'context', eventId: 9, processIdentity });
  payload.data.runtime.session_id = 'other';
  await expect(readRdcRecoverySnapshot(input)).rejects.toThrow('RDC_SWITCH_IDENTITY_INVALID');
});
