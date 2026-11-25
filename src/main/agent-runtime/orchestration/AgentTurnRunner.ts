import { createHash } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
/**
 * AgentTurnRunner — runs one prepared agent turn in named phases over an explicit AgentTurnRun:
 * begin (scope, hook, turn), setup (completion guards, tools, executor, slot), subscription
 * (AgentTurnSubscription), prompt, and finalization. Slot construction lives in AgentSlotFactory.
 */

import { GENERAL_AGENT_ID } from '@shared/types/agent';
import { generateEventId, nowMs } from '@shared/utils/id';
import { permissionReviewAuthority, permissionReviewCaptureBaseline, permissionReviewEvidence } from '../permissions/PermissionReviewAuthority';
import { executePermissionReview } from '../permissions/PermissionReviewRuntime';
import { delegatedArtifactReferences } from '../../sessions/artifacts/DelegatedArtifactAccess';
import { TokenizerService } from '../core/TokenizerService';
import { isExplicitStructuredToolCallingRejection } from '../capabilities/RouteCapabilityResolver';
import { dispatchRuntimeHooks } from '../../hooks/runtimeHookDispatch';
import { assertApprovedExecutionCurrent } from '../../sessions/run/handoffSkills';
import {
  turnCoordinator,
  createSubagentBudgetState,
  createPolicyBudgetState,
  DEFAULT_SUBAGENT_BUDGET,
  type TurnHandle,
} from './TurnCoordinator';
import { agentSlotKey, type AgentSlot, type AgentSlotRegistry } from './AgentSlotRegistry';
import { requireExecutionScopeId } from './executionScope';
import { settleJoinedTurnTaskExecutions, settleUnfinishedDirectTasks } from './DirectTaskTurnLifecycle';
import { createApprovedGoalContinuation } from './ApprovedGoalContinuation';
import { cancelTurnInteractionRequests } from './cancelTurnInteractionRequests';
import { completionBudgetEvidence } from './CompletionBudgetEvidence';
import { createOrReuseAgentSlot, type AgentSlotRequest } from './AgentSlotFactory';
import { ApprovedCaptureController } from './ApprovedCaptureController';
import { createApprovedCaptureHost } from './ApprovedCaptureHost';
import {
  createCaptureRestorationFeedback,
  createMissionPlanningFeedback,
  createTerminalResponseGuard,
  installCompletionReadinessValidator,
} from './AgentTurnCompletionGuards';
import { subscribeAgentTurnEvents, type AgentTurnOutput } from './AgentTurnSubscription';
import { persistToolCallingRejection, reportRouteDiagnostics } from './AgentTurnCapabilityObservations';
import type { AgentEventBridgeContext } from '../AgentEventBridge';
import type { TurnCompletionReadinessValidator, TurnCompletionReceipt, TurnCompletionValidator } from '../agent/TurnCompletionValidator';
import type {
  AgentTurnOptions,
  PreparedAgentRuntime,
  ResolvedRuntimeTools,
  RuntimeToolResolver,
  ToolExecutorRuntimeContext,
} from './orchestratorTypes';
import type { McpConnectionLease } from './McpConnectionCoordinator';
import type { DeferredToolActivationTracker } from './DeferredToolActivationTracker';
import type { EffectiveModel, RequestPlan } from '@shared/types/providerCapability';
import type { EffectiveAgentProfile } from '../../settings/agent-manifests/agentRuntimeTypes';
import type {
  Message,
  StreamOptions,
  ToolDefinition,
  UserMessage,
} from '../core/types';
import type { ToolExecutor } from '../agent/AgentLoop';
import type { AgentRole } from '@shared/types/agent';
import type { EffectiveRuntimePlan } from '../EffectiveRuntimePlan';

/** Creates the executor a turn runs its tool calls through (ToolExecutorFactory). */
export interface TurnToolExecutors {
  createToolExecutor(
    agentId: AgentRole,
    toolAllowlist: string[],
    sessionId?: string | null,
    runtimeContext?: ToolExecutorRuntimeContext,
  ): ToolExecutor;
}

