import type { HandoffContract } from '@shared/types/handoffContract';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../sessions/RdxRuntimeContextRegistry', () => ({
  assertRdxContextLeaseOwnership: vi.fn(() => null),
  getRdxContextLease: vi.fn(() => null),
  setRdxRuntimeContextForSession: vi.fn(() => null),
}));

const {
  dispatchRuntimeHooks,
  prepareHandoff,
  createPreparedDraft,
  abandonDraft,
  cancelHandoff,
  computeNextChain,
  getActiveHandoff,
  listCheckpoints,
  readCheckpoint,
} = vi.hoisted(() => ({
  dispatchRuntimeHooks: vi.fn<(
    event: string,
    context: { payload?: Record<string, unknown> },
  ) => Promise<boolean>>(async () => true),
  prepareHandoff: vi.fn((
    _sessionId: string,
    input: { handoffId?: string; send?: boolean },
  ) => ({ handoffId: input.handoffId ?? 'handoff-1', send: input.send ?? true })),
  createPreparedDraft: vi.fn((
    _sessionId: string,
    input: { send?: boolean },
  ) => ({ handoffId: 'handoff-1', send: input.send ?? true, lifecycle: 'prepared' })),
  abandonDraft: vi.fn(),
  cancelHandoff: vi.fn(),
  computeNextChain: vi.fn(() => ({ chainRoot: 'root', depth: 1 })),
  getActiveHandoff: vi.fn((_sessionId?: string) => null as { handoffId: string; lifecycle: string } | null),
  listCheckpoints: vi.fn<(
    sessionId: string,
    filter?: { kind?: string },
  ) => Array<{
    artifactId: string;
    kind: string;
    status: string;
    recordKey: string;
    createdAt: string;
  }>>(() => []),
  readCheckpoint: vi.fn<(
    sessionId: string,
    artifactId: string,
  ) => { record: { checkpointId?: string }; manifest?: { mission?: string } }>(),
}));

vi.mock('../../hooks/runtimeHookDispatch', () => ({
  dispatchRuntimeHooks,
}));

vi.mock('../../investigation/InvestigationArtifactService', () => ({
  investigationArtifactService: {
    list: listCheckpoints,
    readRecord: readCheckpoint,
  },
}));

vi.mock('../../sessions/StorageAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../sessions/StorageAdapter')>();
  return {
    ...actual,
    storageAdapter: {
      ...actual.storageAdapter,
      handoffs: {
        ...actual.storageAdapter.handoffs,
        computeNextChain,
        getActive: getActiveHandoff,
        prepare: prepareHandoff,
        createPreparedDraft,
        abandonDraft,
        cancel: cancelHandoff,
      },
    },
  };
});

vi.mock('../../settings/SettingsService', () => ({
  settingsService: {
    getAll: () => ({ llm: { providers: [] } }),
  },
}));

import { assertRdxContextLeaseOwnership } from '../../sessions/RdxRuntimeContextRegistry';
import { resolveAgentToolAllowlistFromDefinition } from './DebuggerRuntimePolicy';
import { RuntimeToolAssembly } from './RuntimeToolAssembly';
import { toolValidator } from '../../agent-runtime/core/ToolValidator';
import { toolToDefinition } from '../../agent-runtime/agent/AgentTool';
import { TaskRegistry, createSessionTaskStore, registerDelegatedTaskScope } from '../../agent-runtime/tasks';
import { TurnHandle } from './TurnCoordinator';
import type { McpConnectionCoordinator } from './McpConnectionCoordinator';

