import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.TEMP ?? process.env.TMP ?? process.cwd(),
    getAppPath: () => process.cwd(),
  },
}));

vi.mock('../../hooks/runtimeHookDispatch', () => ({
  dispatchRuntimeHooks: vi.fn(async () => true),
}));

vi.mock('../../settings/SettingsService', () => ({
  settingsService: {
    getAll: () => ({
      agents: {
        definitions: [
          { id: 'ask', enabled: true, maxTurns: 12 },
          { id: 'debugger', enabled: true },
          { id: 'edit', enabled: true, maxTurns: 0 },
        ],
      },
    }),
  },
}));

import { dispatchRuntimeHooks } from '../../hooks/runtimeHookDispatch';
import { AgentTurnRunner, hasActualProviderUsage, shouldWarnEmptyAssistantCompletion } from './AgentTurnRunner';
import { resolveExecutionScopeId } from './executionScope';
import { TokenizerService } from '../../agent-runtime/core/TokenizerService';
import type { AssistantMessage, ToolResultMessage } from '../../agent-runtime/core/types';
import type { RequestPlan } from '@shared/types/providerCapability';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';
import type { AgentSlotRegistry } from './AgentSlotRegistry';
import type { DeferredToolActivationTracker } from './DeferredToolActivationTracker';
import type { McpConnectionCoordinator, McpConnectionLease } from './McpConnectionCoordinator';
import type { PreparedAgentRuntime } from './orchestratorTypes';
import type { EffectiveRuntimePlan } from '../../agent-runtime/EffectiveRuntimePlan';
import type { AgentRouteCapability } from '@shared/types/agentRuntime';
import type { PromptPlan } from '@shared/types/rdcRuntime';
import { turnCoordinator } from './TurnCoordinator';

function createRunner(): AgentTurnRunner {
  return new AgentTurnRunner({
    validateCompletion: () => undefined,
    slots: {} as AgentSlotRegistry,
    mcp: {} as McpConnectionCoordinator,
    deferredActivation: {
      resolveActivatedSet: () => new Set<string>(),
    } as unknown as DeferredToolActivationTracker,
    tokenizerService: new TokenizerService(),
    sessionTurnKey: (sessionId) => resolveExecutionScopeId(sessionId),
    resolveRuntimeTools: () => ({ toolMap: new Map(), definitions: [], deferredDefinitions: [] }),
    createToolSignature: () => '',
    createToolExecutor: () => ({
      execute: async (): Promise<ToolResultMessage> => ({
        role: 'toolResult',
        toolCallId: '',
        toolName: '',
        content: [],
        isError: false,
        timestamp: 0,
      }),
    }),
  });
}

