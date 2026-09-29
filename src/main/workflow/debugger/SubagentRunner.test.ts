import { AgentToolApprovalRequestService } from '../../agent-runtime/permissions/AgentToolApprovalRequestService';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class { static getAllWindows() { return []; } },
  app: {
    getPath: () => process.env.TEMP ?? process.env.TMP ?? process.cwd(),
    getAppPath: () => process.cwd(),
  },
}));

vi.mock('../../settings/SettingsService', () => ({
  settingsService: {
    getAll: () => ({
      agents: { definitions: [] },
      paths: { userRdcRoot: 'C:/tmp/rdc-agent-test', projectRdcRoot: 'C:/tmp/rdc-agent-test/projects' },
      llm: { providers: [], agentRoutes: [] },
    }),
  },
}));

vi.mock('../../settings/AgentManifestService', () => ({
  agentManifestService: {
    getEffectiveProfiles: () => [
      { id: 'ask', enabled: true, instructions: 'Ask profile instructions', tools: [], skills: [], mcpServers: [], handoffs: [], agents: ['general'], compiledRoute: { agentId: 'ask', providerId: 'openai', modelId: 'gpt-5.6-sol' } },
      { id: 'debugger', enabled: true, instructions: 'Debugger profile instructions', tools: [], skills: [], mcpServers: [], handoffs: [], agents: ['general'], compiledRoute: { agentId: 'debugger', providerId: 'openai', modelId: 'gpt-5.6-sol' } },
      { id: 'general', enabled: true, instructions: 'General profile instructions', tools: [], skills: [], mcpServers: [], handoffs: [], agents: ['debugger'], compiledRoute: { agentId: 'general', providerId: 'openai', modelId: 'gpt-5.6-sol' } },
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

import { TaskRegistry, type TaskRecord } from '../../agent-runtime/tasks';
import { createSessionTaskStore } from '../../agent-runtime/tasks/sessionTaskStore';
import { storageAdapter } from '../../sessions/StorageAdapter';
import { SubagentRunner } from './SubagentRunner';
import { delegationTraceStore } from '../../conversation/DelegationTraceStore';
import { agentManifestService } from '../../settings/AgentManifestService';
import { createSubagentBudgetState, createPolicyBudgetState, reserveDispatchBudget, type TurnHandle } from './TurnCoordinator';
import type { DelegationCapsule } from '@shared/types/delegationCapsule';
import {
  assertRdcContextLeaseOwnership,
  clearRdcContextLeases,
  getRdcContextLease,
  setRdcRuntimeContextForSession,
} from '../../sessions/RdcRuntimeContextRegistry';
import type { RdcRuntimeContext } from '@shared/types/session';

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
    expect(parentEvents).toEqual([]);
  });

  it('passes authoritative Task output keys to the isolated child without parent history', async () => {
    const getTask = vi.spyOn(TaskRegistry.prototype, 'getTask').mockResolvedValue({ id: 'owned', completionRequirements: ['analysis', 'limitations'] } as TaskRecord);
    let request = '';
    const runner = new SubagentRunner({ sendProfileMessage: async (_profile, content) => { request = content; return 'done'; }, systemPromptForAgent: () => 'stable', getActiveTurn: () => null });
    try {
      const result = await runner.runSubagent({ parentAgentId: 'general', parentSessionId: 'task-contract-parent', parentToolCallId: 'call', taskId: 'owned', targetProfile: 'general', capsule: testCapsule() });
      expect(result.status).toBe('complete');
      expect(getTask).toHaveBeenCalledWith('owned');
      expect(request).toContain('"completionRequirements":["analysis","limitations"]');
      expect(request).toContain('Delegated task capsule');
    } finally { getTask.mockRestore(); }
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

  it('reports the child wall deadline instead of a provider stream abort', async () => {
    const runner = new SubagentRunner({
      sendProfileMessage: async (_agentId, _content, options) => new Promise<string>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('EventStream aborted')), { once: true });
      }),
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });
    const result = await runner.runSubagent({
      parentAgentId: 'debugger',
      parentToolCallId: 'deadline-tool',
      targetProfile: 'ask',
      capsule: testCapsule({ budget: { maxToolCalls: 8, maxWallTimeMs: 10 } }),
    });
    expect(result.status).toBe('cancelled');
    expect(result.text).toBe('POLICY_LIMIT_EXCEEDED: maxWallTimeMs');
  });

  it('settles a Task-owned wall timeout as a blocked budget result', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-subagent-wall-timeout-'));
    const originalUserData = process.env.RDC_AGENT_USER_DATA;
    process.env.RDC_AGENT_USER_DATA = root;
    try {
      await storageAdapter.initializeWorkspace();
      const projectRoot = path.join(root, 'project');
      fs.mkdirSync(projectRoot);
      const project = await storageAdapter.createProject(projectRoot);
      const sessionId = storageAdapter.createSession(project.projectId).sessionId;
      const registry = new TaskRegistry(createSessionTaskStore(sessionId));
      const task = await registry.createTask('Timed review');
      const runner = new SubagentRunner({
        sendProfileMessage: async (_agentId, _content, options) => new Promise<string>((_resolve, reject) => {
          if (options?.signal?.aborted) { reject(new Error('EventStream aborted')); return; }
          options?.signal?.addEventListener('abort', () => reject(new Error('EventStream aborted')), { once: true });
        }),
        systemPromptForAgent: () => 'profile', getActiveTurn: () => null,
      });
      const [tool] = runner.createSubagentTools('general', sessionId);
      const result = await tool.execute('deadline-call', {
        ...testCapsule({ budget: { maxToolCalls: 8, maxWallTimeMs: 100 } }),
        taskId: task.id, profile: 'general',
      } as unknown as Record<string, unknown>);
      expect(result.details).toMatchObject({ errorCode: 'POLICY_LIMIT_EXCEEDED' });
      const [execution] = await registry.listExecutions(task.id);
      expect(execution).toMatchObject({
        status: 'blocked',
        result: { disposition: 'blocked', error: 'POLICY_LIMIT_EXCEEDED: maxWallTimeMs' },
      });
      expect(await registry.getTask(task.id)).toMatchObject({ status: 'blocked' });
    } finally {
      if (originalUserData === undefined) delete process.env.RDC_AGENT_USER_DATA;
      else process.env.RDC_AGENT_USER_DATA = originalUserData;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('counts unique toolCallId once across started/completed/denied', async () => {
    const parentBudget = createSubagentBudgetState();
    parentBudget.wallStartedAt = Date.now() - parentBudget.budget.maxAggregateWallMs - 1;
    const beforeFirstChild = Date.now();
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
    expect(parentBudget.childrenSpawned).toBe(1);
    expect(parentBudget.wallStartedAt).toBeGreaterThanOrEqual(beforeFirstChild);
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

  it('runs a Task-owned child with a fresh local Capsule ledger after parent consumption', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-subagent-local-budget-'));
    const originalUserData = process.env.RDC_AGENT_USER_DATA;
    process.env.RDC_AGENT_USER_DATA = root;
    try {
      const sessionId = 'spent-parent-budget';
      const registry = new TaskRegistry(createSessionTaskStore(sessionId));
      const task = await registry.createTask('Independent review', { completionRequirements: ['skeptic_review_result'] });
      const parentPolicy = createPolicyBudgetState({ maxToolCalls: 1000, maxSubagents: 12, maxChildDepth: 2, maxWallTimeMs: 60_000 });
      parentPolicy.toolCalls = 800;
      parentPolicy.subagents = 10;
      const sendProfileMessage = vi.fn(async (_agent: string, _content: string, options?: { policyBudget?: { toolCalls: number; maxToolCalls: number } }) => {
        expect(options?.policyBudget).toMatchObject({ toolCalls: 0, maxToolCalls: 8 });
        return 'Review has no completed declaration';
      });
      const turn = {
        policyBudget: parentPolicy,
        subagentBudget: createSubagentBudgetState(),
        generation: 1,
        isLive: () => true,
        registerProducer: () => () => undefined,
        eventSink: { sessionId, onEvent: () => undefined },
      } as unknown as TurnHandle;
      const runner = new SubagentRunner({ sendProfileMessage, systemPromptForAgent: () => 'profile', getActiveTurn: () => turn });
      const [tool] = runner.createSubagentTools('general', sessionId);
      await tool.execute('review-call', { ...testCapsule(), taskId: task.id, profile: 'general' } as unknown as Record<string, unknown>);
      expect(sendProfileMessage).toHaveBeenCalledOnce();
      const execution = (await registry.listExecutions(task.id))[0];
      expect(execution?.budget).toMatchObject({ toolCalls: 0, maxToolCalls: 8 });
      expect(execution?.status).toBe('blocked');
      expect((await registry.getRootBudget(execution!.rootBudgetId!))?.toolCalls).toBeGreaterThanOrEqual(800);

      const inconsistentTask = await registry.createTask('Budget inconsistency');
      const inconsistentRunner = new SubagentRunner({
        sendProfileMessage: async (_agent, _content, options) => {
          options!.policyBudget!.toolCalls = 9;
          return 'Untrusted child result';
        },
        systemPromptForAgent: () => 'profile', getActiveTurn: () => turn,
      });
      const [inconsistentTool] = inconsistentRunner.createSubagentTools('general', sessionId);
      await expect(inconsistentTool.execute('inconsistent-call', {
        ...testCapsule(), taskId: inconsistentTask.id, profile: 'general',
      } as unknown as Record<string, unknown>)).rejects.toThrow(/budget/i);
      const inconsistentExecution = (await registry.listExecutions(inconsistentTask.id))[0];
      expect(inconsistentExecution?.status).toBe('failed');
      expect((await registry.getTask(inconsistentTask.id))?.status).toBe('blocked');
    } finally {
      if (originalUserData === undefined) delete process.env.RDC_AGENT_USER_DATA;
      else process.env.RDC_AGENT_USER_DATA = originalUserData;
      fs.rmSync(root, { recursive: true, force: true });
    }
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

  it('rejects an invalid model without sending a child turn and retains its failure details', async () => {
    const start = vi.spyOn(delegationTraceStore, 'start').mockImplementation(() => {});
    const finish = vi.spyOn(delegationTraceStore, 'finish').mockImplementation(() => {});
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
      parentSessionId: 'owner',
    });
    expect(result.status).toBe('failed');
    expect(result.text).toMatch(/MODEL_INVALID/);
    expect(sendProfileMessage).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith('owner', expect.objectContaining({ parentToolCallId: 'parent-tool', status: 'running' }));
    expect(finish).toHaveBeenCalledWith('owner', 'parent-tool', expect.any(String), 'failed', expect.stringMatching(/MODEL_INVALID/));
    start.mockRestore();
    finish.mockRestore();
  });

  it('rejects a child without an explicit model or configured profile route before dispatch', async () => {
    const profiles = vi.spyOn(agentManifestService, 'getEffectiveProfiles').mockReturnValueOnce([
      { id: 'general', enabled: true, instructions: 'General profile instructions', tools: [], skills: [], mcpServers: [], handoffs: [], agents: [] },
    ] as never);
    const sendProfileMessage = vi.fn(async () => 'should-not-run');
    try {
      const runner = new SubagentRunner({
        sendProfileMessage,
        systemPromptForAgent: () => 'fallback',
        getActiveTurn: () => null,
      });
      const result = await runner.runSubagent({
        parentAgentId: 'debugger', parentToolCallId: 'parent-tool', targetProfile: 'general',
        capsule: testCapsule(), parentSessionId: 'owner',
      });
      expect(result.status).toBe('failed');
      expect(result.text).toMatch(/MODEL_ROUTE_REQUIRED.*capsule\.model/);
      expect(sendProfileMessage).not.toHaveBeenCalled();
    } finally {
      profiles.mockRestore();
    }
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
      capsule: { ...testCapsule(), reasoningLevel: 'low' },
      parentSessionId: 'parent',
      model: 'openai:gpt-5.6-sol',
    });
    expect(sendProfileMessage).toHaveBeenCalledWith(
      'ask',
      expect.stringContaining('"task":"inspect"'),
      expect.objectContaining({
        modelOverride: { providerId: 'openai', modelId: 'gpt-5.6-sol' },
        turnControls: { reasoningLevel: 'low', maxContextMode: false, fastModel: false },
        sessionId: expect.stringContaining('::subagent::'),
        extraPromptSegments: expect.arrayContaining([
          expect.objectContaining({ kind: 'delegation-capsule', id: 'delegation:contract' }),
        ]),
        excludeRdcLeaseTools: true,
        frozenDelegationCapsule: expect.objectContaining({}),
      }),
    );
  });

  it('grants a delegated lease before the child turn and revokes it after', async () => {
    clearRdcContextLeases();
    setRdcRuntimeContextForSession('parent', {
      contextId: 'ctx-live',
      runtimeOwner: 'local',
      ownerLeaseId: 'lease:live',
      backend: 'local',
      updatedAt: Date.now(),
      captureId: 'cap-live',
    } satisfies RdcRuntimeContext, { projectId: 'proj-1' });
    let childSessionId = '';
    const runner = new SubagentRunner({
      sendProfileMessage: async (_agentId, _content, options) => {
        childSessionId = options?.sessionId ?? '';
        expect(assertRdcContextLeaseOwnership({
          sessionId: childSessionId,
          projectId: 'proj-1',
        })?.contextId).toBe('ctx-live');
        expect(options?.excludeRdcLeaseTools).toBe(false);
        return 'used rdc';
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
      capsule: testCapsule({ domainExtensions: { rdc: { requiresLease: true } } }),
      parentSessionId: 'parent',
      projectId: 'proj-1',
      parentTurn,
    });
    expect(result.status).toBe('complete');
    expect(childSessionId).toContain('::subagent::');
    expect(getRdcContextLease(childSessionId)).toBeNull();
    expect(getRdcContextLease('parent')?.contextId).toBe('ctx-live');
    clearRdcContextLeases();
  });

  it('revokes the delegated lease when the child throws', async () => {
    clearRdcContextLeases();
    setRdcRuntimeContextForSession('parent', {
      contextId: 'ctx-live',
      runtimeOwner: 'local',
      ownerLeaseId: 'lease:live',
      backend: 'local',
      updatedAt: Date.now(),
    } satisfies RdcRuntimeContext, { projectId: 'proj-1' });
    let childSessionId = '';
    const runner = new SubagentRunner({
      sendProfileMessage: async (_agentId, _content, options) => {
        childSessionId = options?.sessionId ?? '';
        expect(getRdcContextLease(childSessionId)?.delegatedFrom).toBe('parent');
        throw new Error('child boom');
      },
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });
    const result = await runner.runSubagent({
      parentAgentId: 'debugger',
      parentToolCallId: 'parent-tool',
      targetProfile: 'ask',
      capsule: testCapsule({ domainExtensions: { rdc: { requiresLease: true } } }),
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
    expect(getRdcContextLease(childSessionId)).toBeNull();
    expect(getRdcContextLease('parent')?.contextId).toBe('ctx-live');
    clearRdcContextLeases();
  });

  it('fail-closes a lease-holding child when the parent has no RDC lease', async () => {
    clearRdcContextLeases();
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
      capsule: testCapsule({ domainExtensions: { rdc: { requiresLease: true } } }),
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
    expect(result.text).toMatch(/RDC_LEASE_DELEGATE_DENIED/);
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
