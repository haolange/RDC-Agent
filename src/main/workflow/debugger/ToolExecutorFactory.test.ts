import { registerPolicyBudgetObserver } from './DelegationBudget';
import { createPolicyBudgetState } from './TurnCoordinator';
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

vi.mock('../../settings/SettingsService', () => ({
  settingsService: {
    getAll: () => ({
      agents: { definitions: [{ id: 'ask', enabled: true, skills: [] }] },
      agentRuntime: { permissions: { mode: 'default' } },
    }),
  },
}));

vi.mock('../../settings/AgentRuntimeConfigService', () => ({
  agentRuntimeConfigService: {
    loadSkill: () => null,
  },
}));

vi.mock('../../agent-runtime/core/ToolValidator', () => ({
  ToolValidationError: class ToolValidationError extends Error {},
  toolValidator: {
    validate: (_definition: unknown, args: Record<string, unknown> = {}) => args,
  },
}));

const { hookTrigger } = vi.hoisted(() => ({
  hookTrigger: vi.fn(async () => [] as Array<{ allowed: boolean; status: string }>),
}));
vi.mock('../../hooks/HookEngine', () => ({
  hookEngine: {
    load: vi.fn(),
    trigger: hookTrigger,
    run: async () => ({ continue: true }),
  },
}));

vi.mock('../../runtime/AppPathService', () => ({
  appPathService: {
    getUserRdcPaths: () => ({
      hooksPath: 'D:/hooks',
      instructionsPath: 'D:/instructions',
    }),
    getRuntimePaths: () => ({
      appStateRoot: process.env.TEMP ?? process.cwd(),
    }),
    getAppPath: () => process.cwd(),
  },
}));

vi.mock('../../sessions/StorageAdapter', () => ({
  storageAdapter: {
    getSessionAttachmentsDir: () => 'D:/sessions/session-a/attachments',
  },
}));

vi.mock('../../agent-runtime/permissions/AgentPermissionPolicy', () => ({
  agentPermissionPolicyService: {
    evaluate: () => ({ action: 'allow' }),
  },
}));

vi.mock('../../agent-runtime/permissions/AgentToolApprovalRequestService', () => ({
  agentToolApprovalRequestService: {
    requestApproval: async () => ({ approved: true }),
  },
}));

vi.mock('../../agent-runtime/interactions/AgentUserInputRequestService', () => ({
  agentUserInputRequestService: {},
}));

vi.mock('../../agent-runtime/interactions/AgentPlanReviewRequestService', () => ({
  agentPlanReviewRequestService: {},
}));

import { ToolExecutorFactory } from './ToolExecutorFactory';
import type { AgentSlotRegistry } from './AgentSlotRegistry';
import type { DeferredToolActivationTracker } from './DeferredToolActivationTracker';

