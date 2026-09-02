/**
 * T06 contract — delegated RDX lease + ConcurrentToolScheduler invariants.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { executeConcurrentToolGroups } from '../../agent-runtime/agent/ConcurrentToolScheduler';
import { isToolCallConcurrencySafe, partitionConsecutiveSafeGroups } from '../../agent-runtime/agent/toolConcurrency';
import { buildEffectiveRuntimePlan } from '../../agent-runtime/EffectiveRuntimePlan';
import { compilePolicyFromRestrictive } from '../../agent-runtime/permissions/PolicyCompiler';
import { createNoneReasoningContract } from '@shared/provider-catalog/providerContracts';
import { stripRdxLeaseToolsFromAllowlist } from '@shared/constants/rdxLeaseTools';
import {
  assertRdxContextLeaseOwnership,
  clearRdxContextLeases,
  getDelegatedChildSessionId,
  getRdxContextLease,
  grantDelegatedLease,
  revokeDelegatedLease,
  setRdxRuntimeContextForSession,
} from '../../sessions/RdxRuntimeContextRegistry';
import type { RdxRuntimeContext } from '@shared/types/session';

function ctx(id: string): RdxRuntimeContext {
  return {
    contextId: id,
    runtimeOwner: 'local',
    ownerLeaseId: `lease:${id}`,
    backend: 'local',
    updatedAt: Date.now(),
    captureId: `cap-${id}`,
  };
}

const routeCapability = {
  providerId: 'p',
  modelId: 'm',
  toolCallingMode: 'native-structured' as const,
  reasoningVisibility: 'none' as const,
  reasoningDelivery: 'none' as const,
  reasoningContract: createNoneReasoningContract('test'),
  supportsStreaming: true,
  supportsToolResults: true,
  toolCallingEvidence: 'supported' as const,
  toolCallingUnverified: false,
  visionInputMode: 'disabled' as const,
  structuredOutputMode: 'native' as const,
};

afterEach(() => {
  clearRdxContextLeases();
});

describe('delegatedRdxLeaseContract: dual owner', () => {
  it('rejects a second live delegated child for the same parent', () => {
    setRdxRuntimeContextForSession('parent', ctx('c1'), { projectId: 'p1' });
    grantDelegatedLease({
      parentSessionId: 'parent',
      childSessionId: 'child-a',
      projectId: 'p1',
      ownerTurnId: 'turn-1',
    });
    expect(() => grantDelegatedLease({
      parentSessionId: 'parent',
      childSessionId: 'child-b',
      projectId: 'p1',
      ownerTurnId: 'turn-1',
    })).toThrow(/RDX_LEASE_DUAL_OWNER/);
    expect(getDelegatedChildSessionId('parent')).toBe('child-a');
    expect(assertRdxContextLeaseOwnership({ sessionId: 'child-b', projectId: 'p1' })).toBeNull();
  });
});

describe('delegatedRdxLeaseContract: grant without parent', () => {
  it('fail-closes when the parent has no lease', () => {
    expect(() => grantDelegatedLease({
      parentSessionId: 'parent',
      childSessionId: 'child',
      ownerTurnId: 'turn-1',
    })).toThrow(/RDX_LEASE_DELEGATE_DENIED/);
    expect(getRdxContextLease('child')).toBeNull();
  });
});

describe('delegatedRdxLeaseContract: revoke on throw', () => {
  it('revokes the child lease when the child path throws', () => {
    setRdxRuntimeContextForSession('parent', ctx('c1'), { projectId: 'p1' });
    const childSessionId = 'parent::subagent::boom';
    try {
      grantDelegatedLease({
        parentSessionId: 'parent',
        childSessionId,
        projectId: 'p1',
        ownerTurnId: 'turn-1',
      });
      throw new Error('child failed');
    } catch {
      revokeDelegatedLease(childSessionId);
    } finally {
      revokeDelegatedLease(childSessionId);
    }
    expect(getRdxContextLease(childSessionId)).toBeNull();
    expect(getRdxContextLease('parent')?.contextId).toBe('c1');
  });
});

describe('delegatedRdxLeaseContract: leftover work after cancel', () => {
  it('revokes the delegated lease and joins in-flight work with allSettled', async () => {
    setRdxRuntimeContextForSession('parent', ctx('c1'), { projectId: 'p1' });
    const childSessionId = 'parent::subagent::cancel';
    grantDelegatedLease({
      parentSessionId: 'parent',
      childSessionId,
      projectId: 'p1',
      ownerTurnId: 'turn-1',
    });
    const controller = new AbortController();
    let childFinished = false;
    const resultsPromise = executeConcurrentToolGroups({
      calls: [{ id: 'rdx' }, { id: 'read' }],
      isSafe: () => true,
      reserve: () => ({ ok: true }),
      executeOne: async (call) => {
        if (call.id === 'rdx') {
          controller.abort();
          await new Promise((resolve) => setTimeout(resolve, 15));
          childFinished = true;
          revokeDelegatedLease(childSessionId);
          return { id: call.id, text: 'done' };
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { id: call.id, text: 'done' };
      },
      createBudgetFailure: (call, _index, limit) => ({ id: call.id, text: limit, isError: true }),
      createNotStarted: (call, _index, reason) => ({ id: call.id, text: reason, isError: true }),
      signal: controller.signal,
    });
    const results = await resultsPromise;
    expect(childFinished).toBe(true);
    expect(results.map((entry) => entry.id)).toEqual(['rdx', 'read']);
    expect(getRdxContextLease(childSessionId)).toBeNull();
    expect(getDelegatedChildSessionId('parent')).toBeNull();
  });
});

describe('delegatedRdxLeaseContract: over-budget dispatch', () => {
  it('does not start any call in a group when reservation fails', async () => {
    const started: string[] = [];
    const results = await executeConcurrentToolGroups({
      calls: [{ id: 'a' }, { id: 'b' }],
      isSafe: () => true,
      reserve: () => ({ ok: false, limit: 'maxToolCalls' }),
      executeOne: async (call) => {
        started.push(call.id);
        return { id: call.id, text: 'ran' };
      },
      createBudgetFailure: (call, _index, limit) => ({ id: call.id, text: limit, isError: true }),
      createNotStarted: (call, _index, reason) => ({ id: call.id, text: reason, isError: true }),
    });
    expect(started).toEqual([]);
    expect(results.every((entry) => entry.text === 'maxToolCalls')).toBe(true);
  });
});

describe('delegatedRdxLeaseContract: stable order', () => {
  it('returns results in callIndex order after a consecutive safe group', async () => {
    const results = await executeConcurrentToolGroups({
      calls: [{ id: 'second' }, { id: 'first' }],
      isSafe: () => true,
      reserve: () => ({ ok: true }),
      executeOne: async (call) => {
        if (call.id === 'second') {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return { id: call.id, text: call.id };
      },
      createBudgetFailure: (call, _index, limit) => ({ id: call.id, text: limit, isError: true }),
      createNotStarted: (call, _index, reason) => ({ id: call.id, text: reason, isError: true }),
    });
    expect(results.map((entry) => entry.id)).toEqual(['second', 'first']);
    expect(partitionConsecutiveSafeGroups([
      isToolCallConcurrencySafe({ name: 'read_file', spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, category: 'file', requiresApproval: false } }),
      isToolCallConcurrencySafe({ name: 'rdx_context' }),
      isToolCallConcurrencySafe({ name: 'rdx_probe' }),
    ])).toEqual([
      { callIndexes: [0], parallel: true },
      { callIndexes: [1], parallel: false },
      { callIndexes: [2], parallel: false },
    ]);
  });
});

describe('delegatedRdxLeaseContract: offline child allowlist', () => {
  it('omits rdx_context and rdx_probe from the frozen child plan', () => {
    const stripped = stripRdxLeaseToolsFromAllowlist([
      'read_file',
      'rdx_context',
      'rdx_probe',
      'rdx',
      'shell',
    ]);
    expect(stripped).toEqual(['read_file', 'shell']);
    const plan = buildEffectiveRuntimePlan({
      agentId: 'general',
      projectRootPath: 'D:/Project',
      profile: { skills: [] },
      toolAllowlist: ['read_file', 'rdx_context', 'rdx_probe', 'shell'],
      permissionSettings: {
        mode: 'default',
        readableRoots: [],
        writableRoots: [],
        allowedCommandPrefixes: [],
        deniedCommandPrefixes: [],
      },
      routeCapability,
      requestPlan: { executionIdentity: { fingerprint: 'offline-child' } },
      promptPlan: { systemPrompt: 'system' },
      policy: compilePolicyFromRestrictive({ deniedTools: [], limits: { maxTurns: 3 } }),
      skillIntersection: ['read_file', 'rdx_context'],
      visibleToolNames: ['read_file', 'rdx_context', 'shell'],
      excludeRdxLeaseTools: true,
    });
    expect(plan.toolAllowlist).not.toContain('rdx_context');
    expect(plan.toolAllowlist).not.toContain('rdx_probe');
    expect(plan.toolAllowlist).toContain('shell');
    expect(plan.excludeRdxLeaseTools).toBe(true);
  });
});