export interface AgentTurnRunnerDeps {
  validateCompletion: TurnCompletionValidator;
  validateCompletionReadiness: TurnCompletionReadinessValidator;
  slots: AgentSlotRegistry;
  deferredActivation: DeferredToolActivationTracker;
  tokenizerService: TokenizerService;
  tools: RuntimeToolResolver;
  toolExecutors: TurnToolExecutors;
}

export interface AgentTurnInput {
  agentId: AgentRole;
  content: string;
  providerId: string;
  modelId: string;
  temperature?: number;
  profileId: string;
  runId?: string;
  sessionId?: string | null;
  turnId?: string;
  toolAllowlist: string[];
  options?: AgentTurnOptions;
  projectRootPath?: string | null;
  projectId?: string | null;
  effectiveModel?: EffectiveModel;
  effectiveProfile?: EffectiveAgentProfile | null;
  effectiveProfileIds?: readonly string[];
  credentialHandle?: string;
  contextWindow?: number;
  contextTokenLimit: number;
  initialMessages?: Message[];
  contextDiagnostic?: Record<string, unknown>;
  preparedRuntime?: PreparedAgentRuntime;
  terminalContext?: (messages: Message[], status: 'complete' | 'stopped' | 'error', pendingHandoff?: import('./TurnCoordinator').PendingHandoff, completionDeclaration?: import('./TurnCoordinator').TurnCompletionDeclaration | null, approvedPlan?: TurnHandle['approvedPlan'], completionReceipt?: TurnCompletionReceipt) => void;
}

/** What one turn owns from beginTurn to endTurn; every later phase reads and updates it. */
export interface AgentTurnRun {
  readonly input: AgentTurnInput;
  readonly preparedRuntime: PreparedAgentRuntime;
  readonly requestPlan: RequestPlan;
  readonly effectiveModel: EffectiveModel | null;
  readonly executionScopeId: string;
  readonly turnHandle: TurnHandle;
  readonly mcpLease: McpConnectionLease | null;
  slotKey: string;
  slot: AgentSlot | null;
  unsubscribe: (() => void) | null;
  unregisterAgentProducer: (() => void) | null;
  abortListener: (() => void) | null;
  turnEnded: boolean;
  setupCleanupComplete: boolean;
  captureRestoreFailure: string | null;
  captureRestorationNeededForPartial: boolean;
}

/** Facts the setup phase fixes for the subscription, prompt and finalization phases. */
export interface AgentTurnSetup {
  readonly activeSlot: AgentSlot;
  readonly effectivePlan: EffectiveRuntimePlan;
  readonly runtimeTools: ResolvedRuntimeTools;
  readonly sharedEventContext: AgentEventBridgeContext;
  readonly turnGeneration: number;
  readonly missionPlanningFeedback: () => string | undefined;
  readonly userMessage: UserMessage;
}

type TerminalStatus = 'complete' | 'stopped' | 'error';

export class AgentTurnRunner {
  constructor(private readonly deps: AgentTurnRunnerDeps) {}

  getOrCreateAgentSlot(request: AgentSlotRequest): AgentSlot {
    return createOrReuseAgentSlot(this.deps, request);
  }

  async runAgentTurn(input: AgentTurnInput): Promise<string> {
    const run = await this.beginAgentTurn(input);
    try {
      const setup = await this.setupAgentTurn(run);
      const output = subscribeAgentTurnEvents(run, setup);
      return await this.promptAgentTurn(run, setup, output);
    } catch (error) {
      await this.cleanupFailedSetup(run);
      throw error;
    }
  }

