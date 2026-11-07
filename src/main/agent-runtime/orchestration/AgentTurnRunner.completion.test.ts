import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {
  getPath: () => process.env.TEMP ?? process.cwd(), getAppPath: () => process.cwd(),
} }));
vi.mock('../../hooks/runtimeHookDispatch', () => ({ dispatchRuntimeHooks: vi.fn(async () => true) }));
vi.mock('../../settings/settings-core/SettingsService', () => ({ settingsService: { getAll: () => ({}) } }));
vi.mock('../../runtime/RuntimeLogService', () => ({ runtimeLogService: { log: vi.fn() } }));
vi.mock('../../sessions/run/DebuggerLlmService', () => ({ debuggerLlmService: { recordAgentTurnUsage: vi.fn() } }));
vi.mock('../../sessions/run/handoffSkills', () => ({ assertApprovedExecutionCurrent: vi.fn() }));
vi.mock('./DirectTaskTurnLifecycle', () => ({
  settleUnfinishedDirectTasks: vi.fn(async () => 0), settleJoinedTurnTaskExecutions: vi.fn(async () => undefined),
}));
vi.mock('./ApprovedGoalContinuation', () => ({ approvedGoalContinuation: vi.fn(async () => undefined) }));

import { AgentTurnRunner, type AgentTurnRunnerDeps } from './AgentTurnRunner';
import type { AgentSlot } from './AgentSlotRegistry';
import { turnCoordinator, type TurnHandle } from './TurnCoordinator';
import type { AgentEvent, AssistantMessage } from '../core/types';
import type { PreparedAgentRuntime } from './orchestratorTypes';
import type { AgentSlotRequest } from './AgentSlotFactory';
import type { TurnCompletionReadinessValidator, TurnCompletionValidator } from '../agent/TurnCompletionValidator';
import { MissionCompletionError } from '../../investigation/missionCompletionContract';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';

