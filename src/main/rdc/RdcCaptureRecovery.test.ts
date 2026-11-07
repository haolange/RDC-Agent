import { beforeEach, expect, it, vi } from 'vitest';
import { setRdcInteractionLock } from './RdcOperationCoordinator';

const mock = vi.hoisted(() => ({ pending: vi.fn(), write: vi.fn(), session: vi.fn(), project: vi.fn(), verify: vi.fn(),
  snapshot: vi.fn(), opened: vi.fn(), binding: vi.fn(), deviceOwner: vi.fn(), clear: vi.fn(), prepare: vi.fn(), open: vi.fn(), restore: vi.fn(),
  device: vi.fn(), catalog: vi.fn(), lease: vi.fn(), owner: vi.fn(), native: vi.fn(), daemons: vi.fn() }));
vi.mock('../sessions', () => ({ rdcSessionService: { snapshotReplayForSession: mock.snapshot, snapshotOpenedCaptureForSession: mock.opened,
  recoveryBinding: mock.binding, getDeviceOwner: mock.deviceOwner, clearOpenedCaptureForSession: mock.clear,
  prepareAgentDevice: mock.prepare, openProjectInput: mock.open, restoreAgentPosition: mock.restore } }));
vi.mock('../sessions/store/StorageAdapter', () => ({ storageAdapter: { readSession: mock.session, getProjectById: mock.project } }));
vi.mock('../sessions/run/prepareInvestigationPlan', () => ({ verifyPlanInput: mock.verify }));
vi.mock('../settings/settings-core/SettingsService', () => ({ settingsService: { getAll: () => ({ tooling: { rdcCli: cli } }) } }));
vi.mock('./withRdcHostRuntimeEnv', () => ({ withRdcHostRuntimeEnv: (value: unknown) => value }));
vi.mock('./captures/ReplayDeviceService', () => ({ replayDeviceService: { getDeviceById: mock.device } }));
vi.mock('./RdcCliInvokerService', () => ({ rdcCliInvokerService: { loadCatalog: mock.catalog } }));
vi.mock('./RdcRuntimeContextRegistry', () => ({ getRdcContextLease: mock.lease, assertRdcContextLeaseOwnership: mock.owner }));
vi.mock('./RdcSwitchSnapshot', () => ({ readRdcSwitchSnapshot: mock.native }));
vi.mock('./OwnedRdcDaemonRegistry', () => ({ listOwnedRdcDaemons: mock.daemons }));
vi.mock('./RdcLifecycleReceipts', async importOriginal => ({ ...(await importOriginal<typeof import('./RdcLifecycleReceipts')>()),
  rdcLifecycleReceipts: { pending: mock.pending, write: mock.write } }));

import { captureRecoveryStatus, restorePreviousCapture } from './RdcCaptureRecovery';
import { freezeRdcTurnBinding } from './RdcTurnBindings';
const cli = { enabled: true, command: 'rdc', argsPrefix: [], workingDirectory: '', env: {}, timeoutMs: 1000 };
const processIdentity = { status: 'available', daemon: { pid: 10, start_generation: 'windows-filetime:1' }, worker: { pid: 11, start_generation: 'windows-filetime:2' } };
const native = { contextId: 'old', leaseVersion: 1, replaySessionId: 'replay', captureFileId: 'file', eventId: 42,
  replacementCount: 0, replacementFingerprint: '0'.repeat(64), processIdentity };
const original = { inputId: 'a', contentSha256: 'a'.repeat(64), deviceId: 'local', native, target: null, isFinalOutput: false };
const ref = { uri: 'session://tool-outputs/baseline.json', expectedHash: `sha256:${'b'.repeat(64)}` };
const baseline = { schemaVersion: 1, event: 'baseline', sessionId: 's', projectId: 'p', turnId: 't', operationId: 'op',
  planUri: 'session://plans/p.md', planHash: 'c'.repeat(64), recordedAt: 1, original };
const scope = { projectId: 'p', sessionId: 's', bindingGeneration: 0 };
let state: Record<string, unknown>; let lease: Record<string, unknown> | null;
let opened: Record<string, unknown> | null; let unresolved: boolean;

