import { afterEach, expect, it, vi } from 'vitest';
import { clearRdcContextLeases, getDelegatedChildSessionId, grantDelegatedLease, quarantineRdcContext,
  revokeDelegatedLease, setRdcRuntimeContextForSession } from '../../rdc/RdcRuntimeContextRegistry';
import { TurnHandle } from './TurnCoordinator';
import { joinFaultedRdcChild } from './RdcRecoveryChildren';

const mock = vi.hoisted(() => ({ scope: vi.fn(), list: vi.fn(), interrupt: vi.fn() }));
vi.mock('../tasks', () => ({ getDelegatedTaskScope: mock.scope, createSessionTaskStore: vi.fn(),
  TaskRegistry: class { listExecutions = mock.list; interruptExecutionForRecovery = mock.interrupt; } }));
afterEach(() => { clearRdcContextLeases(); vi.resetAllMocks(); });

function setup() {
  setRdcRuntimeContextForSession('s', { contextId: 'ctx', runtimeOwner: 'owner', ownerLeaseId: 'owner',
    captureFileId: 'capture', replaySessionId: 'replay', backend: 'local', updatedAt: 1 }, { projectId: 'p' });
  const child = grantDelegatedLease({ parentSessionId: 's', childSessionId: 'child', projectId: 'p', ownerTurnId: 't' });
  const turn = new TurnHandle({ sessionKey: 's', turnId: 't', generation: 1 });
  return { child, turn };
}

it('joins only the affected execution tree and propagates the observed failure to the owner', async () => {
  const { child, turn } = setup();
  quarantineRdcContext('child', child.version, 'failed', { operation: 'rd.test', argsFingerprint: 'a'.repeat(64), code: 'fault' });
  mock.scope.mockReturnValue({ ownerSessionId: 's', rootTaskId: 'task', executionId: 'root', generation: 1 });
  const active = [{ id: 'root', mode: 'subagent', status: 'running', generation: 1 },
    { id: 'nested', parentExecutionId: 'root', mode: 'subagent', status: 'running', generation: 2 },
    { id: 'unrelated', mode: 'subagent', status: 'running', generation: 1 }];
  mock.list.mockResolvedValueOnce(active).mockResolvedValueOnce([active[2]]);
  mock.interrupt.mockImplementation(async (id: string) => { if (id === 'root') revokeDelegatedLease('child', { operationStopped: true }); });
  await joinFaultedRdcChild('s', turn);
  expect(mock.interrupt.mock.calls.map(call => call[0])).toEqual(['nested', 'root']);
  expect(getDelegatedChildSessionId('s')).toBeNull();
});

it('does not cancel an unrelated live child or claim an aborted join completed', async () => {
  const { child, turn } = setup();
  await expect(joinFaultedRdcChild('s', turn)).rejects.toThrow('RDC_RECOVERY_CHILD_ACTIVE');
  expect(mock.interrupt).not.toHaveBeenCalled();
  quarantineRdcContext('child', child.version, 'failed', { operation: 'rd.test', argsFingerprint: 'a'.repeat(64), code: 'fault' });
  mock.scope.mockReturnValue({ ownerSessionId: 's', rootTaskId: 'task', executionId: 'root', generation: 1 });
  mock.list.mockResolvedValue([{ id: 'root', mode: 'subagent', status: 'running', generation: 1 }]);
  let release!: () => void;
  mock.interrupt.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
  const abort = new AbortController(); const stopping = joinFaultedRdcChild('s', turn, abort.signal);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  abort.abort(); await expect(stopping).rejects.toMatchObject({ name: 'AbortError' });
  expect(getDelegatedChildSessionId('s')).toBe('child');
  release();
});
