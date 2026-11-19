import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ExecutionOffer } from '@shared/types/executionOffer';
import type { InvestigationPlanContract } from '@shared/types/planInvestigation';
import { clearRdcContextLeases, quarantineRdcContext, setRdcRuntimeContextForSession } from '../../rdc/RdcRuntimeContextRegistry';
import { freezeRdcTurnBinding } from '../../rdc/RdcTurnBindings';
import { createApprovedCaptureHost } from './ApprovedCaptureHost';
import { TurnHandle } from './TurnCoordinator';
import { setRdcInteractionLock } from '../../rdc/RdcOperationCoordinator';

const mock = vi.hoisted(() => ({ state: vi.fn(), opened: vi.fn(), open: vi.fn(), close: vi.fn(), restore: vi.fn(), prepareDevice: vi.fn(),
  project: vi.fn(), session: vi.fn(), verifyInput: vi.fn(), device: vi.fn(), snapshot: vi.fn(), recoverySnapshot: vi.fn(), permission: vi.fn(), active: vi.fn(),
  entries: vi.fn(), readRecord: vi.fn(), assertOffer: vi.fn(), readPlan: vi.fn(), parsePlan: vi.fn() }));
vi.mock('../../sessions', () => ({ rdcSessionService: { snapshotReplayForSession: mock.state, snapshotOpenedCaptureForSession: mock.opened,
  openProjectInput: mock.open, clearOpenedCaptureForSession: mock.close, restoreAgentPosition: mock.restore, prepareAgentDevice: mock.prepareDevice } }));
vi.mock('../../sessions/store/StorageAdapter', () => ({ storageAdapter: { readSession: mock.session, getProjectById: mock.project } }));
vi.mock('../../sessions/run/prepareInvestigationPlan', () => ({ verifyPlanInput: mock.verifyInput }));
vi.mock('../../sessions/run/handoffSkills', () => ({ assertApprovedExecutionCurrent: mock.assertOffer }));
vi.mock('../../sessions/run/sessionPlanArtifact', () => ({ planArtifactWriter: { readMarkdown: mock.readPlan } }));
vi.mock('../../sessions/run/approvedInvestigationContract', () => ({ approvedInvestigationContract: mock.parsePlan }));
vi.mock('../../rdc/RdcSwitchSnapshot', () => ({ readRdcSwitchSnapshot: mock.snapshot, readRdcRecoverySnapshot: mock.recoverySnapshot }));
vi.mock('../permissions/RuntimePermissionStateService', () => ({ runtimePermissionStateService: { getSnapshot: mock.permission } }));
vi.mock('../../rdc/captures/ReplayDeviceService', () => ({ replayDeviceService: { getDeviceById: mock.device } }));
vi.mock('../../rdc/RdcLifecycleReceipts', () => ({ rdcLifecycleReceipts: { prepare: vi.fn(), write: vi.fn(), pending: vi.fn() } }));
vi.mock('../../investigation/InvestigationArtifactService', () => ({ investigationArtifactService: { list: mock.entries, readRecord: mock.readRecord } }));
vi.mock('./DirectTaskTurnLifecycle', () => ({ listActiveDelegations: mock.active }));

const offer: ExecutionOffer = { schemaVersion: '1', sourceAgentId: 'analyzer', targetAgentId: 'general', plan: { uri: 'session://plans/p.md', hash: 'c'.repeat(64) },
  requiredSkillIds: [], label: 'Continue', prompt: 'Execute', approvedAt: 1 };
const contract: InvestigationPlanContract = { schemaVersion: 1, mission: 'analyzer', captureScope: { projectId: 'p', deviceId: 'local', comparisonGoal: 'compare',
  inputs: [{ inputId: 'a', fileName: 'a.rdc', contentSha256: 'a'.repeat(64) }] } };
const cli = { enabled: true, command: 'rdc', argsPrefix: [], workingDirectory: '', env: {}, timeoutMs: 1000 };
const destination = { inputId: 'a', contentSha256: 'a'.repeat(64), deviceId: 'local' };
const processIdentity = { status: 'available' as const, daemon: { pid: 10, start_generation: 'windows-filetime:1' },
  worker: { pid: 11, start_generation: 'windows-filetime:2' } };
beforeEach(() => {
  vi.clearAllMocks();
  mock.session.mockReturnValue({ projectId: 'p' });
  mock.project.mockReturnValue({ projectId: 'p', rootPath: '/project', inputs: [{ inputId: 'a', filePath: '/project/a.rdc', contentSha256: 'a'.repeat(64) }] });
  mock.verifyInput.mockResolvedValue('a'.repeat(64)); mock.device.mockReturnValue({ id: 'local', type: 'local', status: 'online' });
  mock.state.mockReturnValue({ phase: 'ready', generation: 3, inputId: 'a', captureHash: 'a'.repeat(64), replayDeviceId: 'local',
    preparation: { targetDeviceId: 'local', phase: 'ready' }, appliedEventId: 5, observation: {}, target: null, isFinalOutput: false });
  mock.opened.mockReturnValue({ status: 'open', inputId: 'a', filePath: '/project/a.rdc', deviceId: 'local', contextId: 'ctx', captureFileId: 'file', replaySessionId: 'replay' });
  mock.snapshot.mockResolvedValue({ contextId: 'ctx', leaseVersion: 1, replaySessionId: 'replay', captureFileId: 'file', eventId: 5,
    replacementCount: 0, replacementFingerprint: '0'.repeat(64), processIdentity });
  mock.recoverySnapshot.mockResolvedValue({ contextId: 'ctx', leaseVersion: 1, replaySessionId: 'replay', captureFileId: 'file', eventId: 6,
    replacementCount: 0, replacementFingerprint: '0'.repeat(64), processIdentity });
  mock.permission.mockReturnValue({ revision: 1, mode: 'full-access' });
  mock.active.mockResolvedValue([]); mock.entries.mockReturnValue([]); mock.readPlan.mockReturnValue({ markdown: 'plan' }); mock.parsePlan.mockReturnValue(contract);
  mock.open.mockResolvedValue(undefined);
  mock.close.mockResolvedValue(true);
  mock.prepareDevice.mockResolvedValue({ success: true, state: { generation: 5 } });
});