function harness(scope: string, validateCompletion: TurnCompletionValidator, approvedPlan = false,
  validateCompletionReadiness: TurnCompletionReadinessValidator = () => undefined,
  onPrompt?: (turn: TurnHandle, request: AgentSlotRequest) => Promise<void>) {
  const terminal = vi.fn();
  const preparedRuntime = {
    promptPlan: { systemPrompt: 'Frozen instructions', segments: [] },
    runtimeTools: { definitions: [], toolMap: new Map() }, activeToolDefinitions: [],
    routeCapability: { toolCallingMode: 'disabled' }, mcpConnectionErrors: [],
    promptCache: {}, credentialHandle: 'fixture',
    effectivePlan: {
      fingerprint: 'frozen-plan', toolAllowlist: [], completionContract: 'investigation-report', investigationMission: 'debugger',
      policy: { maxTurns: 5, maxToolCalls: 5, maxSubagents: 1, maxChildDepth: 1, maxWallTimeMs: 10_000 },
    },
  } as unknown as PreparedAgentRuntime;
  let emit: (event: AgentEvent) => void = () => undefined;
  let slotRequest: AgentSlotRequest;
  const messages: AssistantMessage[] = [];
  const assistant = (text: string, withTool = false): AssistantMessage => ({
    role: 'assistant', provider: 'fixture', model: 'model', timestamp: 1,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    stopReason: withTool ? 'toolUse' : 'stop', content: [
      { type: 'text', text }, ...(withTool ? [{ type: 'toolCall' as const, id: 'call', name: 'turn_complete', arguments: {} }] : []),
    ],
  });
  const slot = {
    agent: {
      messages, state: { tools: [] }, activeLoopPromise: null,
      subscribe: (listener: typeof emit) => { emit = listener; return () => undefined; },
      prompt: async () => {
        const turn = turnCoordinator.getActive(scope)!;
        await onPrompt?.(turn, slotRequest);
        turn.completionDeclaration = { disposition: 'completed', evidenceRefs: [] };
        if (approvedPlan) {
          turn.completionDeclaration = null;
          turn.approvedPlan = { toolCallId: 'plan-call', hash: 'hash', target: 'general', frozenUri: 'session://plans/plan.md', planId: 'plan' };
        }
        const declaration = assistant('Report id and hash in tool commentary', true);
        messages.push(declaration);
        emit({ type: 'message_end', message: declaration });
        if (!approvedPlan) {
          const final = assistant('  Canonical final answer  ');
          messages.push(final);
          emit({ type: 'message_end', message: final });
        }
      },
      abortAndJoin: vi.fn(async () => undefined),
    },
    contextManager: { classifyMessages: () => ({ summaryTokens: 0, conversationTokens: 1, conversationCount: 1 }) },
    activatedDeferredTools: new Set<string>(),
  } as unknown as AgentSlot;
  const runner = new AgentTurnRunner({
    validateCompletion, validateCompletionReadiness, slots: { flush: vi.fn() }, sessionTurnKey: (id: string) => id,
    deferredActivation: { resolveActivatedSet: () => new Set<string>() },
    resolveRuntimeTools: () => preparedRuntime.runtimeTools, createToolSignature: () => '', createToolExecutor: () => ({}),
  } as unknown as AgentTurnRunnerDeps);
  vi.spyOn(runner, 'getOrCreateAgentSlot').mockImplementation(request => { slotRequest = request; return slot; });
  const run = () => runner.runAgentTurn({
    agentId: 'custom-planner', profileId: 'custom-planner', providerId: 'fixture', modelId: 'model', content: 'Inspect',
    sessionId: scope, turnId: 'owning-turn', toolAllowlist: [], contextTokenLimit: 1000, preparedRuntime,
    options: { requestPlan: createTestRequestPlan({
      providerId: 'fixture', adapterId: 'openai-compatible', catalogRevision: 'test', routeRevision: 'test',
      selectedModelId: 'model', effectiveModelId: 'model', appliedBindingIds: [],
      route: { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://example.test', source: 'catalog' },
      headers: {}, bodyPatch: {}, contextBudgetTokens: 1000, contextMode: 'normal', contextWindowTokens: 2000,
      activeTierId: 'normal', fastMode: false,
      reasoningWire: { selection: 'off', control: {
        kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' },
      } },
    }) }, terminalContext: terminal,
  });
  return { run, terminal, preparedRuntime };
}

describe('Agent turn completion boundary', () => {
  it.each(['completion-root', 'completion-root::subagent::child'])(
    'validates the frozen contract exactly once for %s and issues its receipt', async (scope) => {
      const validate = vi.fn();
      const { run, terminal } = harness(scope, validate);
      await run();
      expect(validate).toHaveBeenCalledTimes(1);
      expect(validate).toHaveBeenCalledWith(expect.objectContaining({
        profileId: 'custom-planner', completionContract: 'investigation-report', investigationMission: 'debugger',
        sessionId: scope, turnId: 'owning-turn', finalAnswerText: 'Canonical final answer', disposition: 'completed',
      }));
      expect(terminal.mock.calls[0]?.[1]).toBe('complete');
      expect(terminal.mock.calls[0]?.[5]).toEqual({ turnId: 'owning-turn', initialRuntimePlanFingerprint: 'frozen-plan',
        runtimePlanFingerprint: 'frozen-plan', runtimeEpochs: [], finalAnswerText: 'Canonical final answer' });
    },
  );

  it('does not issue a success receipt when the domain contract fails', async () => {
    const failure = new MissionCompletionError('missing_report', 'report missing');
    const validate = vi.fn(() => { throw failure; });
    const { run, terminal } = harness('completion-failed', validate);
    await expect(run()).rejects.toBe(failure);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(terminal.mock.calls[0]?.[1]).toBe('error');
    expect(terminal.mock.calls[0]?.[5]).toBeUndefined();
  });

  it('does not bind plan tool commentary as a final answer', async () => {
    const validate = vi.fn();
    const { run, terminal } = harness('completion-plan', validate, true);
    await run();
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith(expect.objectContaining({ finalAnswerText: '', disposition: undefined }));
    expect(terminal.mock.calls[0]?.[4]).toMatchObject({ planId: 'plan' });
    expect(terminal.mock.calls[0]?.[5]).toMatchObject({ finalAnswerText: '' });
  });

  it('keeps ordinary conversation on its frozen final-answer contract', async () => {
    const validate = vi.fn();
    const { run, preparedRuntime } = harness('completion-conversation', validate);
    preparedRuntime.effectivePlan = { ...preparedRuntime.effectivePlan, completionContract: 'final-answer', investigationMission: null };
    await run();
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith(expect.objectContaining({ completionContract: 'final-answer', investigationMission: undefined }));
  });

  it('uses the approved plan Mission contract for the General execution instead of the General profile default', async () => {
    const validate = vi.fn();
    const { run, preparedRuntime } = harness('completion-approved-goal', validate);
    preparedRuntime.effectivePlan = { ...preparedRuntime.effectivePlan, completionContract: 'final-answer', investigationMission: null };
    preparedRuntime.approvedExecution = { offer: {} as never, investigation: { schemaVersion: 1, mission: 'analyzer' } };
    await run();
    expect(validate).toHaveBeenCalledWith(expect.objectContaining({ completionContract: 'investigation-report', investigationMission: 'analyzer' }));
  });

  it('binds the approved Mission to declaration readiness before tool execution', async () => {
    const readiness = vi.fn();
    const { run, preparedRuntime } = harness('completion-approved-readiness', vi.fn(), false, readiness, async turn => {
      await turn.validateCompletionReadiness?.({ disposition: 'completed', evidenceRefs: [] });
    });
    preparedRuntime.effectivePlan = { ...preparedRuntime.effectivePlan, completionContract: 'final-answer', investigationMission: null };
    preparedRuntime.approvedExecution = { offer: {} as never, investigation: { schemaVersion: 1, mission: 'optimizer' } };
    await run();
    expect(readiness).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'custom-planner',
      completionContract: 'investigation-report', investigationMission: 'optimizer', sessionId: 'completion-approved-readiness',
      turnId: 'owning-turn', disposition: 'completed', evidenceRefs: [] }));
  });

  it('marks an approved Mission without a frozen capture scope before its tools run', async () => {
    const { run, preparedRuntime } = harness('completion-unscoped-capture', vi.fn(), false, () => undefined, async turn => {
      expect(turn.requiresApprovedCaptureScope).toBe(true);
    });
    preparedRuntime.effectivePlan = { ...preparedRuntime.effectivePlan, completionContract: 'final-answer', investigationMission: null };
    preparedRuntime.approvedExecution = { offer: {} as never, investigation: { schemaVersion: 1, mission: 'optimizer' } };
    await run();
  });

  it('gives the model the signed baseline and the observed mismatch before invalidating completion', async () => {
    let feedback: string | undefined;
    const { run, preparedRuntime } = harness('completion-restore', vi.fn(), false, () => undefined, async (turn, request) => {
      turn.completionDeclaration = { disposition: 'completed', evidenceRefs: [] };
      turn.captureControl = { lastRestoreError: null, restorationStatus: async () => ({ restored: false,
        original: { inputId: 'capture', native: { eventId: 14 }, target: { textureId: 'target', outputSlot: 0 } },
        current: { inputId: 'capture', native: { eventId: 11 }, target: { textureId: 'target', outputSlot: 0 } },
        receipt: { uri: 'session://tool-outputs/baseline.json', expectedHash: `sha256:${'a'.repeat(64)}` },
      }), recordTerminalRestoration: async () => true } as never;
      feedback = await request.beforeTerminalResponse?.({ content: [] } as never);
      expect(turn.completionDeclaration).toBeNull();
    });
    preparedRuntime.approvedExecution = { offer: {} as never, investigation: { schemaVersion: 1, mission: 'analyzer' } };
    await run();
    expect(feedback).toContain('session://tool-outputs/baseline.json');
    expect(feedback).toContain('"eventId":14');
    expect(feedback).toContain('"eventId":11');
    expect(feedback).toContain('capture_restore');
    expect(feedback).toContain('turn_complete');
  });
});
