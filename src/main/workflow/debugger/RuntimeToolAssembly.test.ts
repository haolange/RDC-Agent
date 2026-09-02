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
}));

const {
  dispatchRuntimeHooks,
  prepareHandoff,
  computeNextChain,
  getActiveHandoff,
  listCheckpoints,
  readCheckpoint,
} = vi.hoisted(() => ({
  dispatchRuntimeHooks: vi.fn<(
    event: string,
    context: { payload?: Record<string, unknown> },
  ) => Promise<boolean>>(async () => true),
  prepareHandoff: vi.fn(() => ({ handoffId: 'handoff-1', send: true })),
  computeNextChain: vi.fn(() => ({ chainRoot: 'root', depth: 1 })),
  getActiveHandoff: vi.fn(() => null),
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
import { RuntimeToolAssembly } from './RuntimeToolAssembly';
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
  beforeEach(() => {
    dispatchRuntimeHooks.mockClear();
    prepareHandoff.mockClear();
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

  it('grants explicit output publication with the canonical task capability', () => {
    const assembly = createAssembly();
    const handle = new TurnHandle({ sessionKey: 'session-a', turnId: 'turn-a', runId: 'run-a', generation: 1 });
    const tools = assembly.resolveRuntimeTools('debugger', ['task'], 'session-a', handle, 'project-a');

    expect(tools.toolMap.has('output_register')).toBe(true);
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
    const result = await tool.execute('tc-handoff', { agent: 'general', prompt: 'continue', label: 'Go' });
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
          isBigLoop: false,
        },
      }),
    );
    expect(dispatchRuntimeHooks).toHaveBeenCalledWith(
      'agent.after-handoff',
      expect.objectContaining({ agentId: 'debugger', sessionId: 'session-a' }),
    );
  });

  it('passes a dereferenceable MissionCheckpoint id on Big Loop handoff and omits fabricated fields', async () => {
    computeNextChain.mockReturnValueOnce({ chainRoot: 'root', depth: 2 });
    listCheckpoints.mockReturnValueOnce([{
      artifactId: 'art-cp-1',
      kind: 'checkpoint',
      status: 'draft',
      recordKey: 'cp-1',
      createdAt: '2026-09-01T00:00:00.000Z',
    }]);
    readCheckpoint.mockReturnValueOnce({
      record: { checkpointId: 'cp-1' },
      manifest: { mission: 'debugger' },
    });
    const assembly = createAssembly();
    const handle = new TurnHandle({ sessionKey: 'session-b', turnId: 'turn-b', runId: 'run-b', generation: 1 });
    handle.eventSink = { sessionId: 'session-b', requestId: 'req-2' } as never;
    handle.runtimePlan = {
      projectRootPath: 'D:/project',
      profileHandoffs: [{ agent: 'debugger', label: 'Replan', prompt: 'Replan the mission.' }],
      enabledProfileIds: ['debugger', 'general'],
    } as never;
    const tool = assembly.createAgentHandoffTool('general', 'session-b', handle);
    const result = await tool.execute('tc-replan', { agent: 'debugger', prompt: 'Replan the mission.', label: 'Replan' });
    expect(result.isError).not.toBe(true);
    expect(listCheckpoints).toHaveBeenCalledWith('session-b', { kind: 'checkpoint' });
    expect(readCheckpoint).toHaveBeenCalledWith('session-b', 'art-cp-1');
    expect(dispatchRuntimeHooks).toHaveBeenCalledWith(
      'agent.before-handoff',
      expect.objectContaining({
        agentId: 'general',
        sessionId: 'session-b',
        payload: {
          fromAgentId: 'general',
          toAgentId: 'debugger',
          label: 'Replan',
          prompt: 'Replan the mission.',
          depth: 2,
          isBigLoop: true,
          checkpointId: 'cp-1',
        },
      }),
    );
    const beforeCall = dispatchRuntimeHooks.mock.calls.find((call) => call[0] === 'agent.before-handoff');
    expect(beforeCall?.[1].payload).not.toHaveProperty('loop');
    expect(beforeCall?.[1].payload).not.toHaveProperty('missionLoop');
    expect(beforeCall?.[1].payload).not.toHaveProperty('reasonForReplan');
  });

  it('does not invent a checkpointId when no MissionCheckpoint is persisted', async () => {
    computeNextChain.mockReturnValueOnce({ chainRoot: 'root', depth: 2 });
    listCheckpoints.mockReturnValueOnce([]);
    const assembly = createAssembly();
    const handle = new TurnHandle({ sessionKey: 'session-c', turnId: 'turn-c', runId: 'run-c', generation: 1 });
    handle.eventSink = { sessionId: 'session-c', requestId: 'req-3' } as never;
    handle.runtimePlan = {
      projectRootPath: 'D:/project',
      profileHandoffs: [{ agent: 'debugger', label: 'Replan', prompt: 'Replan the mission.' }],
      enabledProfileIds: ['debugger', 'general'],
    } as never;
    const tool = assembly.createAgentHandoffTool('general', 'session-c', handle);
    await tool.execute('tc-missing', { agent: 'debugger', prompt: 'Replan the mission.', label: 'Replan' });
    expect(dispatchRuntimeHooks).toHaveBeenCalledWith(
      'agent.before-handoff',
      expect.objectContaining({
        payload: {
          fromAgentId: 'general',
          toAgentId: 'debugger',
          label: 'Replan',
          prompt: 'Replan the mission.',
          depth: 2,
          isBigLoop: true,
        },
      }),
    );
    const beforeCall = dispatchRuntimeHooks.mock.calls.find((call) => call[0] === 'agent.before-handoff');
    expect(beforeCall?.[1].payload).not.toHaveProperty('checkpointId');
  });

  it('filters MissionCheckpoint by target mission and ignores a newer Debugger checkpoint', async () => {
    computeNextChain.mockReturnValueOnce({ chainRoot: 'root', depth: 2 });
    listCheckpoints.mockReturnValueOnce([
      {
        artifactId: 'art-cp-debugger',
        kind: 'checkpoint',
        status: 'draft',
        recordKey: 'cp-debugger',
        createdAt: '2026-09-01T02:00:00.000Z',
      },
      {
        artifactId: 'art-cp-analyzer',
        kind: 'checkpoint',
        status: 'draft',
        recordKey: 'cp-analyzer',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ]);
    readCheckpoint.mockImplementation((_sessionId, artifactId) => {
      if (artifactId === 'art-cp-debugger') {
        return { record: { checkpointId: 'cp-debugger' }, manifest: { mission: 'debugger' } };
      }
      return { record: { checkpointId: 'cp-analyzer' }, manifest: { mission: 'analyzer' } };
    });
    const assembly = createAssembly();
    const handle = new TurnHandle({ sessionKey: 'session-d', turnId: 'turn-d', runId: 'run-d', generation: 1 });
    handle.eventSink = { sessionId: 'session-d', requestId: 'req-4' } as never;
    handle.runtimePlan = {
      projectRootPath: 'D:/project',
      profileHandoffs: [{ agent: 'analyzer', label: 'Replan', prompt: 'Replan architecture.' }],
      enabledProfileIds: ['analyzer', 'general'],
    } as never;
    const tool = assembly.createAgentHandoffTool('general', 'session-d', handle);
    const result = await tool.execute('tc-mixed', { agent: 'analyzer', prompt: 'Replan architecture.', label: 'Replan' });
    expect(result.isError).not.toBe(true);
    expect(dispatchRuntimeHooks).toHaveBeenCalledWith(
      'agent.before-handoff',
      expect.objectContaining({
        payload: expect.objectContaining({
          toAgentId: 'analyzer',
          isBigLoop: true,
          checkpointId: 'cp-analyzer',
        }),
      }),
    );
    const beforeCall = dispatchRuntimeHooks.mock.calls.find((call) => call[0] === 'agent.before-handoff');
    expect(beforeCall?.[1].payload).not.toMatchObject({ checkpointId: 'cp-debugger' });
  });

  it('does not hand a Debugger checkpoint to Analyzer planning when no Analyzer checkpoint exists', async () => {
    computeNextChain.mockReturnValueOnce({ chainRoot: 'root', depth: 2 });
    listCheckpoints.mockReturnValueOnce([{
      artifactId: 'art-cp-debugger-only',
      kind: 'checkpoint',
      status: 'draft',
      recordKey: 'cp-debugger-only',
      createdAt: '2026-09-01T03:00:00.000Z',
    }]);
    readCheckpoint.mockReturnValueOnce({
      record: { checkpointId: 'cp-debugger-only' },
      manifest: { mission: 'debugger' },
    });
    const assembly = createAssembly();
    const handle = new TurnHandle({ sessionKey: 'session-e', turnId: 'turn-e', runId: 'run-e', generation: 1 });
    handle.eventSink = { sessionId: 'session-e', requestId: 'req-5' } as never;
    handle.runtimePlan = {
      projectRootPath: 'D:/project',
      profileHandoffs: [{ agent: 'analyzer', label: 'Replan', prompt: 'Replan architecture.' }],
      enabledProfileIds: ['analyzer', 'general'],
    } as never;
    const tool = assembly.createAgentHandoffTool('general', 'session-e', handle);
    await tool.execute('tc-no-analyzer-cp', { agent: 'analyzer', prompt: 'Replan architecture.', label: 'Replan' });
    const beforeCall = dispatchRuntimeHooks.mock.calls.find((call) => call[0] === 'agent.before-handoff');
    expect(beforeCall?.[1].payload).not.toHaveProperty('checkpointId');
  });
});
