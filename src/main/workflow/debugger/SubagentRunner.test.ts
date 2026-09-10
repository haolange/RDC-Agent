import { AgentToolApprovalRequestService } from '../../agent-runtime/permissions/AgentToolApprovalRequestService';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.TEMP ?? process.env.TMP ?? process.cwd(),
    getAppPath: () => process.cwd(),
  },
}));

vi.mock('../../settings/SettingsService', () => ({
  settingsService: {
    getAll: () => ({
      agents: { definitions: [] },
      paths: { userRdxRoot: 'C:/tmp/rdc-agent-test', projectRdxRoot: 'C:/tmp/rdc-agent-test/projects' },
      llm: { providers: [], agentRoutes: [] },
    }),
  },
}));

vi.mock('../../settings/AgentManifestService', () => ({
  agentManifestService: {
    getEffectiveProfiles: () => [
      { id: 'ask', enabled: true, instructions: 'Ask profile instructions', tools: [], skills: [], mcpServers: [], handoffs: [], agents: ['general'] },
      { id: 'debugger', enabled: true, instructions: 'Debugger profile instructions', tools: [], skills: [], mcpServers: [], handoffs: [], agents: ['general'] },
      { id: 'general', enabled: true, instructions: 'General profile instructions', tools: [], skills: [], mcpServers: [], handoffs: [], agents: ['debugger'] },
    ],
  },
}));

vi.mock('../../settings/EffectiveModelResolver', () => ({
  resolveEffectiveModel: (providerId: string, modelId: string) => {
    if (providerId === 'openai' && modelId === 'gpt-5.6-sol') {
      return {
        providerId,
        modelId,
        enabled: true,
        availability: 'available',
        selection: { pickerVisibility: 'primary' },
      };
    }
    return null;
  },
}));

import { SubagentRunner } from './SubagentRunner';
import { createSubagentBudgetState, createPolicyBudgetState, reserveDispatchBudget, type TurnHandle } from './TurnCoordinator';
import type { DelegationCapsule } from '@shared/types/delegationCapsule';
import {
  assertRdxContextLeaseOwnership,
  clearRdxContextLeases,
  getRdxContextLease,
  setRdxRuntimeContextForSession,
} from '../../sessions/RdxRuntimeContextRegistry';
import type { RdxRuntimeContext } from '@shared/types/session';

function testCapsule(overrides: Partial<DelegationCapsule> = {}): DelegationCapsule {
  return {
    goal: 'Inspect the capture',
    task: 'inspect',
    acceptedFacts: [{ statement: 'Frame presents a triangle', sourceRefs: [], qualification: 'caller observation' }],
    negativePaths: [{ path: 'shader mutation', reason: 'read-only task', applicableWhen: 'current scope', recheckWhen: 'explicit new authorization' }],
    scope: 'bounded read-only inspection', hypotheses: [], challengeRefs: [], stopConditions: [], requiredSkillIds: [],
    inputArtifactRefs: [],
    outputRequirements: 'Return a short evidence summary',
    budget: { maxToolCalls: 8, maxWallTimeMs: 60_000 },

    ...overrides,
  };
}