  /** Validate the prepared turn, admit its scope through the turn.before-start hook and begin the turn. */
  private async beginAgentTurn(input: AgentTurnInput): Promise<AgentTurnRun> {
    if (!input.providerId || !input.modelId) {
      throw new Error('No provider/model route is configured for this agent.');
    }

    const requestPlan = input.options?.requestPlan;
    if (!requestPlan) {
      throw new Error('RequestPlan is required for every provider request.');
    }
    if (!input.preparedRuntime) {
      throw new AppError('TURN_NOT_PREPARED', 'preparedRuntime is required; call prepareTurnContext/prepareProfileTurn before runAgentTurn.');
    }
    const preparedRuntime = input.preparedRuntime;
    const turnPolicy = preparedRuntime.effectivePlan.policy;
    const mcpLease: McpConnectionLease | null = preparedRuntime.mcpLease ?? null;
    let executionScopeId: string;
    try {
      executionScopeId = requireExecutionScopeId(input.sessionId);
    } catch (error) {
      await mcpLease?.release({ discardIfIdle: true });
      throw error;
    }
    const sessionKey = executionScopeId;
    const turnHooksAllowed = await dispatchRuntimeHooks('turn.before-start', {
      agentId: input.agentId,
      sessionId: executionScopeId,
      projectRoot: input.projectRootPath ?? undefined,
      payload: { turnId: input.turnId, runId: input.runId },
    });
    if (!turnHooksAllowed) {
      await mcpLease?.release({ discardIfIdle: true });
      throw new AppError('HOOK_DENIED', 'turn.before-start');
    }
    let turnHandle: TurnHandle;
    try {
      turnHandle = await turnCoordinator.beginTurn({
        sessionKey,
        turnId: input.turnId ?? generateEventId('turn'),
        runId: input.runId,
        parentSignal: input.options?.signal,
        subagentBudget: input.options?.subagentBudget ?? createSubagentBudgetState({
          ...DEFAULT_SUBAGENT_BUDGET,
          maxDepth: turnPolicy.maxChildDepth ?? DEFAULT_SUBAGENT_BUDGET.maxDepth,
          maxChildren: turnPolicy.maxSubagents ?? DEFAULT_SUBAGENT_BUDGET.maxChildren,
          maxAggregateToolCalls: turnPolicy.maxToolCalls ?? DEFAULT_SUBAGENT_BUDGET.maxAggregateToolCalls,
          maxAggregateWallMs: turnPolicy.maxWallTimeMs ?? DEFAULT_SUBAGENT_BUDGET.maxAggregateWallMs,
        }),
        policyBudget: createPolicyBudgetState(
          turnPolicy,
          input.options?.subagentBudget?.depth ?? 0,
          input.options?.policyBudget,
        ),
      });
    } catch (error) {
      await mcpLease?.release({ discardIfIdle: true });
      throw error;
    }
    return {
      input, preparedRuntime, requestPlan, effectiveModel: input.effectiveModel ?? null, executionScopeId, turnHandle, mcpLease,
      slotKey: '', slot: null, unsubscribe: null, unregisterAgentProducer: null, abortListener: null,
      turnEnded: false, setupCleanupComplete: false, captureRestoreFailure: null, captureRestorationNeededForPartial: false,
    };
  }

