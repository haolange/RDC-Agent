import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRdcHostControls } from './RdcHostControls';
import { freezeRdcTurnBinding } from './RdcTurnBindings';
import { sessionArtifactResolver } from '../sessions/SessionArtifactResolver';
import type { ToolExecutionContext } from '../agent-runtime/agent/AgentTool';
import { clearRdcContextLeases, grantDelegatedLease, quarantineRdcContext, setRdcRuntimeContextForSession } from '../sessions/RdcRuntimeContextRegistry';
import { setRdcInteractionLock } from '../sessions/RdcOperationCoordinator';

const scope = { sessionId: 'owner', projectId: 'project', contextId: 'context', leaseVersion: 7 };
function context(timeoutMs = 120000): ToolExecutionContext {
  return { sessionId: 'owner', projectId: 'project', workspaceRoot: '/project', projectRootPath: '/project',
    rdcBinding: freezeRdcTurnBinding({ enabled: true, command: 'private-executable', argsPrefix: ['private-entry'],
      workingDirectory: 'private-directory', env: { SECRET: 'private-secret' }, timeoutMs }, [], {
      ownerSessionId: 'owner', contextId: 'context', version: 7,
    }) };
}
function quota() {
  return vi.spyOn(sessionArtifactResolver, 'getQuotaCapacity').mockReturnValue({
    usage: { diskBytes: 50, reservedBytes: 20, liveBytes: 70,
      diskToolOutputFiles: 3, reservedToolOutputFiles: 2, liveToolOutputFiles: 5 },
    limits: { maxFileBytes: 100, maxImageBytes: 100, maxSessionBytes: 200, maxToolOutputFiles: 10 },
    remaining: { bytes: 130, toolOutputFiles: 5 }, isReservation: false,
  });
}
afterEach(() => {
  vi.restoreAllMocks(); clearRdcContextLeases(); setRdcInteractionLock('owner', 'turn', false);
});

function protectedTurn() {
  const lease = setRdcRuntimeContextForSession('owner', { contextId: 'context', runtimeOwner: 'rdc-agent',
    ownerLeaseId: 'owner-lease', backend: 'remote', replaySessionId: 'replay', captureFileId: 'capture', updatedAt: Date.now() },
  { projectId: 'project' })!;
  const execution = { ...context(), agentId: 'general', turnId: 'turn' };
  execution.rdcBinding = freezeRdcTurnBinding(execution.rdcBinding!.cli, [], lease);
  setRdcInteractionLock('owner', 'turn', true);
  return { execution, lease, scope: { ...scope, leaseVersion: lease.version } };
}

describe('RDC host controls projection', () => {
  it('reports the actual protected owning turn without claiming device-wide or native batch isolation', () => {
    quota(); const test = protectedTurn();
    expect(readRdcHostControls(test.scope, test.execution)).toMatchObject({ replayIsolation: {
      available: true, source: 'main-owned-lease-and-turn-lock', scope: 'rdc-agent-context', exclusive: true,
      sessionId: 'owner', projectId: 'project', turnId: 'turn', contextId: 'context', leaseVersion: test.lease.version,
      replaySessionId: 'replay', captureFileId: 'capture', nativeBatchLock: false, excludesExternalProcesses: false,
    } });
  });

  it.each(['turn', 'capture', 'replay', 'lease', 'quarantine', 'delegated', 'duplicate', 'unlocked', 'planner', 'excluded'])(
    'does not attest exclusivity with %s state', (failure) => {
      quota(); const test = protectedTurn();
      if (failure === 'turn') test.execution.turnId = 'foreign-turn';
      if (failure === 'planner') test.execution.agentId = 'debugger';
      if (failure === 'excluded') Object.assign(test.execution, { excludeRdcLeaseTools: true });
      if (failure === 'capture' || failure === 'replay') test.execution.rdcBinding = freezeRdcTurnBinding(
        test.execution.rdcBinding!.cli, [], { ...test.lease, runtimeContext: { ...test.lease.runtimeContext,
          ...(failure === 'capture' ? { captureFileId: 'foreign-capture' } : { replaySessionId: 'foreign-replay' }) } });
      if (failure === 'lease') test.scope.leaseVersion += 1;
      if (failure === 'unlocked') setRdcInteractionLock('owner', 'turn', false);
      if (failure === 'quarantine') quarantineRdcContext('owner', test.lease.version, 'uncertain');
      if (failure === 'delegated') grantDelegatedLease({ parentSessionId: 'owner', childSessionId: 'child', ownerTurnId: 'turn' });
      if (failure === 'duplicate') setRdcRuntimeContextForSession('other', test.lease.runtimeContext, { projectId: 'other-project' });
      expect(readRdcHostControls(test.scope, test.execution)).toMatchObject({ replayIsolation: { available: false } });
    });
  it('exposes current owner quota and the frozen per-invocation policy without private CLI material', () => {
    const readQuota = quota();
    const execution = context();
    const result = readRdcHostControls(scope, execution);
    expect(readQuota).toHaveBeenCalledExactlyOnceWith('owner');
    expect(result).toMatchObject({ available: true, measuredAt: expect.any(Number),
      artifactCapacity: { available: true, remaining: { bytes: 130, toolOutputFiles: 5 }, isReservation: false },
      cliProcess: { available: true, source: 'frozen-turn-cli', timeoutMs: 120000,
        termination: { maxTreeKillAttempts: 2, joinTerminationAdditionalWaitMs: 13000 },
        wholeOperationDeadline: false, nativeTerminationGuaranteed: false, postOperationObservationMayInvokeCli: true },
    });
    expect(JSON.stringify(result)).not.toMatch(/private-|SECRET|argsPrefix|workingDirectory/);
  });

  it.each(['sessionId', 'projectId'] as const)('does not query a foreign execution scope (%s)', (field) => {
    const readQuota = quota();
    const result = readRdcHostControls(scope, { ...context(), [field]: 'foreign' });
    expect(result).toMatchObject({ available: false, reason: 'execution_scope_mismatch' });
    expect(readQuota).not.toHaveBeenCalled();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('does not invent a usable timeout from %s', (value) => {
    quota();
    expect(readRdcHostControls(scope, context(value))).toMatchObject({ cliProcess: { available: false } });
  });

  it('keeps missing binding, lease drift and failed quota reads explicitly unknown', () => {
    quota().mockImplementation(() => { throw new Error('private-secret'); });
    const noBinding = readRdcHostControls(scope);
    expect(noBinding).toMatchObject({ available: false, artifactCapacity: { available: false }, cliProcess: { available: false } });
    expect(JSON.stringify(noBinding)).not.toContain('private-secret');
    expect(readRdcHostControls({ ...scope, leaseVersion: 8 }, context())).toMatchObject({ cliProcess: { available: false } });
    expect(readRdcHostControls({ ...scope, contextId: 'other-context' }, context())).toMatchObject({ cliProcess: { available: false } });
  });

  it('does not advertise an enabled execution policy for a disabled frozen CLI', () => {
    quota();
    const execution = context();
    execution.rdcBinding = freezeRdcTurnBinding({ ...execution.rdcBinding!.cli, enabled: false }, [], execution.rdcBinding!.identity);
    expect(readRdcHostControls(scope, execution)).toMatchObject({ cliProcess: { available: false } });
  });
});