vi.mock('../../sessions/SessionArtifactResolver', () => ({ sessionArtifactResolver: {
  read: (_session: string, uri: string) => ({ uri, category: uri.includes('plans') ? 'plans' : 'investigation', mimeType: uri.includes('plans') ? 'text/markdown' : 'application/json', hash: 'a'.repeat(64) }),
} }));
function handoffContract(target: string): HandoffContract {
  const ref = { uri: 'session://plans/plan.md', hash: 'a'.repeat(64) };
  return target === 'general'
    ? { intent: 'execute', plan: ref, requiredSkillIds: ['renderdoc-execution'], returnTo: 'debugger', deliveryRequirements: 'checkpoint' }
    : { intent: 'return', executionHandoffId: 'executing', artifacts: [ref] };
}
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

  beforeEach(() => {
    dispatchRuntimeHooks.mockReset();
    dispatchRuntimeHooks.mockImplementation(async () => true);
    prepareHandoff.mockClear();
    createPreparedDraft.mockClear();
    abandonDraft.mockClear();
    cancelHandoff.mockClear();
    computeNextChain.mockReset().mockReturnValue({ chainRoot: 'root', depth: 1 });
    getActiveHandoff.mockReset().mockReturnValue(null);
    listCheckpoints.mockReset().mockReturnValue([]);
    readCheckpoint.mockReset();
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

  it('createRdxContextTool reports missing lease', async () => {
    const assembly = createAssembly();
    const tool = assembly.createRdxContextTool('sess-1', 'proj-1');
    const result = await tool.execute('tc-1', {});
    expect(result.details).toEqual({ available: false });
    expect(assertRdxContextLeaseOwnership).toHaveBeenCalled();
  });

  it('createRdxContextTool returns runtime context when lease exists', async () => {
    vi.mocked(assertRdxContextLeaseOwnership).mockReturnValueOnce({
      runtimeContext: { capture: 'demo.rdc' },
    } as never);
    const assembly = createAssembly();
    const tool = assembly.createRdxContextTool('sess-1', 'proj-1');
    const result = await tool.execute('tc-1', {});
    expect(result.details).toEqual({ available: true });
    expect(result.content[0]).toMatchObject({ type: 'text' });
  });

  it('createPlanArtifactTool validates session and content', async () => {
    const assembly = createAssembly();
    const noSession = assembly.createPlanArtifactTool(null);
    const missing = await noSession.execute('tc', { content: 'plan' });
    expect(missing.isError).toBe(true);

    const withSession = assembly.createPlanArtifactTool('sess-1');
    const empty = await withSession.execute('tc', { content: '   ' });
    expect(empty.isError).toBe(true);
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

  it('fires agent.before-handoff and agent.after-handoff on a valid handoff', async () => {
    const assembly = createAssembly();
    const handle = new TurnHandle({ sessionKey: 'session-a', turnId: 'turn-a', runId: 'run-a', generation: 1 });
    handle.eventSink = { sessionId: 'session-a', requestId: 'req-1' } as never;
    handle.runtimePlan = {
      projectRootPath: 'D:/project',
      profileHandoffs: [{ agent: 'general', label: 'Go', prompt: 'continue' }],
      enabledProfileIds: ['debugger', 'general'],
    } as never;
    const tool = assembly.createAgentHandoffTool('debugger', 'session-a', handle);
    const result = await tool.execute('tc-handoff', { agent: 'general', contract: handoffContract('general'), prompt: 'continue', label: 'Go' });
    expect(result.isError).not.toBe(true);
    expect(dispatchRuntimeHooks).toHaveBeenCalledWith(
      'agent.before-handoff',
      expect.objectContaining({
        agentId: 'debugger',
        sessionId: 'session-a',
        payload: {
          fromAgentId: 'debugger',
          toAgentId: 'general',
          label: 'Go',
          prompt: 'continue',
          depth: 1,
          contract: handoffContract('general'),
        },
      }),
    );
    expect(dispatchRuntimeHooks).toHaveBeenCalledWith(
      'agent.after-handoff',
      expect.objectContaining({ agentId: 'debugger', sessionId: 'session-a' }),
    );
  });

  it('passes only the explicit contract regardless of identity, depth or stored checkpoints', async () => {
    computeNextChain.mockReturnValueOnce({ chainRoot: 'root', depth: 4 });
    const assembly = createAssembly();
    const handle = new TurnHandle({ sessionKey: 'session-b', turnId: 'turn-b', runId: 'run-b', generation: 1 });
    handle.eventSink = { sessionId: 'session-b', requestId: 'req-2' } as never;
    handle.runtimePlan = {
      profileHandoffs: [{ agent: 'debugger', label: 'Review', prompt: 'Review evidence.' }],
      enabledProfileIds: ['debugger', 'general'],
    } as never;
    const contract = handoffContract('debugger');
    const result = await assembly.createAgentHandoffTool('general', 'session-b', handle)
      .execute('call', { agent: 'debugger', contract, prompt: 'Review evidence.' });
    expect(result.isError).not.toBe(true);
    const before = dispatchRuntimeHooks.mock.calls.find(call => call[0] === 'agent.before-handoff');
    expect(before?.[1].payload).toMatchObject({ contract, depth: 4 });
    expect(before?.[1].payload).not.toHaveProperty('isBigLoop');
    expect(before?.[1].payload).not.toHaveProperty('checkpointId');
    expect(listCheckpoints).not.toHaveBeenCalled();
    expect(readCheckpoint).not.toHaveBeenCalled();
  });

  it('rolls back after-handoff deny without persisting or leaving pendingHandoff', async () => {
    dispatchRuntimeHooks.mockImplementation(async (event) => event !== 'agent.after-handoff');
    const assembly = createAssembly();
    const handle = new TurnHandle({ sessionKey: 'session-a', turnId: 'turn-a', runId: 'run-a', generation: 1 });
    handle.eventSink = { sessionId: 'session-a', requestId: 'req-1' } as never;
    handle.runtimePlan = {
      projectRootPath: 'D:/project',
      profileHandoffs: [{ agent: 'general', label: 'Go', prompt: 'continue' }],
      enabledProfileIds: ['debugger', 'general'],
    } as never;
    const tool = assembly.createAgentHandoffTool('debugger', 'session-a', handle);
    const result = await tool.execute('tc-after-denied', { agent: 'general', contract: handoffContract('general'), prompt: 'continue', label: 'Go' });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'HOOK_DENIED: agent.after-handoff' });
    expect(createPreparedDraft).toHaveBeenCalled();
    expect(prepareHandoff).not.toHaveBeenCalled();
    expect(handle.pendingHandoff).toBeNull();
    expect(getActiveHandoff('session-a')).toBeNull();
    expect(abandonDraft).toHaveBeenCalledWith('session-a', 'handoff-1');
    expect(cancelHandoff).not.toHaveBeenCalled();
  });

  it('rolls back after-handoff throw without a durable prepared or pendingHandoff', async () => {
    dispatchRuntimeHooks.mockImplementation(async (event) => {
      if (event === 'agent.after-handoff') throw new Error('after-handoff failed');
      return true;
    });
    const assembly = createAssembly();
    const handle = new TurnHandle({ sessionKey: 'session-a', turnId: 'turn-a', runId: 'run-a', generation: 1 });
    handle.eventSink = { sessionId: 'session-a', requestId: 'req-1' } as never;
    handle.runtimePlan = {
      projectRootPath: 'D:/project',
      profileHandoffs: [{ agent: 'general', label: 'Go', prompt: 'continue' }],
      enabledProfileIds: ['debugger', 'general'],
    } as never;
    const tool = assembly.createAgentHandoffTool('debugger', 'session-a', handle);
    const result = await tool.execute('tc-hook-throw', { agent: 'general', contract: handoffContract('general'), prompt: 'continue', label: 'Go' });
    expect(result.isError).toBe(true);
    expect(createPreparedDraft).toHaveBeenCalled();
    expect(prepareHandoff).not.toHaveBeenCalled();
    expect(handle.pendingHandoff).toBeNull();
    expect(getActiveHandoff('session-a')).toBeNull();
    expect(abandonDraft).toHaveBeenCalledWith('session-a', 'handoff-1');
    expect(cancelHandoff).not.toHaveBeenCalled();
  });

  it('rolls back pendingHandoff when persist fails and leaves no active handoff', async () => {
    prepareHandoff.mockImplementationOnce(() => {
      throw new Error('HANDOFF_STATE_CONFLICT: disk full');
    });
    const assembly = createAssembly();
    const handle = new TurnHandle({ sessionKey: 'session-a', turnId: 'turn-a', runId: 'run-a', generation: 1 });
    handle.eventSink = { sessionId: 'session-a', requestId: 'req-1' } as never;
    handle.runtimePlan = {
      projectRootPath: 'D:/project',
      profileHandoffs: [{ agent: 'general', label: 'Go', prompt: 'continue' }],
      enabledProfileIds: ['debugger', 'general'],
    } as never;
    const tool = assembly.createAgentHandoffTool('debugger', 'session-a', handle);
    const result = await tool.execute('tc-persist-fail', { agent: 'general', contract: handoffContract('general'), prompt: 'continue', label: 'Go' });
    expect(result.isError).toBe(true);
    expect(createPreparedDraft).toHaveBeenCalled();
    expect(prepareHandoff).toHaveBeenCalled();
    expect(handle.pendingHandoff).toBeNull();
    expect(getActiveHandoff('session-a')).toBeNull();
    expect(abandonDraft).toHaveBeenCalledWith('session-a', 'handoff-1');
  });

  it('does not draft, bind, or persist when before-handoff is denied', async () => {
    dispatchRuntimeHooks.mockImplementation(async (event) => event !== 'agent.before-handoff');
    const assembly = createAssembly();
    const handle = new TurnHandle({ sessionKey: 'session-a', turnId: 'turn-a', runId: 'run-a', generation: 1 });
    handle.eventSink = { sessionId: 'session-a', requestId: 'req-1' } as never;
    handle.runtimePlan = {
      projectRootPath: 'D:/project',
      profileHandoffs: [{ agent: 'general', label: 'Go', prompt: 'continue' }],
      enabledProfileIds: ['debugger', 'general'],
    } as never;
    const tool = assembly.createAgentHandoffTool('debugger', 'session-a', handle);
    const result = await tool.execute('tc-denied', { agent: 'general', contract: handoffContract('general'), prompt: 'continue', label: 'Go' });
    expect(result.isError).toBe(true);
    expect(createPreparedDraft).not.toHaveBeenCalled();
    expect(prepareHandoff).not.toHaveBeenCalled();
    expect(handle.pendingHandoff).toBeNull();
  });

  it('rejects a second in-session prepare as ALREADY_ACTIVE without binding', async () => {
    getActiveHandoff.mockReturnValue({ handoffId: 'existing', lifecycle: 'prepared' });
    const assembly = createAssembly();
    const handle = new TurnHandle({ sessionKey: 'session-a', turnId: 'turn-a', runId: 'run-a', generation: 1 });
    handle.eventSink = { sessionId: 'session-a', requestId: 'req-1' } as never;
    handle.runtimePlan = {
      projectRootPath: 'D:/project',
      profileHandoffs: [{ agent: 'general', label: 'Go', prompt: 'continue' }],
      enabledProfileIds: ['debugger', 'general'],
    } as never;
    const tool = assembly.createAgentHandoffTool('debugger', 'session-a', handle);
    const result = await tool.execute('tc-second', { agent: 'general', contract: handoffContract('general'), prompt: 'continue', label: 'Go' });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringMatching(/HANDOFF_ALREADY_ACTIVE/) });
    expect(createPreparedDraft).not.toHaveBeenCalled();
    expect(prepareHandoff).not.toHaveBeenCalled();
    expect(handle.pendingHandoff).toBeNull();
  });

  it('rejects depth 6 before drafting or persisting', async () => {
    computeNextChain.mockReturnValueOnce({ chainRoot: 'root', depth: 6 });
    const assembly = createAssembly();
    const handle = new TurnHandle({ sessionKey: 'session-a', turnId: 'turn-a', runId: 'run-a', generation: 1 });
    handle.eventSink = { sessionId: 'session-a', requestId: 'req-1' } as never;
    handle.runtimePlan = {
      projectRootPath: 'D:/project',
      profileHandoffs: [{ agent: 'general', label: 'Go', prompt: 'continue' }],
      enabledProfileIds: ['debugger', 'general'],
    } as never;
    const tool = assembly.createAgentHandoffTool('debugger', 'session-a', handle);
    const result = await tool.execute('tc-depth', { agent: 'general', contract: handoffContract('general'), prompt: 'continue', label: 'Go' });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringMatching(/HANDOFF_CHAIN_LIMIT/) });
    expect(createPreparedDraft).not.toHaveBeenCalled();
    expect(prepareHandoff).not.toHaveBeenCalled();
    expect(handle.pendingHandoff).toBeNull();
  });

  it('fails closed on an illegal declaredModel without drafting', async () => {
    const assembly = createAssembly();
    const handle = new TurnHandle({ sessionKey: 'session-a', turnId: 'turn-a', runId: 'run-a', generation: 1 });
    handle.eventSink = { sessionId: 'session-a', requestId: 'req-1' } as never;
    handle.runtimePlan = {
      projectRootPath: 'D:/project',
      profileHandoffs: [{
        agent: 'general',
        label: 'Go',
        prompt: 'continue',
        model: 'internal-provider:hidden',
      }],
      enabledProfileIds: ['debugger', 'general'],
    } as never;
    const tool = assembly.createAgentHandoffTool('debugger', 'session-a', handle);
    const result = await tool.execute('tc-model', { agent: 'general', contract: handoffContract('general'), prompt: 'continue', label: 'Go' });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringMatching(/HANDOFF_MODEL_INVALID/) });
    expect(createPreparedDraft).not.toHaveBeenCalled();
    expect(prepareHandoff).not.toHaveBeenCalled();
    expect(handle.pendingHandoff).toBeNull();
  });

  it('hides rdx-cli-shell from Mission skills catalog and skill_read', async () => {
    const assembly = createAssembly();
    for (const mission of ['debugger', 'analyzer', 'optimizer'] as const) {
      const catalog = assembly.createSkillsCatalogTool(mission);
      const listed = await catalog.execute('tc-skills', {});
      const listedText = listed.content[0] && 'text' in listed.content[0] ? listed.content[0].text : '';
      expect(listedText).not.toMatch(/rdx-cli-shell/);
      const searched = await catalog.execute('tc-skills-q', { query: 'rdx-cli-shell' });
      const searchedText = searched.content[0] && 'text' in searched.content[0] ? searched.content[0].text : '';
      expect(searchedText).toMatch(/No configured skills matched the query/);
      expect(searched.details).toMatchObject({ count: 0 });
      const read = await assembly.createSkillReadTool(mission).execute('tc-skill-read', { skill_id: 'rdx-cli-shell' });
      expect(read.isError).toBe(true);
      expect(read.content[0]).toMatchObject({
        type: 'text',
        text: expect.stringMatching(/Skill is not configured: rdx-cli-shell/),
      });
    }
    const generalCatalog = await assembly.createSkillsCatalogTool('general').execute('tc-skills-general', {
      query: 'rdx-cli-shell',
    });
    const generalText = generalCatalog.content[0] && 'text' in generalCatalog.content[0]
      ? generalCatalog.content[0].text
      : '';
    expect(generalText).toMatch(/rdx-cli-shell/);
    expect(generalCatalog.details).toMatchObject({ count: 1 });
    const generalRead = await assembly.createSkillReadTool('general').execute('tc-skill-read-general', {
      skill_id: 'rdx-cli-shell',
    });
    expect(generalRead.isError).not.toBe(true);
    expect(generalRead.details).toMatchObject({ skillId: 'rdx-cli-shell', agentId: 'general' });
    expect(generalRead.content[0]).toMatchObject({ type: 'text', text: expect.stringMatching(/shell/) });
  });
});