describe('SubagentRunner', () => {
  it('runSubagent completes and forwards tool/assistant events', async () => {
    const parentEvents: Array<{ type: string }> = [];
    const runner = new SubagentRunner({
      sendProfileMessage: async (_agentId, _content, options) => {
        options?.onEvent?.({
          id: 'e1',
          type: 'assistant.delta',
          timestamp: Date.now(),
          sessionId: 's',
          agentId: 'ask',
          payload: { text: 'partial' },
        });
        options?.onEvent?.({
          id: 'e2',
          type: 'tool.started',
          timestamp: Date.now(),
          sessionId: 's',
          agentId: 'ask',
          payload: { toolCallId: 't1', toolName: 'grep', args: {} },
        });
        options?.onEvent?.({
          id: 'e3',
          type: 'tool.completed',
          timestamp: Date.now(),
          sessionId: 's',
          agentId: 'ask',
          payload: {
            toolCallId: 't1',
            toolName: 'grep',
            result: { ok: true, duration_ms: 1 },
          },
        });
        return 'final answer';
      },
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });

    const parentTurn = {
      subagentBudget: createSubagentBudgetState(),
      signal: undefined,
      generation: 1,
      isLive: () => true,
      registerProducer: () => () => undefined,
      eventSink: { sessionId: 'parent', onEvent: () => undefined },
    } as unknown as TurnHandle;

    const result = await runner.runSubagent({
      parentAgentId: 'debugger',
      parentToolCallId: 'parent-tool',
      targetProfile: 'ask',
      capsule: testCapsule(),
      parentSessionId: 'parent',
      parentOnEvent: (event) => parentEvents.push({ type: event.type }),
      parentTurn,
    });

    expect(result.status).toBe('complete');
    expect(result.text).toBe('final answer');
    expect(parentEvents.some((e) => e.type === 'subagent.started')).toBe(true);
    expect(parentEvents.some((e) => e.type === 'subagent.delta')).toBe(true);
    expect(parentEvents.some((e) => e.type === 'subagent.completed')).toBe(true);
  });

  it('runSubagent marks cancelled when parent already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const runner = new SubagentRunner({
      sendProfileMessage: async () => 'should-not-run',
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });
    const result = await runner.runSubagent({
      parentAgentId: 'debugger',
      parentToolCallId: 'parent-tool',
      targetProfile: 'ask',
      capsule: testCapsule(),
      signal: controller.signal,
    });
    expect(result.status).toBe('cancelled');
  });

  it('runSubagent marks failed on throw', async () => {
    const runner = new SubagentRunner({
      sendProfileMessage: async () => {
        throw new Error('boom');
      },
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });
    const result = await runner.runSubagent({
      parentAgentId: 'debugger',
      parentToolCallId: 'parent-tool',
      targetProfile: 'ask',
      capsule: testCapsule(),
    });
    expect(result.status).toBe('failed');
    expect(result.text).toBe('boom');
  });

  it('counts unique toolCallId once across started/completed/denied', async () => {
    const parentBudget = createSubagentBudgetState();
    const runner = new SubagentRunner({
      sendProfileMessage: async (_agentId, _content, options) => {
        options?.onEvent?.({
          id: 'e1', type: 'tool.started', timestamp: Date.now(), sessionId: 's', agentId: 'ask',
          payload: { toolCallId: 'same', toolName: 'grep', args: {} },
        });
        options?.onEvent?.({
          id: 'e2', type: 'tool.completed', timestamp: Date.now(), sessionId: 's', agentId: 'ask',
          payload: { toolCallId: 'same', toolName: 'grep', result: { ok: true, duration_ms: 1 } },
        });
        options?.onEvent?.({
          id: 'e3', type: 'tool.denied', timestamp: Date.now(), sessionId: 's', agentId: 'ask',
          payload: { toolCallId: 'same', toolName: 'grep', reason: 'no' },
        });
        options?.onEvent?.({
          id: 'e4', type: 'tool.started', timestamp: Date.now(), sessionId: 's', agentId: 'ask',
          payload: { toolCallId: 'other', toolName: 'read', args: {} },
        });
        return 'ok';
      },
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });
    const parentTurn = {
      subagentBudget: parentBudget,
      signal: undefined,
      generation: 1,
      isLive: () => true,
      registerProducer: () => () => undefined,
      eventSink: { sessionId: 'parent', onEvent: () => undefined },
    } as unknown as TurnHandle;
    await runner.runSubagent({
      parentAgentId: 'debugger',
      parentToolCallId: 'parent-tool',
      targetProfile: 'ask',
      capsule: testCapsule(),
      parentSessionId: 'parent',
      parentTurn,
    });
    expect(parentBudget.aggregateToolCalls).toBe(2);
  });

  it('does not inflate aggregateToolCalls for events without toolCallId', async () => {
    const parentBudget = createSubagentBudgetState();
    const runner = new SubagentRunner({
      sendProfileMessage: async (_agentId, _content, options) => {
        options?.onEvent?.({
          id: 'e1', type: 'tool.started', timestamp: Date.now(), sessionId: 's', agentId: 'ask',
          payload: { toolCallId: '', toolName: 'grep', args: {} },
        });
        options?.onEvent?.({
          id: 'e2', type: 'tool.completed', timestamp: Date.now(), sessionId: 's', agentId: 'ask',
          payload: { toolCallId: '   ', toolName: 'grep', result: { ok: true, duration_ms: 1 } },
        });
        options?.onEvent?.({
          id: 'e3', type: 'tool.denied', timestamp: Date.now(), sessionId: 's', agentId: 'ask',
          payload: { toolCallId: '', toolName: 'grep', reason: 'no' },
        });
        return 'ok';
      },
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });
    const parentTurn = {
      subagentBudget: parentBudget,
      signal: undefined,
      generation: 1,
      isLive: () => true,
      registerProducer: () => () => undefined,
      eventSink: { sessionId: 'parent', onEvent: () => undefined },
    } as unknown as TurnHandle;
    await runner.runSubagent({
      parentAgentId: 'debugger',
      parentToolCallId: 'parent-tool',
      targetProfile: 'ask',
      capsule: testCapsule(),
      parentSessionId: 'parent',
      parentTurn,
    });
    expect(parentBudget.aggregateToolCalls).toBe(0);
  });

  it('createSubagentTools executes a self run when frozen delegates are empty', async () => {
    const runner = new SubagentRunner({
      sendProfileMessage: async () => 'child done',
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });
    const [tool] = runner.createSubagentTools('debugger', 'sess-1');
    expect(tool.name).toBe('subagent');
    const result = await tool.execute('tc-1', testCapsule({ task: 'do work' }) as unknown as Record<string, unknown>);
    expect(result.details).toMatchObject({ profile: 'debugger', status: 'complete' });
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Subagent result persistence failed') });
    expect((result.content[0] as { text: string }).text).not.toContain('child done');
  });

  it('uses the canonical subagent tool to start a Task-owned background execution', async () => {
    const runner = new SubagentRunner({
      sendProfileMessage: async () => 'unused',
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });
    const start = vi.fn(async () => ({ id: 'execution-1', generation: 3 }) as never);
    runner.setBackgroundStarter(start);
    const [tool] = runner.createSubagentTools('debugger', 'sess-1');
    const result = await tool.execute('tc-bg', {
      ...testCapsule({ task: 'explore' }),
      taskId: 'task-1',
      mode: 'background',
    } as unknown as Record<string, unknown>);
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-1', taskId: 'task-1' }));
    expect(result.details).toMatchObject({ executionId: 'execution-1', generation: 3, status: 'running' });
  });

  it('fails closed when the capsule is missing required fields', async () => {
    const sendProfileMessage = vi.fn(async () => 'should-not-run');
    const runner = new SubagentRunner({
      sendProfileMessage,
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });
    const [tool] = runner.createSubagentTools('debugger', 'sess-1');
    const result = await tool.execute('tc-missing', { task: 'do work' } as never);
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('DELEGATION_CAPSULE_INVALID') });
    expect(sendProfileMessage).not.toHaveBeenCalled();
  });

  it('authorizes only frozen profileDelegates and denies others', async () => {
    const runner = new SubagentRunner({
      sendProfileMessage: async () => 'child done',
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => ({
        runtimePlan: { profileDelegates: ['general'] },
        registerProducer: () => () => undefined,
        subagentBudget: createSubagentBudgetState(),
        signal: undefined,
        generation: 1,
        isLive: () => true,
        eventSink: { sessionId: 'sess-1', onEvent: () => undefined },
      } as unknown as TurnHandle),
    });
    const [tool] = runner.createSubagentTools('debugger', 'sess-1');
    const allowed = await tool.execute('tc-allowed', testCapsule({ task: 'do work', profile: 'general' }) as unknown as Record<string, unknown>);
    expect(allowed.details).toMatchObject({ profile: 'general', status: 'complete' });
    await expect(tool.execute('tc-denied', testCapsule({ task: 'do work', profile: 'ask' }) as unknown as Record<string, unknown>))
      .rejects.toThrow(/SUBAGENT_DELEGATE_DENIED/);
  });

  it('rejects an invalid model without sending a child turn', async () => {
    const sendProfileMessage = vi.fn(async () => 'should-not-run');
    const runner = new SubagentRunner({
      sendProfileMessage,
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });
    const result = await runner.runSubagent({
      parentAgentId: 'debugger',
      parentToolCallId: 'parent-tool',
      targetProfile: 'ask',
      capsule: testCapsule(),
      model: 'not-canonical',
    });
    expect(result.status).toBe('failed');
    expect(result.text).toMatch(/MODEL_INVALID/);
    expect(sendProfileMessage).not.toHaveBeenCalled();
  });

  it('forwards a resolved model override and does not inherit a parent session override', async () => {
    const sendProfileMessage = vi.fn(async () => 'child done');
    const runner = new SubagentRunner({
      sendProfileMessage,
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });
    await runner.runSubagent({
      parentAgentId: 'debugger',
      parentToolCallId: 'parent-tool',
      targetProfile: 'ask',
      capsule: testCapsule(),
      parentSessionId: 'parent',
      model: 'openai:gpt-5.6-sol',
    });
    expect(sendProfileMessage).toHaveBeenCalledWith(
      'ask',
      expect.stringContaining('"task":"inspect"'),
      expect.objectContaining({
        modelOverride: { providerId: 'openai', modelId: 'gpt-5.6-sol' },
        sessionId: expect.stringContaining('::subagent::'),
        extraPromptSegments: expect.arrayContaining([
          expect.objectContaining({ kind: 'delegation-capsule', id: 'delegation:contract' }),
        ]),
        excludeRdxLeaseTools: true,
        frozenDelegationCapsule: expect.objectContaining({}),
      }),
    );
  });

  it('grants a delegated lease before the child turn and revokes it after', async () => {
    clearRdxContextLeases();
    setRdxRuntimeContextForSession('parent', {
      contextId: 'ctx-live',
      runtimeOwner: 'local',
      ownerLeaseId: 'lease:live',
      backend: 'local',
      updatedAt: Date.now(),
      captureId: 'cap-live',
    } satisfies RdxRuntimeContext, { projectId: 'proj-1' });
    let childSessionId = '';
    const runner = new SubagentRunner({
      sendProfileMessage: async (_agentId, _content, options) => {
        childSessionId = options?.sessionId ?? '';
        expect(assertRdxContextLeaseOwnership({
          sessionId: childSessionId,
          projectId: 'proj-1',
        })?.contextId).toBe('ctx-live');
        expect(options?.excludeRdxLeaseTools).toBe(false);
        return 'used rdx';
      },
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });
    const parentTurn = {
      turnId: 'turn-parent',
      subagentBudget: createSubagentBudgetState(),
      signal: undefined,
      generation: 1,
      isLive: () => true,
      registerProducer: () => () => undefined,
      eventSink: { sessionId: 'parent', projectId: 'proj-1', onEvent: () => undefined },
    } as unknown as TurnHandle;
    const result = await runner.runSubagent({
      parentAgentId: 'debugger',
      parentToolCallId: 'parent-tool',
      targetProfile: 'ask',
      capsule: testCapsule({ domainExtensions: { rdx: { requiresLease: true } } }),
      parentSessionId: 'parent',
      projectId: 'proj-1',
      parentTurn,
    });
    expect(result.status).toBe('complete');
    expect(childSessionId).toContain('::subagent::');
    expect(getRdxContextLease(childSessionId)).toBeNull();
    expect(getRdxContextLease('parent')?.contextId).toBe('ctx-live');
    clearRdxContextLeases();
  });

  it('revokes the delegated lease when the child throws', async () => {
    clearRdxContextLeases();
    setRdxRuntimeContextForSession('parent', {
      contextId: 'ctx-live',
      runtimeOwner: 'local',
      ownerLeaseId: 'lease:live',
      backend: 'local',
      updatedAt: Date.now(),
    } satisfies RdxRuntimeContext, { projectId: 'proj-1' });
    let childSessionId = '';
    const runner = new SubagentRunner({
      sendProfileMessage: async (_agentId, _content, options) => {
        childSessionId = options?.sessionId ?? '';
        expect(getRdxContextLease(childSessionId)?.delegatedFrom).toBe('parent');
        throw new Error('child boom');
      },
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });
    const result = await runner.runSubagent({
      parentAgentId: 'debugger',
      parentToolCallId: 'parent-tool',
      targetProfile: 'ask',
      capsule: testCapsule({ domainExtensions: { rdx: { requiresLease: true } } }),
      parentSessionId: 'parent',
      projectId: 'proj-1',
      parentTurn: {
        turnId: 'turn-parent',
        subagentBudget: createSubagentBudgetState(),
        registerProducer: () => () => undefined,
        generation: 1,
        isLive: () => true,
        eventSink: { sessionId: 'parent', projectId: 'proj-1' },
      } as unknown as TurnHandle,
    });
    expect(result.status).toBe('failed');
    expect(result.text).toBe('child boom');
    expect(getRdxContextLease(childSessionId)).toBeNull();
    expect(getRdxContextLease('parent')?.contextId).toBe('ctx-live');
    clearRdxContextLeases();
  });

  it('fail-closes a lease-holding child when the parent has no RDX lease', async () => {
    clearRdxContextLeases();
    const sendProfileMessage = vi.fn(async () => 'should-not-run');
    const runner = new SubagentRunner({
      sendProfileMessage,
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });
    const result = await runner.runSubagent({
      parentAgentId: 'debugger',
      parentToolCallId: 'parent-tool',
      targetProfile: 'ask',
      capsule: testCapsule({ domainExtensions: { rdx: { requiresLease: true } } }),
      parentSessionId: 'parent',
      projectId: 'proj-1',
      parentTurn: {
        turnId: 'turn-parent',
        subagentBudget: createSubagentBudgetState(),
        registerProducer: () => () => undefined,
        generation: 1,
        isLive: () => true,
        eventSink: { sessionId: 'parent' },
      } as unknown as TurnHandle,
    });
    expect(result.status).toBe('failed');
    expect(result.text).toMatch(/RDX_LEASE_DELEGATE_DENIED/);
    expect(sendProfileMessage).not.toHaveBeenCalled();
  });
});