  /** Completion guards, Task preparation, event sink, live tools, approved capture, executor, diagnostics and slot. */
  private async setupAgentTurn(run: AgentTurnRun): Promise<AgentTurnSetup> {
    const { input, preparedRuntime, requestPlan, turnHandle, executionScopeId } = run;
    const { promptPlan, routeCapability } = preparedRuntime;
    const toolCallsAtEntry = turnHandle.policyBudget.toolCalls;
    const { approvedGoalContinuation, captureRestorationFeedback } = this.installCompletionGuards(run);
    run.slotKey = agentSlotKey(executionScopeId, input.agentId);
    turnHandle.taskPreparation = this.describeTaskPreparation(run);
    await input.options?.onTaskPreparation?.(turnHandle.taskPreparation);
    const turnGeneration = turnHandle.generation;
    turnHandle.eventSink = {
      onEvent: (event) => {
        if (!turnHandle.isLive(turnGeneration)) return;
        input.options?.onEvent?.(event);
      },
      sessionId: executionScopeId,
      requestId: input.options?.requestId ?? null,
      projectRootPath: input.projectRootPath ?? null,
      projectId: input.projectId ?? null,
      agentId: input.agentId,
    };
    const { runtimeTools, activeToolDefinitions, sharedEventContext } = this.bindTurnTools(run);
    const effectivePlan = preparedRuntime.effectivePlan;
    await this.initializeApprovedCapture(run);
    const toolExecutor = this.createTurnToolExecutor(run, sharedEventContext, activeToolDefinitions);
    const promptCache = preparedRuntime.promptCache;
    const streamOptions: StreamOptions = {
      temperature: requestPlan.temperature,
      reasoning: requestPlan.reasoningWire,
      reasoningVisibility: requestPlan.reasoningWire.selection === 'off' ? 'none' : routeCapability.reasoningVisibility,
      signal: input.options?.signal,
      requestPlan,
      promptCache,
      credentialHandle: preparedRuntime.credentialHandle ?? input.credentialHandle,
    };
    reportRouteDiagnostics(run, sharedEventContext, runtimeTools.definitions.length);
    const missionPlanningFeedback = createMissionPlanningFeedback(run, effectivePlan);
    run.slot = this.getOrCreateAgentSlot({
      agentId: input.agentId,
      providerId: input.providerId,
      modelId: input.modelId,
      systemPrompt: promptPlan.systemPrompt,
      streamOptions,
      tools: activeToolDefinitions,
      toolExecutor,
      turnSignature: input.turnId ?? '',
      sessionId: executionScopeId,
      contextWindow: input.contextWindow,
      contextTokenLimit: input.contextTokenLimit,
      promptPlan,
      initialMessages: input.initialMessages ?? [],
      contextDiagnostic: input.contextDiagnostic,
      signatureTools: runtimeTools.definitions,
      routeCapabilityOverride: routeCapability,
      policyMaxTurns: effectivePlan.policy.maxTurns === Number.MAX_SAFE_INTEGER
        ? undefined
        : effectivePlan.policy.maxTurns,
      profileMaxTurns: effectivePlan.profileMaxTurns,
      onLoopBudget: (remaining, limit) => { turnHandle.providerLoopBudget = { remaining, limit }; },
      resolvePromptPlan: () => turnHandle.promptPlan ?? promptPlan,
      resolveRuntimeFingerprint: () => turnHandle.runtimePlan?.fingerprint ?? effectivePlan.fingerprint,
      beforeTerminalResponse: createTerminalResponseGuard(run, {
        validateCompletion: this.deps.validateCompletion,
        approvedGoalContinuation, captureRestorationFeedback, missionPlanningFeedback, toolCallsAtEntry,
      }),
      beforeRequestMessages: input.options?.beforeProviderRequestMessages,
      onProviderRequestCommitted: input.options?.onProviderRequestCommitted,
    });
    if (!run.slot) {
      throw new Error('Agent slot setup did not produce a slot.');
    }
    const userMessage: UserMessage = {
      role: 'user',
      content: input.options?.userContent ?? input.content,
      timestamp: nowMs(),
    };
    return { activeSlot: run.slot, effectivePlan, runtimeTools, sharedEventContext, turnGeneration, missionPlanningFeedback, userMessage };
  }

  /** Approved-goal review, the approved capture scope requirement and the completion readiness validator. */
  private installCompletionGuards(run: AgentTurnRun) {
    const { preparedRuntime, turnHandle, executionScopeId } = run;
    turnHandle.requiresApprovedGoalClosure = Boolean(preparedRuntime.approvedExecution);
    const approvedGoalContinuation = createApprovedGoalContinuation(turnHandle, executionScopeId);
    turnHandle.reviewCompletionDeclaration = (declaration) => approvedGoalContinuation.reviewDeclaration(declaration);
    turnHandle.requiresApprovedCaptureScope = Boolean(preparedRuntime.approvedExecution?.investigation
      && !preparedRuntime.approvedExecution.investigation.captureScope);
    const captureRestorationFeedback = createCaptureRestorationFeedback(run);
    installCompletionReadinessValidator(run, this.deps.validateCompletionReadiness, approvedGoalContinuation, captureRestorationFeedback);
    return { approvedGoalContinuation, captureRestorationFeedback };
  }

