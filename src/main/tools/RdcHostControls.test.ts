import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRdcHostControls } from './RdcHostControls';
import { freezeRdcTurnBinding } from './RdcTurnBindings';
import { sessionArtifactResolver } from '../sessions/SessionArtifactResolver';
import type { ToolExecutionContext } from '../agent-runtime/agent/AgentTool';

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
afterEach(() => vi.restoreAllMocks());

describe('RDC host controls projection', () => {
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
