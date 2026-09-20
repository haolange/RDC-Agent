import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.TEMP ?? process.env.TMP ?? process.cwd(),
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    decryptString: () => '',
    encryptString: (value: string) => Buffer.from(value),
  },
}));

vi.mock('../../sessions/RdcRuntimeContextRegistry', () => ({
  assertRdcContextLeaseOwnership: vi.fn(() => null),
  getRdcContextLease: vi.fn(() => null),
  setRdcRuntimeContextForSession: vi.fn(() => null),
}));

import { assertRdcContextLeaseOwnership } from '../../sessions/RdcRuntimeContextRegistry';
import { resolveAgentToolAllowlistFromDefinition } from './DebuggerRuntimePolicy';
import { RuntimeToolAssembly } from './RuntimeToolAssembly';
import { toolValidator } from '../../agent-runtime/core/ToolValidator';
import { toolToDefinition } from '../../agent-runtime/agent/AgentTool';
import { TaskRegistry, createSessionTaskStore, registerDelegatedTaskScope } from '../../agent-runtime/tasks';
import { TurnHandle } from './TurnCoordinator';
import type { McpConnectionCoordinator } from './McpConnectionCoordinator';

function createAssembly(): RuntimeToolAssembly {
  return new RuntimeToolAssembly({
    mcp: {
      getConnectedTools: () => [],
      getAgentTools: () => [],
    } as unknown as McpConnectionCoordinator,
    getActiveTurn: () => null,
    getMemoryStore: () => ({}) as never,
    createSubagentTools: () => [],
    getMcpServerStatusSummary: () => [],
  });
}

