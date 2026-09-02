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
    validate: () => ({ ok: true, value: {} }),
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
    getUserRdxPaths: () => ({
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
      arguments: { requiresRdxLease: false },
    })).toBe(true);
    expect(executor.isConcurrencySafe?.({
      type: 'toolCall',
      id: 'live',
      name: 'subagent',
      arguments: { requiresRdxLease: true },
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
});