describe('ToolExecutorFactory', () => {
  it('activateDeferredTools no-ops without activation or tools', () => {
    const activate = vi.fn();
    const factory = new ToolExecutorFactory({
      slots: { getSlot: () => null } as unknown as AgentSlotRegistry,
      deferredActivation: { activate } as unknown as DeferredToolActivationTracker,
      getActiveTurn: () => null,
      resolveRuntimeTools: () => ({ toolMap: new Map(), definitions: [], deferredDefinitions: [] }),
      isAllowedForRuntime: () => true,
      matchesToolAllowlist: () => true,
    });
    factory.activateDeferredTools([], 'sess');
    factory.activateDeferredTools(['mcp__x__y'], 'sess');
    expect(activate).not.toHaveBeenCalled();
  });

  it('activateDeferredTools injects when activation changes', () => {
    const activateDeferredTools = vi.fn();
    const activate = vi.fn(() => ({
      changed: true,
      injected: [{ name: 'mcp__x__y', description: '', parameters: { type: 'object', properties: {} } }],
    }));
    const factory = new ToolExecutorFactory({
      slots: {
        getSlot: () => ({
          activatedDeferredTools: new Set<string>(),
          agent: { activateDeferredTools },
        }),
      } as unknown as AgentSlotRegistry,
      deferredActivation: { activate } as unknown as DeferredToolActivationTracker,
      getActiveTurn: () => ({
        deferredActivation: {
          slotKey: 'slot-1',
          allDefinitions: [],
        },
      }) as never,
      resolveRuntimeTools: () => ({ toolMap: new Map(), definitions: [], deferredDefinitions: [] }),
      isAllowedForRuntime: () => true,
      matchesToolAllowlist: () => true,
    });
    factory.activateDeferredTools(['mcp__x__y'], 'sess');
    expect(activate).toHaveBeenCalled();
    expect(activateDeferredTools).toHaveBeenCalled();
  });

  it('createToolExecutor denies unknown tools via policy path', async () => {
    const factory = new ToolExecutorFactory({
      slots: { getSlot: () => null } as unknown as AgentSlotRegistry,
      deferredActivation: { activate: vi.fn() } as unknown as DeferredToolActivationTracker,
      getActiveTurn: () => null,
      resolveRuntimeTools: () => ({ toolMap: new Map(), definitions: [], deferredDefinitions: [] }),
      isAllowedForRuntime: () => false,
      matchesToolAllowlist: () => true,
    });
    const executor = factory.createToolExecutor('ask', ['read_file']);
    const result = await executor.execute({
      type: 'toolCall',
      id: 'tc-1',
      name: 'read_file',
      arguments: {},
    });
    expect(result).toMatchObject({
      toolCallId: 'tc-1',
      isError: true,
    });
  });

  it('createToolExecutor denies tools listed in compiled policy', async () => {
    const toolMap = new Map([
      ['shell', {
        name: 'shell',
        description: 'shell',
        parameters: { type: 'object', properties: {} },
        execute: vi.fn(async () => ({ content: [] })),
      }],
    ]);
    const factory = new ToolExecutorFactory({
      slots: { getSlot: () => null } as unknown as AgentSlotRegistry,
      deferredActivation: { activate: vi.fn() } as unknown as DeferredToolActivationTracker,
      getActiveTurn: () => null,
      resolveRuntimeTools: () => ({ toolMap, definitions: [], deferredDefinitions: [] }),
      isAllowedForRuntime: () => true,
      matchesToolAllowlist: () => true,
    });
    const executor = factory.createToolExecutor('ask', ['shell'], null, {
      effectivePlan: {
        toolAllowlist: ['shell'],
        skillIntersection: null,
        permissionSettings: {
          mode: 'default',
          readableRoots: [],
          writableRoots: [],
          allowedCommandPrefixes: [],
          deniedCommandPrefixes: [],
        },
        policy: { deniedTools: ['shell'], limits: { maxTurns: 5 } },
        projectId: null,
        projectRootPath: null,
      } as never,
    });
    const result = await executor.execute({
      type: 'toolCall',
      id: 'tc-policy',
      name: 'shell',
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toMatch(/POLICY_DENIED|denied/i);
    expect(hookTrigger).toHaveBeenCalledWith(
      'permission.denied',
      expect.objectContaining({
        event: 'permission.denied',
        agentId: 'ask',
        toolName: 'shell',
      }),
    );
  });

  it('createToolExecutor denies tools outside skill intersection', async () => {
    const toolMap = new Map([
      ['shell', {
        name: 'shell',
        description: 'shell',
        parameters: { type: 'object', properties: {} },
        execute: vi.fn(async () => ({ content: [] })),
      }],
    ]);
    const factory = new ToolExecutorFactory({
      slots: { getSlot: () => null } as unknown as AgentSlotRegistry,
      deferredActivation: { activate: vi.fn() } as unknown as DeferredToolActivationTracker,
      getActiveTurn: () => null,
      resolveRuntimeTools: () => ({ toolMap, definitions: [], deferredDefinitions: [] }),
      isAllowedForRuntime: () => true,
      matchesToolAllowlist: () => false,
    });
    const executor = factory.createToolExecutor('ask', ['shell'], null, {
      effectivePlan: {
        toolAllowlist: ['shell'],
        skillIntersection: ['read_file'],
        permissionSettings: {
          mode: 'default',
          readableRoots: [],
          writableRoots: [],
          allowedCommandPrefixes: [],
          deniedCommandPrefixes: [],
        },
        policy: { deniedTools: [], limits: { maxTurns: 5 } },
        projectId: null,
        projectRootPath: null,
      } as never,
    });
    const result = await executor.execute({
      type: 'toolCall',
      id: 'tc-skill',
      name: 'shell',
      arguments: {},
    });
    expect(result.isError).toBe(true);
  });

  it('createToolExecutor fails closed for inactive deferred tools', async () => {
    const toolMap = new Map([
      ['mcp__x__y', {
        name: 'mcp__x__y',
        description: 'mcp',
        parameters: { type: 'object', properties: {} },
        execute: vi.fn(async () => ({ content: [] })),
      }],
    ]);
    const factory = new ToolExecutorFactory({
      slots: {
        getSlot: () => ({
          activatedDeferredTools: new Set<string>(),
        }),
      } as unknown as AgentSlotRegistry,
      deferredActivation: { activate: vi.fn() } as unknown as DeferredToolActivationTracker,
      getActiveTurn: () => ({
        deferredActivation: { slotKey: 'slot-1', allDefinitions: [] },
      }) as never,
      resolveRuntimeTools: () => ({ toolMap, definitions: [], deferredDefinitions: [] }),
      isAllowedForRuntime: () => true,
      matchesToolAllowlist: () => true,
    });
    const executor = factory.createToolExecutor('ask', ['mcp__x__y']);
    const result = await executor.execute({
      type: 'toolCall',
      id: 'tc-deferred',
      name: 'mcp__x__y',
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toMatch(/TOOL_NOT_ACTIVATED/);
  });

  it('executes a task tool preactivated by the frozen runtime plan', async () => {
    const execute = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'created' }],
      details: { taskId: 'task-1' },
    }));
    const toolMap = new Map([['task_create', {
      name: 'task_create',
      description: 'create task',
      parameters: { type: 'object', properties: {} },
      execute,
    }]]);
    const factory = new ToolExecutorFactory({
      slots: { getSlot: () => null } as unknown as AgentSlotRegistry,
      deferredActivation: { activate: vi.fn() } as unknown as DeferredToolActivationTracker,
      getActiveTurn: () => null,
      resolveRuntimeTools: () => ({ toolMap, definitions: [], deferredDefinitions: [] }),
      isAllowedForRuntime: () => true,
      matchesToolAllowlist: () => true,
    });
    const executor = factory.createToolExecutor('plan', ['task_create'], 'session-1', {
      effectivePlan: {
        toolAllowlist: ['task_create'],
        activatedDeferredTools: ['task_create'],
        skillIntersection: null,
        permissionSettings: {
          mode: 'default',
          readableRoots: [],
          writableRoots: [],
          allowedCommandPrefixes: [],
          deniedCommandPrefixes: [],
        },
        policy: { deniedTools: [], limits: { maxTurns: 5 } },
        projectId: null,
        projectRootPath: null,
      } as never,
    });
    const result = await executor.execute({
      type: 'toolCall',
      id: 'tc-task-create',
      name: 'task_create',
      arguments: {},
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(result.isError).not.toBe(true);
  });

  it('enforces the frozen maxToolCalls and wall-clock policy budget before execution', async () => {
    const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }));
    const toolMap = new Map([['read_file', {
      name: 'read_file', description: 'read', parameters: { type: 'object', properties: {} }, execute,
    }]]);
    const factory = new ToolExecutorFactory({
      slots: { getSlot: () => null } as unknown as AgentSlotRegistry,
      deferredActivation: { activate: vi.fn() } as unknown as DeferredToolActivationTracker,
      getActiveTurn: () => null,
      resolveRuntimeTools: () => ({ toolMap, definitions: [], deferredDefinitions: [] }),
      isAllowedForRuntime: () => true,
      matchesToolAllowlist: () => true,
    });
    const budget = { toolCalls: 0, subagents: 0, childDepth: 0, wallStartedAt: Date.now(), maxToolCalls: 1, maxSubagents: 3, maxChildDepth: 3, maxWallTimeMs: 60_000 };
    const executor = factory.createToolExecutor('ask', ['read_file'], null, {
      effectivePlan: { toolAllowlist: ['read_file'], skillIntersection: null, projectId: null, projectRootPath: null } as never,
      policyBudget: budget,
    });
    const first = await executor.execute({ type: 'toolCall', id: 'first', name: 'read_file', arguments: {} });
    const second = await executor.execute({ type: 'toolCall', id: 'second', name: 'read_file', arguments: {} });
    expect(first.isError).not.toBe(true);
    expect(second).toMatchObject({ isError: true, details: { code: 'POLICY_LIMIT_EXCEEDED', limit: 'maxToolCalls' } });
    expect(execute).toHaveBeenCalledOnce();

    const expired = { ...budget, toolCalls: 0, wallStartedAt: Date.now() - 100, maxWallTimeMs: 1 };
    const expiredExecutor = factory.createToolExecutor('ask', ['read_file'], null, {
      effectivePlan: { toolAllowlist: ['read_file'], skillIntersection: null, projectId: null, projectRootPath: null } as never,
      policyBudget: expired,
    });
    await expect(expiredExecutor.execute({ type: 'toolCall', id: 'expired', name: 'read_file', arguments: {} })).resolves.toMatchObject({
      isError: true, details: { code: 'POLICY_LIMIT_EXCEEDED', limit: 'maxWallTimeMs' },
    });
  });

  it('createToolExecutor runs allowed tool from map', async () => {
    const execute = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
      details: { ok: true },
    }));
    const toolMap = new Map([
      ['read_file', {
        name: 'read_file',
        description: 'read',
        parameters: { type: 'object', properties: {} },
        execute,
      }],
    ]);
    const factory = new ToolExecutorFactory({
      slots: { getSlot: () => null } as unknown as AgentSlotRegistry,
      deferredActivation: { activate: vi.fn() } as unknown as DeferredToolActivationTracker,
      getActiveTurn: () => null,
      resolveRuntimeTools: () => ({ toolMap, definitions: [], deferredDefinitions: [] }),
      isAllowedForRuntime: () => true,
      matchesToolAllowlist: () => true,
    });
    const executor = factory.createToolExecutor('ask', ['read_file'], null, {
      effectivePlan: {
        toolAllowlist: ['read_file'],
        skillIntersection: ['read_file'],
        permissionSettings: {
          mode: 'default',
          readableRoots: [],
          writableRoots: [],
          allowedCommandPrefixes: [],
          deniedCommandPrefixes: [],
        },
        policy: { deniedTools: [], limits: { maxTurns: 5 } },
        projectId: null,
        projectRootPath: null,
      } as never,
    });
    const result = await executor.execute({
      type: 'toolCall',
      id: 'tc-2',
      name: 'read_file',
      arguments: { path: 'a.txt' },
    });
    expect(execute).toHaveBeenCalled();
    expect(result.isError).not.toBe(true);
  });

  it('classifies concurrency and reserves a group atomically so none start on failure', () => {
    const read = {
      name: 'read_file',
      description: 'read',
      parameters: { type: 'object', properties: {} },
      spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: 'none' as const, category: 'file' as const, requiresApproval: false },
      execute: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })),
    };
    const shell = {
      name: 'shell',
      description: 'shell',
      parameters: { type: 'object', properties: {} },
      spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: true, sideEffect: 'process' as const, category: 'system' as const, requiresApproval: true },
      execute: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })),
    };
    const factory = new ToolExecutorFactory({
      slots: { getSlot: () => null } as unknown as AgentSlotRegistry,
      deferredActivation: { activate: vi.fn() } as unknown as DeferredToolActivationTracker,
      getActiveTurn: () => null,
      resolveRuntimeTools: () => ({
        toolMap: new Map([['read_file', read], ['shell', shell]] as never),
        definitions: [],
        deferredDefinitions: [],
      }),
      isAllowedForRuntime: () => true,
      matchesToolAllowlist: () => true,
    });
    const budget = {
      toolCalls: 0,
      subagents: 0,
      childDepth: 0,
      wallStartedAt: Date.now(),
      maxToolCalls: 1,
      maxSubagents: 3,
      maxChildDepth: 3,
      maxWallTimeMs: 60_000,
    };
    const executor = factory.createToolExecutor('ask', ['read_file', 'shell'], null, {
      effectivePlan: { toolAllowlist: ['read_file', 'shell'], skillIntersection: null, projectId: null, projectRootPath: null } as never,
      policyBudget: budget,
    });
    expect(executor.isConcurrencySafe?.({ type: 'toolCall', id: 'r1', name: 'read_file', arguments: {} })).toBe(true);
    expect(executor.isConcurrencySafe?.({ type: 'toolCall', id: 's1', name: 'shell', arguments: { command: 'echo' } })).toBe(false);
    expect(executor.isConcurrencySafe?.({
      type: 'toolCall',
      id: 'off',
      name: 'subagent',
      arguments: {  },
    })).toBe(false); // absent tool metadata never grants concurrent dispatch
    expect(executor.isConcurrencySafe?.({
      type: 'toolCall',
      id: 'live',
      name: 'subagent',
      arguments: { domainExtensions: { rdc: { requiresLease: true } } },
    })).toBe(false);
    expect(executor.reserveDispatchBudget?.([
      { type: 'toolCall', id: 'g1', name: 'read_file', arguments: {} },
      { type: 'toolCall', id: 'g2', name: 'read_file', arguments: {} },
    ])).toEqual({ ok: false, limit: 'maxToolCalls' });
    expect(budget.toolCalls).toBe(0);
    expect(read.execute).not.toHaveBeenCalled();
  });

  it('fail-closes a direct shell invoke for debugger even when the tool map still has shell', async () => {
    const execute = vi.fn(async () => ({ content: [{ type: 'text', text: 'ran' }] }));
    const factory = new ToolExecutorFactory({
      slots: { getSlot: () => null } as unknown as AgentSlotRegistry,
      deferredActivation: { activate: vi.fn() } as unknown as DeferredToolActivationTracker,
      getActiveTurn: () => null,
      resolveRuntimeTools: () => ({
        toolMap: new Map([
          ['shell', {
            name: 'shell',
            description: 'shell',
            parameters: { type: 'object', properties: { command: { type: 'string' } } },
            execute,
          } as never],
        ]),
        definitions: [],
        deferredDefinitions: [],
      }),
      isAllowedForRuntime: (agentId, toolName) => agentId !== 'debugger' || toolName !== 'shell',
      matchesToolAllowlist: () => true,
    });
    const executor = factory.createToolExecutor('debugger', ['shell']);
    const result = await executor.execute({
      type: 'toolCall',
      id: 'tc-mission-shell',
      name: 'shell',
      arguments: { command: 'echo bypass' },
    });
    expect(result.isError).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it('injects knowledgeReadRoots only for the four read-only file tools', async () => {
    const knowledgeRoot = 'D:/Users/me/.rdc-agent/knowledge';
    const seen = new Map<string, readonly string[] | undefined>();
    const makeTool = (name: string) => ({
      name,
      description: name,
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async (_id: string, _args: unknown, _signal?: AbortSignal, _onUpdate?: unknown, context?: { temporaryAllowedPathRoots?: readonly string[] }) => {
        seen.set(name, context?.temporaryAllowedPathRoots);
        return { content: [{ type: 'text' as const, text: 'ok' }] };
      }),
    });
    const tools = [
      'read_file',
      'read_image',
      'glob',
      'grep',
      'write_file',
      'edit_file',
      'delete_file',
      'shell',
      'code_interpreter',
    ].map((name) => [name, makeTool(name)] as const);
    const factory = new ToolExecutorFactory({
      slots: { getSlot: () => null } as unknown as AgentSlotRegistry,
      deferredActivation: { activate: vi.fn() } as unknown as DeferredToolActivationTracker,
      getActiveTurn: () => null,
      resolveRuntimeTools: () => ({
        toolMap: new Map(tools as never),
        definitions: [],
        deferredDefinitions: [],
      }),
      isAllowedForRuntime: () => true,
      matchesToolAllowlist: () => true,
    });
    const executor = factory.createToolExecutor('ask', tools.map(([name]) => name), null, {
      effectivePlan: {
        toolAllowlist: tools.map(([name]) => name),
        skillIntersection: null,
        knowledgeReadRoots: [knowledgeRoot],
        permissionSettings: {
          mode: 'default',
          readableRoots: [],
          writableRoots: [],
          allowedCommandPrefixes: [],
          deniedCommandPrefixes: [],
        },
        policy: { deniedTools: [], limits: { maxTurns: 5 } },
        projectId: null,
        projectRootPath: 'D:/Project',
      } as never,
    });
    for (const [name] of tools) {
      await executor.execute({
        type: 'toolCall',
        id: `tc-${name}`,
        name,
        arguments: name === 'shell' ? { command: 'echo ok' } : { path: 'a.txt' },
      });
    }
    for (const name of ['read_file', 'read_image', 'glob', 'grep']) {
      expect(seen.get(name)).toContain(knowledgeRoot);
    }
    for (const name of ['write_file', 'edit_file', 'delete_file', 'shell', 'code_interpreter']) {
      expect(seen.get(name) ?? []).not.toContain(knowledgeRoot);
    }
  });

  it('executes real primitives: read_file rejects knowledge junction escape and write_file cannot use knowledge roots', async () => {
    const { mkdtemp, mkdir, writeFile, symlink, rm } = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { readFileTool } = await import('../../agent-runtime/tools/primitives/ReadFileTool');
    const { writeFileTool } = await import('../../agent-runtime/tools/primitives/WriteFileTool');
    const userRdc = await mkdtemp(path.join(os.tmpdir(), 'rdc-kn-exec-'));
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'rdc-kn-exec-ws-'));
    const knowledge = path.join(userRdc, 'knowledge');
    const memory = path.join(userRdc, 'memory');
    await mkdir(knowledge, { recursive: true });
    await mkdir(memory, { recursive: true });
    await writeFile(path.join(memory, 'secret.md'), 'leak', 'utf8');
    await writeFile(path.join(knowledge, 'card.md'), 'keep', 'utf8');
    const planted = path.join(knowledge, 'escape');
    let junctionReady = true;
    try {
      await symlink(memory, planted, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      junctionReady = false;
    }
    const factory = new ToolExecutorFactory({
      slots: { getSlot: () => null } as unknown as AgentSlotRegistry,
      deferredActivation: { activate: vi.fn() } as unknown as DeferredToolActivationTracker,
      getActiveTurn: () => null,
      resolveRuntimeTools: () => ({
        toolMap: new Map([
          ['read_file', readFileTool],
          ['write_file', writeFileTool],
        ] as never),
        definitions: [],
        deferredDefinitions: [],
      }),
      isAllowedForRuntime: () => true,
      matchesToolAllowlist: () => true,
    });
    const executor = factory.createToolExecutor('ask', ['read_file', 'write_file'], null, {
      effectivePlan: {
        toolAllowlist: ['read_file', 'write_file'],
        skillIntersection: null,
        knowledgeReadRoots: [knowledge],
        permissionSettings: {
          mode: 'default',
          readableRoots: [],
          writableRoots: [],
          allowedCommandPrefixes: [],
          deniedCommandPrefixes: [],
        },
        policy: { deniedTools: [], limits: { maxTurns: 5 } },
        projectId: 'proj',
        projectRootPath: workspace,
      } as never,
    });
    try {
      if (junctionReady) {
        const readResult = await executor.execute({
          type: 'toolCall',
          id: 'tc-read-junc',
          name: 'read_file',
          arguments: { path: path.join(planted, 'secret.md') },
        });
        expect(readResult.isError).toBe(true);
        expect(JSON.stringify(readResult)).toMatch(/SYMLINK_PATH_REJECTED/);
      }
      const writeResult = await executor.execute({
        type: 'toolCall',
        id: 'tc-write-kn',
        name: 'write_file',
        arguments: { path: path.join(knowledge, 'card.md'), content: 'overwrite' },
      });
      expect(writeResult.isError).toBe(true);
      expect(JSON.stringify(writeResult)).toMatch(/超出 workspace/);
    } finally {
      await Promise.all([rm(userRdc, { recursive: true, force: true }), rm(workspace, { recursive: true, force: true })]);
    }
  });
});