  /**
   * Rebuild live tool instances over the frozen definitions, choose the injected schemas for the route,
   * and bind deferred activation and the frozen plans to the turn.
   */
  private bindTurnTools(run: AgentTurnRun) {
    const { input, preparedRuntime, turnHandle, executionScopeId, mcpLease, slotKey } = run;
    const { promptPlan, routeCapability } = preparedRuntime;
    const frozenToolAllowlist = [...preparedRuntime.effectivePlan.toolAllowlist];
    const liveRuntimeTools = this.deps.tools.resolveRuntimeTools(
      input.agentId,
      frozenToolAllowlist,
      executionScopeId,
      turnHandle,
      input.projectId,
      input.projectRootPath,
      mcpLease?.poolKey ?? null,
      { excludeRdcLeaseTools: preparedRuntime.effectivePlan.excludeRdcLeaseTools === true,
        excludeSubagent: preparedRuntime.effectivePlan.excludeSubagent === true },
    );
    // Preparation freezes the schemas sent to the provider before a staged
    // conversation session has a durable run. Rebuild tool instances here so
    // their closures receive the committed session/run ownership, while keeping
    // the prepared definition set immutable for the request.
    const runtimeTools = {
      definitions: preparedRuntime.runtimeTools.definitions,
      toolMap: liveRuntimeTools.toolMap,
    };
    const allToolSignature = this.deps.tools.createToolSignature(runtimeTools.definitions);
    void this.deps.deferredActivation.resolveActivatedSet(slotKey, allToolSignature);
    const injectedToolDefinitions = preparedRuntime.activeToolDefinitions;
    // native-structured：core 常驻注入，mcp__* 与 extended builtin 默认 deferred；
    // 其它路由不注入工具 schema。
    const activeToolDefinitions = routeCapability.toolCallingMode === 'native-structured'
      ? injectedToolDefinitions
      : [];
    const activeToolAllowlist = activeToolDefinitions.map((tool) => tool.name);
    const sharedEventContext: AgentEventBridgeContext = {
      agentId: input.agentId,
      runId: input.runId,
      turnId: input.turnId,
      sessionId: executionScopeId,
      profileId: input.profileId,
      providerId: input.providerId,
      modelId: input.modelId,
      toolAllowlist: activeToolAllowlist,
      routeCapability,
    };
    turnHandle.deferredActivation = {
      slotKey,
      allDefinitions: runtimeTools.definitions,
    };
    turnHandle.agentSlotKey = slotKey;
    const effectivePlan = preparedRuntime.effectivePlan;
    turnHandle.runtimePlan = effectivePlan;
    turnHandle.promptPlan = promptPlan;
    return { runtimeTools, activeToolDefinitions, sharedEventContext };
  }

  /** The executor for this turn, with the frozen plan, budget and the permission reviewer. */
  private createTurnToolExecutor(run: AgentTurnRun, sharedEventContext: AgentEventBridgeContext, activeToolDefinitions: ToolDefinition[]): ToolExecutor {
    const { input, preparedRuntime, requestPlan, turnHandle, executionScopeId, mcpLease } = run;
    const { promptPlan, routeCapability, effectivePlan } = preparedRuntime;
    const activeToolAllowlist = activeToolDefinitions.map((tool) => tool.name);
    // native-structured：执行器用 plan 冻结 allowlist；其它路由与注入列表一致。
    const executorAllowlist = routeCapability.toolCallingMode === 'native-structured'
      ? [...effectivePlan.toolAllowlist]
      : activeToolAllowlist;
    return this.deps.toolExecutors.createToolExecutor(input.agentId, executorAllowlist, executionScopeId, {
      sessionId: executionScopeId,
      runId: input.runId,
      turnId: input.turnId,
      eventContext: sharedEventContext,
      onEvent: input.options?.onEvent,
      projectRootPath: effectivePlan.projectRootPath ?? input.projectRootPath ?? null,
      projectId: effectivePlan.projectId ?? input.projectId ?? null,
      mcpPoolKey: mcpLease?.poolKey ?? null,
      effectivePlan,
      policyBudget: turnHandle.policyBudget,
      reviewPermission: (action, signal, tool) => executePermissionReview({
        sessionId: executionScopeId, plan: requestPlan, credentialHandle: preparedRuntime.credentialHandle,
        reasoning: routeCapability.reasoningContract, evidence: {
          ...permissionReviewEvidence(run.slot?.agent.messages ?? [], executionScopeId, action.arguments),
          ...(tool?.spec.capture?.replayLifecycle?.(action.arguments) === 'capture_restore'
            ? { captureBaseline: permissionReviewCaptureBaseline({ controller: turnHandle.captureControl, sessionId: executionScopeId,
              projectId: input.projectId, turnId: turnHandle.turnId, agentId: input.agentId, accessCeiling: effectivePlan.accessCeiling }) } : {}),
        },
        authority: permissionReviewAuthority({ sessionId: executionScopeId, messages: input.initialMessages ?? [],
          currentRequest: input.content, promptPlan, workspace: effectivePlan.projectRootPath, agentId: input.agentId,
          delegated: !!effectivePlan.delegationCapsule }), action, signal,
      }),
    });
  }