describe('AgentTurnRunner', () => {
  it('does not treat an error terminal message with zero fallback usage as provider telemetry', () => {
    const errorMessage: AssistantMessage = {
      role: 'assistant',
      content: [],
      model: 'kimi-for-coding',
      provider: 'kimi-coding-plan',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      stopReason: 'error',
      timestamp: 0,
    };
    const completedMessage: AssistantMessage = {
      ...errorMessage,
      stopReason: 'stop',
    };

    expect(hasActualProviderUsage(errorMessage)).toBe(false);
    expect(hasActualProviderUsage(completedMessage)).toBe(true);
    expect(shouldWarnEmptyAssistantCompletion(errorMessage)).toBe(false);
    expect(shouldWarnEmptyAssistantCompletion(completedMessage)).toBe(true);
  });

  it('does not emit empty_response_without_tool_call when stopReason is error', () => {
    const errorMessage: AssistantMessage = {
      role: 'assistant',
      content: [],
      model: 'grok-4.6',
      provider: 'grok-account',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      stopReason: 'error',
      timestamp: 0,
    };
    expect(shouldWarnEmptyAssistantCompletion(errorMessage)).toBe(false);
  });

  it('resolveMaxTurns prefers finite policy capped by profile', () => {
    const runner = createRunner();
    expect(runner.resolveMaxTurns('ask', 100, 12)).toBe(12);
    expect(runner.resolveMaxTurns('ask', 5, 12)).toBe(5);
  });

  it('resolveMaxTurns uses profile max when policy omitted', () => {
    const runner = createRunner();
    expect(runner.resolveMaxTurns('ask', undefined, 12)).toBe(12);
  });

  it('rejects a zero policy maxTurns as a typed policy error', () => {
    const runner = createRunner();
    expect(() => runner.resolveMaxTurns('ask', 0, 12)).toThrow(/POLICY_MAX_TURNS_ZERO/);
  });

  it('resolveMaxTurns uses a single default when profile maxTurns is omitted', () => {
    const runner = createRunner();
    expect(runner.resolveMaxTurns('edit', 80)).toBe(25);
    expect(runner.resolveMaxTurns('custom-writer' as never, 80)).toBe(25);
    expect(runner.resolveMaxTurns('debugger')).toBe(25);
    expect(runner.resolveMaxTurns('optimizer' as never)).toBe(25);
  });

  it('resolveMaxTurns uses profile maxTurns for any id, including custom edit', () => {
    const runner = createRunner();
    expect(runner.resolveMaxTurns('edit', 80, 40)).toBe(40);
    expect(runner.resolveMaxTurns('custom-writer' as never, 80, 40)).toBe(40);
    expect(runner.resolveMaxTurns('debugger', undefined, 50)).toBe(50);
  });

  it('getOrCreateAgentSlot requires PromptPlan', () => {
    const runner = createRunner();
    expect(() => runner.getOrCreateAgentSlot(
      'ask',
      'provider',
      'model',
      'system',
      { requestPlan: {} as RequestPlan },
      [],
      undefined,
      '',
      'test-scope',
      1000,
      800,
      undefined,
    )).toThrow(/PromptPlan is required/);
  });

  it('rejects runAgentTurn without preparedRuntime', async () => {
    const runner = createRunner();
    const requestPlan = createTestRequestPlan({
      providerId: 'test',
      adapterId: 'openai-compatible',
      catalogRevision: 'test',
      routeRevision: 'test',
      selectedModelId: 'model',
      effectiveModelId: 'model',
      appliedBindingIds: [],
      route: { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://example.test', source: 'catalog' },
      headers: {},
      bodyPatch: {},
      contextBudgetTokens: 1000,
      contextMode: 'normal',
      contextWindowTokens: 2000,
      activeTierId: 'normal',
      fastMode: false,
      reasoningWire: {
        selection: 'off',
        control: {
          kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' },
        },
      },
    });
    await expect(runner.runAgentTurn({
      agentId: 'ask',
      content: 'x',
      systemPrompt: 'system',
      providerId: 'test',
      modelId: 'model',
      profileId: 'general',
      toolAllowlist: [],
      contextTokenLimit: 800,
      sessionId: 's',
      turnId: 't',
      promptPlan: {} as PromptPlan,
      options: { requestPlan },
    })).rejects.toThrow(/TURN_NOT_PREPARED/);
  });

  it('cleans the turn and prepared MCP lease when slot setup throws', async () => {
    const release = vi.fn(async () => undefined);
    const runner = createRunner();
    vi.spyOn(runner, 'getOrCreateAgentSlot').mockImplementation(() => {
      throw new Error('slot setup failed');
    });
    const requestPlan = createTestRequestPlan({
      providerId: 'test',
      adapterId: 'openai-compatible',
      catalogRevision: 'test',
      routeRevision: 'test',
      selectedModelId: 'model',
      effectiveModelId: 'model',
      appliedBindingIds: [],
      route: { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://example.test', source: 'catalog' },
      headers: {},
      bodyPatch: {},
      contextBudgetTokens: 1000,
      contextMode: 'normal',
      contextWindowTokens: 2000,
      activeTierId: 'normal',
      fastMode: false,
      reasoningWire: {
        selection: 'off',
        control: {
          kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' },
        },
      },
    });
    const lease = {
      poolKey: 'pool',
      projectRootPath: null,
      projectId: 'project',
      descriptorHash: 'descriptor',
      release,
    } as McpConnectionLease;
    const policy = {
      maxTurns: 5,
      maxToolCalls: 5,
      maxSubagents: 2,
      maxChildDepth: 2,
      maxWallTimeMs: 10_000,
    } as EffectiveRuntimePlan['policy'];
    const preparedRuntime = {
      runtimeTools: { definitions: [], toolMap: new Map() },
      activeToolDefinitions: [],
      routeCapability: { toolCallingMode: 'disabled' } as AgentRouteCapability,
      mcpConnectionErrors: [],
      mcpLease: lease,
      credentialHandle: 'credential',
      promptCache: {},
      effectivePlan: { policy, toolAllowlist: [], routeCapability: { toolCallingMode: 'disabled' } } as unknown as EffectiveRuntimePlan,
    } as unknown as PreparedAgentRuntime;

    await expect(runner.runAgentTurn({
      agentId: 'ask',
      content: 'setup',
      systemPrompt: 'system',
      providerId: 'test',
      modelId: 'model',
      profileId: 'general',
      toolAllowlist: [],
      contextTokenLimit: 800,
      sessionId: 'setup-session',
      turnId: 'setup-turn',
      promptPlan: {} as PromptPlan,
      effectiveModel: {} as never,
      preparedRuntime,
      options: { requestPlan },
    })).rejects.toThrow('slot setup failed');

    expect(release).toHaveBeenCalledWith({ discardIfIdle: false });
    expect(turnCoordinator.getActive('setup-session')).toBeNull();
    expect(dispatchRuntimeHooks).toHaveBeenCalledWith(
      'turn.before-start',
      expect.objectContaining({ sessionId: 'setup-session', agentId: 'ask' }),
    );
    expect(dispatchRuntimeHooks).toHaveBeenCalledWith(
      'turn.after-end',
      expect.objectContaining({ sessionId: 'setup-session', agentId: 'ask' }),
    );
  });

  it.each([null, '', '   ', '\t'] as const)(
    'rejects empty execution scope %j before beginTurn and releases MCP lease',
    async (sessionId) => {
    const release = vi.fn(async () => undefined);
    const runner = createRunner();
    const beginSpy = vi.spyOn(turnCoordinator, 'beginTurn');
    const requestPlan = createTestRequestPlan({
      providerId: 'test',
      adapterId: 'openai-compatible',
      catalogRevision: 'test',
      routeRevision: 'test',
      selectedModelId: 'model',
      effectiveModelId: 'model',
      appliedBindingIds: [],
      route: { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://example.test', source: 'catalog' },
      headers: {},
      bodyPatch: {},
      contextBudgetTokens: 1000,
      contextMode: 'normal',
      contextWindowTokens: 2000,
      activeTierId: 'normal',
      fastMode: false,
      reasoningWire: {
        selection: 'off',
        control: {
          kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' },
        },
      },
    });
    const lease = {
      poolKey: 'pool',
      projectRootPath: null,
      projectId: 'project',
      descriptorHash: 'descriptor',
      release,
    } as McpConnectionLease;
    const policy = {
      maxTurns: 5,
      maxToolCalls: 5,
      maxSubagents: 2,
      maxChildDepth: 2,
      maxWallTimeMs: 10_000,
    } as EffectiveRuntimePlan['policy'];
    const preparedRuntime = {
      runtimeTools: { definitions: [], toolMap: new Map() },
      activeToolDefinitions: [],
      routeCapability: { toolCallingMode: 'disabled' } as AgentRouteCapability,
      mcpConnectionErrors: [],
      mcpLease: lease,
      credentialHandle: 'credential',
      promptCache: {},
      effectivePlan: { policy, toolAllowlist: [], routeCapability: { toolCallingMode: 'disabled' } } as unknown as EffectiveRuntimePlan,
    } as unknown as PreparedAgentRuntime;

    await expect(runner.runAgentTurn({
      agentId: 'ask',
      content: 'no-scope',
      systemPrompt: 'system',
      providerId: 'test',
      modelId: 'model',
      profileId: 'general',
      toolAllowlist: [],
      contextTokenLimit: 800,
      sessionId,
      turnId: 'no-scope-turn',
      promptPlan: {} as PromptPlan,
      effectiveModel: {} as never,
      preparedRuntime,
      options: { requestPlan },
    })).rejects.toThrow(/EXECUTION_SCOPE_REQUIRED/);

    expect(beginSpy).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith({ discardIfIdle: true });
    beginSpy.mockRestore();
  });
});