it('passes the frozen native vision capability into the production tool context', async () => {
 const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }));
 const toolMap = new Map([['artifact_read', { name: 'artifact_read', description: 'read', parameters: { type: 'object', properties: {} }, execute }]]);
 const factory = new ToolExecutorFactory({ slots: { getSlot: () => null } as unknown as AgentSlotRegistry, deferredActivation: { activate: vi.fn() } as unknown as DeferredToolActivationTracker, getActiveTurn: () => null, resolveRuntimeTools: () => ({ toolMap, definitions: [], deferredDefinitions: [] }), isAllowedForRuntime: () => true, matchesToolAllowlist: () => true });
 for (const visionInputMode of ['native', 'disabled'] as const) {
  const executor = factory.createToolExecutor('general', ['artifact_read'], 'vision-session', { effectivePlan: { toolAllowlist: ['artifact_read'], skillIntersection: null, projectId: null, projectRootPath: null, routeCapability: { visionInputMode } } as never });
  await executor.execute({ type: 'toolCall', id: visionInputMode, name: 'artifact_read', arguments: {} });
  expect(execute).toHaveBeenLastCalledWith(visionInputMode, {}, undefined, undefined, expect.objectContaining({ visionInputMode }));
 }
});

it('durably saves reserved cost before effects and rejects effects when durable accounting fails', async () => {
 const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }));
 const toolMap = new Map([['read_file', { name: 'read_file', description: 'read', parameters: { type: 'object', properties: {} }, execute }]]);
 const factory = new ToolExecutorFactory({ slots: { getSlot: () => null } as unknown as AgentSlotRegistry, deferredActivation: { activate: vi.fn() } as unknown as DeferredToolActivationTracker, getActiveTurn: () => null, resolveRuntimeTools: () => ({ toolMap, definitions: [], deferredDefinitions: [] }), isAllowedForRuntime: () => true, matchesToolAllowlist: () => true });
 const ledger = createPolicyBudgetState(); let release!: () => void; const persisted: number[] = [];
 const gate = new Promise<void>((resolve) => { release = resolve; });
 const unregister = registerPolicyBudgetObserver(ledger, async (snapshot) => { await gate; persisted.push(snapshot.toolCalls); });
 const executor = factory.createToolExecutor('general', ['read_file'], null, { effectivePlan: { toolAllowlist: ['read_file'], skillIntersection: null, projectId: null, projectRootPath: null } as never, policyBudget: ledger });
 const call = { type: 'toolCall' as const, id: 'persisted', name: 'read_file', arguments: {} };
 executor.reserveDispatchBudget?.([call]);
 const running = executor.execute(call);
 await Promise.resolve(); expect(execute).not.toHaveBeenCalled(); release(); await running;
 expect(persisted).toEqual([1]); expect(execute).toHaveBeenCalledOnce(); unregister();
 const fail = registerPolicyBudgetObserver(ledger, async () => { throw new Error('durable budget unavailable'); });
 await expect(executor.execute({ ...call, id: 'failed-save' })).rejects.toThrow('durable budget unavailable');
 expect(execute).toHaveBeenCalledOnce(); expect(ledger.toolCalls).toBe(2); fail();
});