it('enforces Capsule budget in child requests and aborts a pending provider at its deadline', async () => {
  const parent = createPolicyBudgetState({ maxToolCalls: 100, maxSubagents: 10, maxChildDepth: 3, maxWallTimeMs: 60000 });
  let captured = false;
  const runner = new SubagentRunner({
    sendProfileMessage: async (_agent, _content, options) => {
      captured = true;
      expect(options?.policyBudget?.maxToolCalls).toBe(1);
      expect(reserveDispatchBudget(options?.policyBudget, { toolCalls: 1, subagents: 0 }).ok).toBe(true);
      expect(reserveDispatchBudget(options?.policyBudget, { toolCalls: 1, subagents: 0 }).ok).toBe(false);
      return new Promise<string>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    },
    systemPromptForAgent: () => 'profile',
    getActiveTurn: () => null,
  });
  const result = await runner.runSubagent({ parentAgentId: 'general', targetProfile: 'general', parentToolCallId: 'dispatch', parentSessionId: 'budget-parent', policyBudget: parent, capsule: testCapsule({ budget: { maxToolCalls: 1, maxSubagents: 0, maxWallTimeMs: 30 } }) });
  expect(captured).toBe(true); expect(result.status).toBe('cancelled');
  expect(parent.maxToolCalls).toBe(100); expect(parent.toolCalls).toBe(1); expect(parent.subagents).toBe(1);
});