  /** Frozen facts a Task execution records about the turn that runs it. */
  private describeTaskPreparation(run: AgentTurnRun): NonNullable<TurnHandle['taskPreparation']> {
    const { input, preparedRuntime, requestPlan, turnHandle, executionScopeId } = run;
    const capsule = preparedRuntime.effectivePlan.delegationCapsule;
    return {
      sessionId: executionScopeId, turnId: turnHandle.turnId,
      runtimeFingerprint: preparedRuntime.effectivePlan.fingerprint,
      profileId: preparedRuntime.effectivePlan.agentId,
      ...(preparedRuntime.effectivePlan.profileProvenance?.sourceHash
        ? { profileSourceHash: preparedRuntime.effectivePlan.profileProvenance.sourceHash } : {}),
      ...(preparedRuntime.effectivePlan.profileProvenance
        ? { profileSource: { scope: preparedRuntime.effectivePlan.profileProvenance.scope,
          path: preparedRuntime.effectivePlan.profileProvenance.sourcePath } } : {}),
      providerId: requestPlan.providerId,
      modelId: requestPlan.effectiveModelId,
      reasoningLevel: requestPlan.reasoningWire.selection,
      skills: preparedRuntime.promptPlan.segments.filter(segment => segment.kind === 'preloaded-skill').map(segment => ({
        id: segment.id.replace(/^skill:/, ''), hash: segment.sourceHash.replace(/^sha256:/, ''),
      })),
      inputArtifacts: delegatedArtifactReferences(executionScopeId) ?? [],
      selectedTurnCount: typeof input.contextDiagnostic?.selectedTurnCount === 'number' ? input.contextDiagnostic.selectedTurnCount : null,
      ...(capsule ? { capsuleHash: createHash('sha256').update(JSON.stringify(capsule)).digest('hex') } : {}),
      requestsDomainCapability: Object.values(capsule?.domainExtensions ?? {}).some(flags => Object.values(flags).some(Boolean)),
    };
  }

  /** An approved plan with a frozen capture scope hands the owning General turn its capture controller. */
  private async initializeApprovedCapture(run: AgentTurnRun): Promise<void> {
    const { input, preparedRuntime, turnHandle, executionScopeId } = run;
    const approvedCapture = preparedRuntime.approvedExecution?.investigation?.captureScope;
    if (!approvedCapture) return;
    if (!input.sessionId || !input.projectId || input.agentId !== GENERAL_AGENT_ID || !preparedRuntime.approvedExecution?.investigation) {
      throw new AppError('RDC_CAPTURE_SCOPE_INVALID', 'approved capture work requires the owning General session.');
    }
    const approved = preparedRuntime.approvedExecution;
    const host = createApprovedCaptureHost({ sessionId: executionScopeId, projectId: input.projectId,
      offer: approved.offer, contract: approved.investigation!, turn: turnHandle });
    turnHandle.captureControl = new ApprovedCaptureController({ sessionId: executionScopeId, projectId: input.projectId,
      planUri: approved.offer.plan.uri, planHash: approved.offer.plan.hash, captureScope: approvedCapture, turn: turnHandle, host });
    await turnHandle.captureControl.initialize();
  }