describe('ToolExecutorFactory plan_artifact gate', () => {
  const planTool = {
    name: 'plan_artifact',
    description: 'plan',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ content: [{ type: 'text' as const, text: 'stub' }] }),
  };

  function createFactory() {
    return new ToolExecutorFactory({
      slots: { getSlot: () => null } as unknown as AgentSlotRegistry,
      deferredActivation: { activate: vi.fn() } as unknown as DeferredToolActivationTracker,
      getActiveTurn: () => null,
      resolveRuntimeTools: () => ({
        toolMap: new Map([['plan_artifact', planTool]]),
        definitions: [],
        deferredDefinitions: [],
      }),
      isAllowedForRuntime: () => true,
      matchesToolAllowlist: () => true,
    });
  }

  it('fails closed when the profile has no continue handoff', async () => {
    const executor = createFactory().createToolExecutor('debugger', ['plan_artifact'], 'sess', {
      sessionId: 'sess',
      turnId: 'turn-1',
      eventContext: { sessionId: 'sess', requestId: 'req-1' },
      effectivePlan: {
        toolAllowlist: ['plan_artifact'],
        skillIntersection: ['plan_artifact'],
        activatedDeferredTools: ['plan_artifact'],
        profileHandoffs: [{ agent: 'general', label: 'Execute', prompt: 'go', showContinueOn: false }],
        projectId: null,
        projectRootPath: null,
      },
    } as never);
    const result = await executor.execute({
      type: 'toolCall',
      id: 'tc-plan',
      name: 'plan_artifact',
      arguments: { title: 'Plan', summary: ['Goal'], content: '## Goal\nFind it.' },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/PLAN_REVIEW_NO_HANDOFF/);
  });
});