it('checks quarantined process identity and reconnects the same device under unchanged authority', async () => {
  const { host, binding } = fixture();
  quarantineRdcContext('s', binding.identity!.version, 'fault', { operation: 'rd.test', argsFingerprint: 'd'.repeat(64), code: 'native_failure' });
  const point = { ...destination, target: null, isFinalOutput: false,
    native: { contextId: 'ctx', leaseVersion: 1, replaySessionId: 'replay', captureFileId: 'file', eventId: 5,
      replacementCount: 0, replacementFingerprint: '0'.repeat(64), processIdentity } };
  expect(await host.inspectRecovery(point, binding)).toMatchObject({ cause: { code: 'native_failure' }, observed: { eventId: 6 } });
  const guard = host.recoveryGuard(1);
  await host.reopenAfterFailure(destination, binding, undefined, () => {}, guard);
  expect(mock.close).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's' }), expect.objectContaining({ binding, expectedGeneration: 3 }));
  expect(mock.prepareDevice).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'local' }), expect.objectContaining({ binding, turnId: 't' }));
  expect(mock.open).toHaveBeenCalledWith(expect.objectContaining({ inputId: 'a' }), expect.objectContaining({ expectedGeneration: 5, expectedCaptureSha256: 'a'.repeat(64) }));
  mock.permission.mockReturnValue({ revision: 2, mode: 'custom' });
  expect(guard).toThrow('RDC_RECOVERY_PERMISSION_CHANGED');
  mock.recoverySnapshot.mockResolvedValueOnce({ ...point.native, processIdentity: { ...processIdentity, worker: { pid: 99, start_generation: 'windows-filetime:3' } } });
  await expect(host.inspectRecovery(point, binding)).rejects.toThrow('RDC_RECOVERY_PROCESS_CHANGED');
});
afterEach(() => { clearRdcContextLeases(); setRdcInteractionLock('s', 't', false); });
function fixture() {
  const lease = setRdcRuntimeContextForSession('s', { contextId: 'ctx', runtimeOwner: 'owner', ownerLeaseId: 'lease', backend: 'local', deviceId: 'local',
    replaySessionId: 'replay', captureFileId: 'file', updatedAt: 1 }, { projectId: 'p' })!;
  const binding = freezeRdcTurnBinding(cli, [], lease);
  const turn = new TurnHandle({ sessionKey: 's', turnId: 't', generation: 1 });
  setRdcInteractionLock('s', 't', true);
  return { host: createApprovedCaptureHost({ sessionId: 's', projectId: 'p', offer, contract, turn }), binding };
}

it('verifies the registered bytes, device, projection and native snapshot before a capture change', async () => {
  const { host, binding } = fixture(); host.assertPlan();
  expect(await host.snapshot(binding)).toMatchObject({ ...destination, native: { eventId: 5 } });
  mock.verifyInput.mockResolvedValueOnce('b'.repeat(64));
  await expect(host.verifyDestination(destination)).rejects.toThrow('RDC_APPROVED_CAPTURE_CHANGED');
  mock.state.mockReturnValueOnce({ phase: 'ready', generation: 3, inputId: 'a', captureHash: 'a'.repeat(64), replayDeviceId: 'local',
    preparation: { targetDeviceId: 'local', phase: 'ready' }, appliedEventId: 4, observation: {}, target: null, isFinalOutput: false });
  await expect(host.snapshot(binding)).rejects.toThrow('native and displayed event positions differ');
  await host.open(destination, binding, undefined, () => {});
  expect(mock.open).toHaveBeenCalledWith(expect.objectContaining({ inputId: 'a', filePath: '/project/a.rdc' }),
    expect.objectContaining({ binding, expectedCaptureSha256: 'a'.repeat(64), expectedGeneration: 3 }));
});

it('refuses switching while a child or experiment is active and detects plan drift', async () => {
  const { host } = fixture(); mock.active.mockResolvedValueOnce([{ id: 'child' }]);
  await expect(host.quiescent()).rejects.toThrow('RDC_SWITCH_CHILD_ACTIVE');
  mock.entries.mockReturnValueOnce([{ artifactId: 'experiment', status: 'draft' }]);
  mock.readRecord.mockReturnValueOnce({ record: { status: 'running', experimentId: 'experiment' } });
  await expect(host.quiescent()).rejects.toThrow('RDC_SWITCH_EXPERIMENT_OPEN');
  mock.parsePlan.mockReturnValueOnce({ ...contract, mission: 'debugger' });
  expect(() => host.assertPlan()).toThrow('APPROVED_PLAN_CHANGED');
});