  /** Run the prompt, enforce the turn's completion contract, and finalize whatever the outcome. */
  private async promptAgentTurn(run: AgentTurnRun, setup: AgentTurnSetup, output: AgentTurnOutput): Promise<string> {
    const { input, preparedRuntime, turnHandle, executionScopeId } = run;
    const { activeSlot, effectivePlan } = setup;
    const initialMessageCount = activeSlot.agent.messages.length;
    const settleDirectTasks = (stopped: boolean) => settleUnfinishedDirectTasks({ sessionId: input.sessionId, turnId: turnHandle.turnId, generation: turnHandle.generation, stopped });
    let terminalStatus: TerminalStatus = 'complete';
    let completionReceipt: TurnCompletionReceipt | undefined;
    try {
      await activeSlot.agent.prompt(setup.userMessage);
      if (!turnHandle.isAborted && setup.missionPlanningFeedback()) throw new AppError('MISSION_PLAN_REQUIRED', 'the planning turn ended without a reviewed plan.');
      if (await settleDirectTasks(false)) throw new AppError('TASK_COMPLETION_DENIED', 'Direct Task executions must be settled before the parent turn completes.');
      if (turnHandle.completionDeclaration?.disposition === 'cancelled' && !turnHandle.isAborted) {
        throw new AppError('TURN_COMPLETION_INVALID', 'cancelled requires an actual abort and joined execution.');
      }
      if (turnHandle.completionDeclaration?.disposition === 'completed' && preparedRuntime.approvedExecution) {
        assertApprovedExecutionCurrent(executionScopeId, input.agentId, preparedRuntime.approvedExecution.offer);
      }
      const completionInput = {
        profileId: input.agentId,
        completionContract: preparedRuntime.approvedExecution?.investigation ? 'investigation-report' as const : turnHandle.runtimePlan?.completionContract,
        investigationMission: preparedRuntime.approvedExecution?.investigation?.mission ?? turnHandle.runtimePlan?.investigationMission ?? undefined,
        turnId: turnHandle.turnId,
        sessionId: executionScopeId,
        finalAnswerText: output.canonicalFinalAnswerText,
        disposition: turnHandle.completionDeclaration?.disposition,
        evidenceRefs: turnHandle.completionDeclaration?.evidenceRefs,
        budgetEvidence: completionBudgetEvidence(turnHandle),
      };
      this.deps.validateCompletion(completionInput);
      if (turnHandle.captureControl) {
        let restored = false;
        try { restored = await turnHandle.captureControl.recordTerminalRestoration(turnHandle.signal); }
        catch (error) { if (turnHandle.completionDeclaration?.disposition === 'completed') throw error; }
        if (!restored && turnHandle.completionDeclaration?.disposition === 'completed') {
          throw new AppError('RDC_RESTORE_UNCONFIRMED', 'the original capture position has no verified terminal receipt.');
        }
      }
      completionReceipt = {
        turnId: turnHandle.turnId,
        initialRuntimePlanFingerprint: effectivePlan.fingerprint,
        runtimePlanFingerprint: turnHandle.runtimePlan?.fingerprint ?? effectivePlan.fingerprint,
        runtimeEpochs: structuredClone(turnHandle.runtimeEpochs),
        finalAnswerText: output.canonicalFinalAnswerText,
      };
      return output.responseText;
    } catch (error) {
      terminalStatus = input.options?.signal?.aborted || turnHandle.isAborted ? 'stopped' : 'error';
      if (terminalStatus !== 'stopped') await settleDirectTasks(false);
      if (terminalStatus === 'error' && isExplicitStructuredToolCallingRejection(error)) {
        persistToolCallingRejection(run, error);
      }
      throw error;
    } finally {
      await this.finalizeAgentTurn(run, activeSlot, initialMessageCount, terminalStatus, completionReceipt);
    }
  }