it('keeps private file-read state across turns and agent switches, isolates and releases scopes', async () => {
  const seen: Set<string>[] = [];
  const tool = { name: 'read_file', description: 'read', parameters: { type: 'object', properties: {} },
    execute: async (_id: string, _args: unknown, _signal: unknown, _update: unknown, context?: import('../../agent-runtime/agent/AgentTool').ToolExecutionContext) => {
      seen.push(context!.successfulFileReads!);
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    } };
  const make = () => new ToolExecutorFactory({
    slots: { getSlot: () => null } as unknown as AgentSlotRegistry,
    deferredActivation: { activate: vi.fn() } as unknown as DeferredToolActivationTracker,
    getActiveTurn: () => null,
    resolveRuntimeTools: () => ({ toolMap: new Map([['read_file', tool]]), definitions: [], deferredDefinitions: [] }),
    isAllowedForRuntime: () => true, matchesToolAllowlist: () => true,
  });
  const factory = make();
  const run = async (session: string, agent = 'general', owner = factory) => {
    const executor = owner.createToolExecutor(agent, ['read_file'], session);
    const result = await executor.execute({ type: 'toolCall', id: 'read-' + seen.length, name: 'read_file', arguments: {} });
    expect(result.isError).not.toBe(true);
    return seen.at(-1)!;
  };
  const first = await run('a'); first.add('realpath');
  expect(await run('a', 'analyzer')).toBe(first);
  expect((await run('b')).has('realpath')).toBe(false);
  const child = await run('a::subagent::child'); child.add('child-path');
  expect(child).not.toBe(first);
  factory.releaseSession('a');
  expect((await run('a')).size).toBe(0);
  expect((await run('a::subagent::child')).size).toBe(0);
  expect((await run('a', 'general', make())).size).toBe(0);
});
