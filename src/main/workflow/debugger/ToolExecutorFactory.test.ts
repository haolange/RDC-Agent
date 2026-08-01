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

vi.mock('../../hooks/HookEngine', () => ({
  hookEngine: {
    load: vi.fn(),
    trigger: async () => [],
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
      ['bash', {
        name: 'bash',
        description: 'bash',
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
    const executor = factory.createToolExecutor('ask', ['bash'], undefined, null, {
      effectivePlan: {
        toolAllowlist: ['bash'],
        skillIntersection: null,
        permissionSettings: {
          mode: 'default',
          readableRoots: [],
          writableRoots: [],
          allowedCommandPrefixes: [],
          deniedCommandPrefixes: [],
        },
        policy: { deniedTools: ['bash'], limits: { maxTurns: 5 } },
        projectId: null,
        projectRootPath: null,
      } as never,
    });
    const result = await executor.execute({
      type: 'toolCall',
      id: 'tc-policy',
      name: 'bash',
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toMatch(/POLICY_DENIED|denied/i);
  });

  it('createToolExecutor denies tools outside skill intersection', async () => {
    const toolMap = new Map([
      ['bash', {
        name: 'bash',
        description: 'bash',
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
    const executor = factory.createToolExecutor('ask', ['bash'], undefined, null, {
      effectivePlan: {
        toolAllowlist: ['bash'],
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
      name: 'bash',
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
    const executor = factory.createToolExecutor('plan', ['task_create'], undefined, 'session-1', {
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
    const executor = factory.createToolExecutor('ask', ['read_file'], undefined, null, {
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
});