beforeEach(() => {
  vi.clearAllMocks(); setRdcInteractionLock('s', 'foreign', false);
  state = { ...scope, generation: 0, phase: 'closed', contextId: null, inputId: null, captureHash: null, replayDeviceId: null,
    preparation: { phase: 'idle', targetDeviceId: null }, observation: null, target: null, isFinalOutput: false, appliedEventId: null };
  lease = null; opened = null; unresolved = true;
  mock.pending.mockImplementation(() => unresolved ? { baseline, ref, count: 1, identities: [{ contextId: 'old', processIdentity, stopped: true }] } : null);
  mock.write.mockImplementation(() => { unresolved = false; });
  mock.session.mockReturnValue({ projectId: 'p' });
  mock.project.mockReturnValue({ inputs: [{ inputId: 'a', fileName: 'a.rdc', filePath: '/project/a.rdc', contentSha256: 'a'.repeat(64) }] });
  mock.verify.mockResolvedValue('a'.repeat(64)); mock.device.mockReturnValue({ id: 'local', type: 'local', status: 'online' });
  mock.catalog.mockResolvedValue({ tools: [] }); mock.daemons.mockReturnValue([]); mock.deviceOwner.mockReturnValue(null);
  mock.snapshot.mockImplementation(() => structuredClone(state)); mock.opened.mockImplementation(() => opened);
  mock.lease.mockImplementation(() => lease); mock.owner.mockImplementation(() => lease);
  mock.binding.mockImplementation(() => state.contextId ? freezeRdcTurnBinding(cli, [], lease as never) : null);
  mock.prepare.mockImplementation(async (_request, authority) => {
    authority.assertAuthorized(); state = { ...state, generation: 1, preparation: { phase: 'ready', targetDeviceId: 'local' } };
    return { success: true, state: structuredClone(state) };
  });
  mock.open.mockImplementation(async () => {
    lease = { contextId: 'new', version: 2, ownerSessionId: 's', ownerProjectId: 'p', runtimeContext: { captureFileId: 'file-new', replaySessionId: 'replay-new' } };
    opened = { contextId: 'new', inputId: 'a' };
    state = { ...state, generation: 2, phase: 'ready', contextId: 'new', inputId: 'a', captureHash: 'a'.repeat(64), replayDeviceId: 'local',
      observation: {}, appliedEventId: 9, target: null, isFinalOutput: false };
  });
  mock.restore.mockImplementation(async () => { state = { ...state, appliedEventId: 42 }; });
  mock.native.mockImplementation(async () => ({ ...native, contextId: 'new', leaseVersion: 2, replaySessionId: 'replay-new', captureFileId: 'file-new', eventId: state.appliedEventId }));
  mock.clear.mockImplementation(async () => { state = { ...state, generation: Number(state.generation) + 1, contextId: null }; lease = null; opened = null; return true; });
});

it('reopens and verifies the saved capture and position only after the user requests recovery', async () => {
  expect(captureRecoveryStatus(scope)).toMatchObject({ pendingCount: 1, original: { fileName: 'a.rdc', eventId: 42 } });
  expect(mock.prepare).not.toHaveBeenCalled();
  const result = await restorePreviousCapture(scope);
  expect(result.appliedEventId).toBe(42);
  expect(mock.prepare).toHaveBeenCalledOnce(); expect(mock.open).toHaveBeenCalledOnce(); expect(mock.restore).toHaveBeenCalledOnce();
  expect(mock.write).toHaveBeenCalledWith(expect.objectContaining({ event: 'resolved', baseline: ref, observed: expect.objectContaining({ inputId: 'a' }) }));
  expect(captureRecoveryStatus(scope)).toBeNull();
});

it('preserves the current replay when input identity changed or an old process may still be alive', async () => {
  mock.verify.mockResolvedValueOnce('d'.repeat(64));
  await expect(restorePreviousCapture(scope)).rejects.toThrow('RDC_RECOVERY_INPUT_CHANGED');
  expect(mock.clear).not.toHaveBeenCalled(); expect(mock.prepare).not.toHaveBeenCalled();
  mock.pending.mockReturnValue({ baseline, ref, count: 1, identities: [{ contextId: 'old', stopped: false,
    processIdentity: { ...processIdentity, daemon: { pid: process.pid, start_generation: 'windows-filetime:1' } } }] });
  await expect(restorePreviousCapture(scope)).rejects.toThrow('RDC_RECOVERY_OLD_PROCESS_UNCONFIRMED');
  expect(mock.clear).not.toHaveBeenCalled(); expect(mock.write).not.toHaveBeenCalled();
});

it('does not take over an active turn or accept a stale UI generation', async () => {
  setRdcInteractionLock('s', 'foreign', true);
  try { await expect(restorePreviousCapture(scope)).rejects.toThrow('RDC_INTERACTION_LOCKED'); }
  finally { setRdcInteractionLock('s', 'foreign', false); }
  await expect(restorePreviousCapture({ ...scope, bindingGeneration: 7 })).rejects.toThrow('RDC_BINDING_CHANGED');
  expect(mock.prepare).not.toHaveBeenCalled();
});
