import { resolveAgentMaxTurns } from '../../agent-runtime/agent/ExecutionLimits';
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
import { createSubagentBudgetState, turnCoordinator, type SubagentBudgetState } from './TurnCoordinator';

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
    expect(resolveAgentMaxTurns(100, 12)).toBe(12);
    expect(resolveAgentMaxTurns(5, 12)).toBe(5);
  });

  it('resolveMaxTurns uses profile max when policy omitted', () => {
    expect(resolveAgentMaxTurns(undefined, 12)).toBe(12);
  });

  it('rejects a zero policy maxTurns as a typed policy error', () => {
    expect(() => resolveAgentMaxTurns(0, 12)).toThrow(/POLICY_MAX_TURNS_ZERO/);
  });

  it('resolveMaxTurns uses a single default when profile maxTurns is omitted', () => {
    expect(resolveAgentMaxTurns(80)).toBe(25);
    expect(resolveAgentMaxTurns(80)).toBe(25);
    expect(resolveAgentMaxTurns()).toBe(25);
    expect(resolveAgentMaxTurns()).toBe(25);
  });

  it('resolveMaxTurns uses profile maxTurns for any id, including custom edit', () => {
    expect(resolveAgentMaxTurns(80, 40)).toBe(40);
    expect(resolveAgentMaxTurns(80, 40)).toBe(40);
    expect(resolveAgentMaxTurns(undefined, 50)).toBe(50);
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
      providerId: 'test',
      modelId: 'model',
      profileId: 'general',
      toolAllowlist: [],
      contextTokenLimit: 800,
      sessionId: 's',
      turnId: 't',
      options: { requestPlan },
    })).rejects.toThrow(/TURN_NOT_PREPARED/);
  });

  it.each([
    { maxWallTimeMs: 10_000, inherited: false },
    { maxWallTimeMs: 900_000, inherited: false },
    { maxWallTimeMs: 900_000, inherited: true },
  ])('freezes child wall admission from policy and preserves inherited consumption ($maxWallTimeMs/$inherited)', async ({ maxWallTimeMs, inherited }) => {
    const release = vi.fn(async () => undefined);
    const runner = createRunner();
    const inheritedBudget = inherited ? createSubagentBudgetState({
      maxDepth: 2, maxChildren: 4, maxAggregateToolCalls: 8, maxAggregateWallMs: 30_000,
    }) : undefined;
    if (inheritedBudget) {
      inheritedBudget.childrenSpawned = 2;
      inheritedBudget.aggregateToolCalls = 3;
      inheritedBudget.wallStartedAt = 1_000;
      inheritedBudget.wallPausedAt = 2_000;
    }
    let observedBudget: SubagentBudgetState | undefined;
    const setup = vi.spyOn(runner, 'getOrCreateAgentSlot').mockImplementation(() => {
      observedBudget = turnCoordinator.getActive('setup-session')?.subagentBudget;
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
      maxWallTimeMs,
    } as EffectiveRuntimePlan['policy'];
    const preparedRuntime = {
      promptPlan: { systemPrompt: 'prepared-system', segments: [
        { id: 'skill:actual-analysis', kind: 'preloaded-skill', sourceHash: 'd'.repeat(64) },
      ] } as PromptPlan,
      runtimeTools: { definitions: [], toolMap: new Map() },
      activeToolDefinitions: [],
      routeCapability: { toolCallingMode: 'disabled' } as AgentRouteCapability,
      mcpConnectionErrors: [],
      mcpLease: lease,
      credentialHandle: 'credential',
      promptCache: {},
      effectivePlan: { policy, fingerprint: 'e'.repeat(24), toolAllowlist: [], routeCapability: { toolCallingMode: 'disabled' } } as unknown as EffectiveRuntimePlan,
    } as unknown as PreparedAgentRuntime;

    const onTaskPreparation = vi.fn(async () => undefined);
    await expect(runner.runAgentTurn({
      agentId: 'ask',
      content: 'setup',
      providerId: 'test',
      modelId: 'model',
      profileId: 'general',
      toolAllowlist: [],
      contextTokenLimit: 800,
      sessionId: 'setup-session',
      turnId: 'setup-turn',
      effectiveModel: {} as never,
      preparedRuntime,
      options: { requestPlan, subagentBudget: inheritedBudget, onTaskPreparation },
    })).rejects.toThrow('slot setup failed');
    expect(onTaskPreparation).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'setup-session', turnId: 'setup-turn', runtimeFingerprint: 'e'.repeat(24),
      skills: [{ id: 'actual-analysis', hash: 'd'.repeat(64) }], selectedTurnCount: null,
    }));

    if (inheritedBudget) {
      expect(observedBudget).toBe(inheritedBudget);
      expect(observedBudget).toMatchObject({ childrenSpawned: 2, aggregateToolCalls: 3,
        wallStartedAt: 1_000, wallPausedAt: 2_000, budget: { maxAggregateWallMs: 30_000 } });
    } else {
      expect(observedBudget?.budget.maxAggregateWallMs).toBe(maxWallTimeMs);
    }

    expect(setup.mock.calls[0]?.[3]).toBe('prepared-system');
    expect(setup.mock.calls[0]?.[11]).toBe(preparedRuntime.promptPlan);

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
      providerId: 'test',
      modelId: 'model',
      profileId: 'general',
      toolAllowlist: [],
      contextTokenLimit: 800,
      sessionId,
      turnId: 'no-scope-turn',
      effectiveModel: {} as never,
      preparedRuntime,
      options: { requestPlan },
    })).rejects.toThrow(/EXECUTION_SCOPE_REQUIRED/);

    expect(beginSpy).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith({ discardIfIdle: true });
    beginSpy.mockRestore();
  });
});