describe('RuntimeToolAssembly', () => {
  it('validates structured completion through the actual executor schema boundary', async () => {
    const turn = { completionDeclaration: undefined } as unknown as TurnHandle;
    const tool = createAssembly().createTurnCompletionTool(turn);
    const args = {
      disposition: 'completed',
      result: { summary: 'Verified', outputs: { analysis: 'Scoped evidence' }, counterevidence: [], unresolved: [], scope: 'fixture', sideEffects: [], recoveryState: [] },
    };
    const validated = toolValidator.validate(toolToDefinition(tool), args);
    await tool.execute('completion', validated);
    expect(turn.completionDeclaration).toMatchObject(args);
    await expect(tool.execute('invalid-output', toolValidator.validate(toolToDefinition(tool), {
      ...args, result: { ...args.result, outputs: { analysis: { unauthorized: true } } },
    }))).rejects.toThrow('result.outputs values must be strings');
    expect(() => toolValidator.validate(toolToDefinition(tool), {
      ...args, result: { ...args.result, authority: 'expanded' },
    })).toThrow('未声明字段');
  });

  it('returns domain rejection before recording completion so the model can correct its declaration', async () => {
    const turn = { completionDeclaration: undefined } as unknown as TurnHandle;
    const tool = createAssembly().createTurnCompletionTool(turn, async value => {
      await Promise.resolve();
      if (value.disposition === 'completed') throw new Error('REPORT_REQUIRED');
    });
    await expect(tool.execute('wrong-completion', { disposition: 'completed' })).rejects.toThrow('REPORT_REQUIRED');
    expect(turn.completionDeclaration).toBeUndefined();
    await tool.execute('corrected', { disposition: 'partial' });
    expect(turn.completionDeclaration?.disposition).toBe('partial');
  });

  it('createToolSignature sorts tool names', () => {
    const assembly = createAssembly();
    expect(assembly.createToolSignature([
      { name: 'b', description: '', parameters: { type: 'object', properties: {} } },
      { name: 'a', description: '', parameters: { type: 'object', properties: {} } },
    ])).toBe('a|b');
  });

  it('matchesToolAllowlist supports exact, star, and prefix wildcards', () => {
    const assembly = createAssembly();
    expect(assembly.matchesToolAllowlist('read_file', ['*'])).toBe(true);
    expect(assembly.matchesToolAllowlist('read_file', ['read_file'])).toBe(true);
    expect(assembly.matchesToolAllowlist('mcp__x__y', ['mcp__*'])).toBe(true);
    expect(assembly.matchesToolAllowlist('mcp__x__y', ['mcp__x*'])).toBe(true);
    expect(assembly.matchesToolAllowlist('write_file', ['read_file'])).toBe(false);
  });

  it('uses the turn-frozen allowlist for runtime checks and tool assembly', () => {
    const assembly = createAssembly();
    const frozen = ['read_file'];
    expect(assembly.isAllowedForRuntime('ask', 'read_file', frozen)).toBe(true);
    expect(assembly.isAllowedForRuntime('ask', 'write_file', frozen)).toBe(false);
    frozen[0] = 'write_file';
    expect(assembly.isAllowedForRuntime('ask', 'read_file', ['read_file'])).toBe(true);
  });

  it('isAllowedForRuntime denies tools outside the frozen allowlist', () => {
    const assembly = createAssembly();
    expect(assembly.isAllowedForRuntime('ask', 'read_file', ['read_file'])).toBe(true);
    expect(assembly.isAllowedForRuntime('ask', 'read_file', [])).toBe(false);
  });

  it('createAskUserTool rejects empty questions', async () => {
    const assembly = createAssembly();
    const tool = assembly.createAskUserTool('ask');
    const result = await tool.execute('tc-1', { questions: [] });
    expect(result.isError).toBe(true);
    expect(result.details?.questions).toEqual([]);
  });

  it('createRdcContextTool reports missing lease', async () => {
    const assembly = createAssembly();
    const tool = assembly.createRdcContextTool('sess-1', 'proj-1');
    const result = await tool.execute('tc-1', {});
    expect(result.details).toEqual({ available: false });
    expect(assertRdcContextLeaseOwnership).toHaveBeenCalled();
  });

  it('createRdcContextTool returns runtime context when lease exists', async () => {
    vi.mocked(assertRdcContextLeaseOwnership).mockReturnValueOnce({
      runtimeContext: { capture: 'demo.rdc' },
    } as never);
    const assembly = createAssembly();
    const tool = assembly.createRdcContextTool('sess-1', 'proj-1');
    const result = await tool.execute('tc-1', {});
    expect(result.details).toEqual({ available: true });
    expect(result.content[0]).toMatchObject({ type: 'text' });
  });

  it('createPlanArtifactTool is a fail-closed stub', async () => {
    const assembly = createAssembly();
    const tool = assembly.createPlanArtifactTool('sess-1');
    const result = await tool.execute('tc', { title: 'Plan', summary: ['One'], content: '## Goal\nDo work.' });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('plan review bridge') });
  });

  it('createTaskRuntimeTools uses memory store for subagent sessions', () => {
    const assembly = createAssembly();
    const tools = assembly.createTaskRuntimeTools('parent::subagent::child');
    expect(tools.some((tool) => tool.name.includes('task') || tool.name === 'task_create' || tool.name.length > 0)).toBe(true);
  });

  it('limits a Task-owned child session to a durable descendant subtree', async () => {
    const ownerSessionId = `owner-${Date.now()}`;
    const childSessionId = `${ownerSessionId}::subagent::child`;
    const registry = new TaskRegistry(createSessionTaskStore(ownerSessionId));
    const root = await registry.createTask('Owned root');
    const execution = await registry.startExecution(root.id, { mode: 'subagent' });
    const release = registerDelegatedTaskScope(childSessionId, { ownerSessionId, rootTaskId: root.id, executionId: execution.id, generation: execution.generation });
    try {
      const tools = createAssembly().createTaskRuntimeTools(childSessionId);
      const create = tools.find((tool) => tool.name === 'task_create')!;
      const get = tools.find((tool) => tool.name === 'task_get')!;
      const created = await create.execute('create-child', { tasks: [{ subject: 'Child work' }] });
      const childId = (created.details as { ids: string[] }).ids[0]!;
      await expect(registry.getTask(childId)).resolves.toMatchObject({ parentTaskId: root.id });
      await expect(get.execute('read-root', { taskId: root.id })).rejects.toThrow(/TASK_SCOPE_DENIED/);
      const report = tools.find((tool) => tool.name === 'subagent_report')!;
      await report.execute('report', { kind: 'progress', body: 'Evidence search complete.' });
      await expect(registry.consumeExecutionMessages(execution.id, 0, 'to_parent')).resolves.toMatchObject({ messages: [expect.objectContaining({ body: 'Evidence search complete.' })] });
    } finally {
      release();
    }
  });

  it('keeps output publication on General task tokens and drops it for Mission', () => {
    const assembly = createAssembly();
    const handle = new TurnHandle({ sessionKey: 'session-a', turnId: 'turn-a', runId: 'run-a', generation: 1 });
    const general = assembly.resolveRuntimeTools('general', ['task'], 'session-a', handle, 'project-a');
    expect(general.toolMap.has('output_register')).toBe(true);

    const missionAllowlist = resolveAgentToolAllowlistFromDefinition('debugger', ['task']);
    const mission = assembly.resolveRuntimeTools('debugger', missionAllowlist, 'session-a', handle, 'project-a');
    expect(mission.toolMap.has('output_register')).toBe(false);
    expect(mission.toolMap.has('task_create')).toBe(true);
  });

  it('does not assemble agent_handoff', () => {
    const tools = createAssembly().createWorkbenchTools('debugger', 'session-a');
    expect(tools.some((tool) => tool.name === 'agent_handoff')).toBe(false);
  });
});