it('forwards a child approval with its actual execution identity and controlled parent answer', async () => {
  const approvals = new AgentToolApprovalRequestService();
  const events: import('@shared/types/agentRuntime').AgentEvent[] = [];
  const runner = new SubagentRunner({
    getActiveTurn: () => null, systemPromptForAgent: () => 'profile',
    sendProfileMessage: async (_agent, _content, options) => {
      const approved = await approvals.request({ agentId: 'general', sessionId: options!.sessionId, turnId: 'child-permission-turn', toolCallId: 'mutation', toolName: 'shell', reason: 'Write scoped output', risk: 'high', context: { sessionId: options!.sessionId, turnId: 'child-permission-turn' }, signal: options?.signal, onEvent: options?.onEvent });
      return approved ? 'approved child output' : 'denied';
    },
  });
  const result = await runner.runSubagent({ parentAgentId: 'general', targetProfile: 'general', parentToolCallId: 'dispatch-tool', executionId: 'durable-execution-7', parentSessionId: 'parent', capsule: testCapsule(), parentOnEvent: (event) => {
    events.push(event);
    if (event.type === 'approval.requested') expect(approvals.answer({ sessionId: 'parent', turnId: 'child-permission-turn', approvalId: 'tool-approval-mutation', approved: true }).success).toBe(true);
  } });
  expect(result.status).toBe('complete');
  expect(events.find((event) => event.type === 'approval.requested')).toMatchObject({ sessionId: 'parent', payload: { delegatedRequest: { executionId: 'durable-execution-7', turnId: 'child-permission-turn' }, risk: 'high' } });
});