  /** Join an aborted agent, release the subscription, report the terminal context and end the turn. */
  private async finalizeAgentTurn(
    run: AgentTurnRun,
    activeSlot: AgentSlot,
    initialMessageCount: number,
    terminalStatus: TerminalStatus,
    completionReceipt: TurnCompletionReceipt | undefined,
  ): Promise<void> {
    const { input, turnHandle, executionScopeId, slotKey, mcpLease } = run;
    if (turnHandle.isAborted) {
      await activeSlot.agent.abortAndJoin();
    }
    run.unsubscribe?.();
    run.unregisterAgentProducer?.();
    if (run.abortListener && input.options?.signal) {
      input.options.signal.removeEventListener('abort', run.abortListener);
    }
    cancelTurnInteractionRequests(turnHandle.turnId);
    input.terminalContext?.(activeSlot.agent.messages.slice(initialMessageCount) as Message[], terminalStatus, turnHandle.pendingHandoff ?? undefined, turnHandle.completionDeclaration, terminalStatus === 'complete' ? turnHandle.approvedPlan : null, terminalStatus === 'complete' ? completionReceipt : undefined);
    this.deps.slots.flush(activeSlot);
    if (turnHandle.isAborted) {
      await turnHandle.abortAndJoin({ reason: turnHandle.reason ?? 'user_stop' });
    }
    await settleJoinedTurnTaskExecutions({ sessionId: input.sessionId, turnId: turnHandle.turnId,
      generation: turnHandle.generation, stopped: turnHandle.isAborted, orphaned: turnHandle.isOrphaned });
    if (turnHandle.isOrphaned) {
      // Reserve the key until the orphaned provider/tool loop actually settles.
      this.deps.slots.quarantineSlot(slotKey, activeSlot.agent.activeLoopPromise ?? Promise.resolve());
      this.deps.slots.deleteSlot(slotKey);
    }
    await mcpLease?.release({ discardIfIdle: turnHandle.isOrphaned });
    turnCoordinator.endTurn(turnHandle);
    run.turnEnded = true;
    await dispatchRuntimeHooks('turn.after-end', {
      agentId: input.agentId,
      sessionId: executionScopeId,
      projectRoot: input.projectRootPath ?? undefined,
      payload: { turnId: turnHandle.turnId },
    });
    run.setupCleanupComplete = true;
  }

  /** A failure before finalization completed: unwind whatever setup and subscription acquired. */
  private async cleanupFailedSetup(run: AgentTurnRun): Promise<void> {
    if (run.setupCleanupComplete) return;
    const { input, turnHandle, executionScopeId, slot, slotKey, mcpLease } = run;
    if (run.abortListener && input.options?.signal) {
      input.options.signal.removeEventListener('abort', run.abortListener);
    }
    run.unsubscribe?.();
    run.unregisterAgentProducer?.();
    if (slot?.agent.isStreaming || slot?.agent.activeLoopPromise) {
      try {
        await slot.agent.abortAndJoin();
      } catch {
        // Preserve the setup failure; the turn join below owns orphan detection.
      }
    }
    await turnHandle.abortAndJoin({ reason: turnHandle.reason ?? 'unknown' });
    if (slot) {
      // Setup can create a reusable slot before a later subscription or
      // executor step fails. Keep the slot only when it is not orphaned,
      // but never leave setup messages in the execution cache.
      this.deps.slots.flush(slot);
    }
    if (turnHandle.isOrphaned && slot && slotKey) {
      this.deps.slots.quarantineSlot(slotKey, slot.agent.activeLoopPromise ?? Promise.resolve());
      this.deps.slots.deleteSlot(slotKey);
    }
    await mcpLease?.release({ discardIfIdle: turnHandle.isOrphaned });
    if (!run.turnEnded) {
      turnCoordinator.endTurn(turnHandle);
      run.turnEnded = true;
      await dispatchRuntimeHooks('turn.after-end', {
        agentId: input.agentId,
        sessionId: executionScopeId,
        projectRoot: input.projectRootPath ?? undefined,
        payload: { turnId: turnHandle.turnId },
      });
    }
    run.setupCleanupComplete = true;
  }
}
