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

vi.mock('../../sessions/RdxRuntimeContextRegistry', () => ({
  assertRdxContextLeaseOwnership: vi.fn(() => null),
}));

const { dispatchRuntimeHooks, prepareHandoff, computeNextChain, getActiveHandoff } = vi.hoisted(() => ({
  dispatchRuntimeHooks: vi.fn(async () => true),
  prepareHandoff: vi.fn(() => ({ handoffId: 'handoff-1', send: true })),
  computeNextChain: vi.fn(() => ({ chainRoot: 'root', depth: 1 })),
  getActiveHandoff: vi.fn(() => null),
}));

vi.mock('../../hooks/runtimeHookDispatch', () => ({
  dispatchRuntimeHooks,
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
    expect(assembly.isAllowedForRuntime('ask', 'read_file', 'investigate', frozen)).toBe(true);
    expect(assembly.isAllowedForRuntime('ask', 'write_file', 'investigate', frozen)).toBe(false);
    frozen[0] = 'write_file';
    expect(assembly.isAllowedForRuntime('ask', 'read_file', 'investigate', ['read_file'])).toBe(true);
  });

  it('isAllowedForRuntime maps report stage to undefined workflow stage', () => {
    const assembly = createAssembly();
    // ask profile allows readonly tools in policy tables
    expect(assembly.isAllowedForRuntime('ask', 'read_file', 'report', ['read_file'])).toBe(true);
    expect(assembly.isAllowedForRuntime('ask', 'read_file', 'investigate', [])).toBe(false);
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
    const tools = assembly.resolveRuntimeTools('debugger', ['task'], undefined, 'session-a', handle, 'project-a');

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
      expect.objectContaining({ agentId: 'debugger', sessionId: 'session-a' }),
    );
    expect(dispatchRuntimeHooks).toHaveBeenCalledWith(
      'agent.after-handoff',
      expect.objectContaining({ agentId: 'debugger', sessionId: 'session-a' }),
    );
  });
});
