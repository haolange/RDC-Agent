/**
 * AgentTurnRunner — runs one prepared agent turn; slot construction lives in AgentSlotFactory.
 */

import type { AgentRole } from '@shared/types/agent';
import { executePermissionReview } from '../permissions/PermissionReviewRuntime';
import { permissionReviewAuthority, permissionReviewEvidence } from '../permissions/PermissionReviewAuthority';
import { createHash } from 'node:crypto';
import { delegatedArtifactReferences } from '../../sessions/artifacts/DelegatedArtifactAccess';
import type { ContextUsageBreakdownEntry } from '@shared/types/session';
import type { EffectiveAgentProfile } from '@shared/types/rdcRuntime';
import type { EffectiveModel } from '@shared/types/providerCapability';
import { generateEventId, nowMs } from '@shared/utils/id';
import { charsToTokens } from '@shared/utils/tokens';
import { TokenizerService } from '../core/TokenizerService';
import type { ToolExecutor } from '../agent/AgentLoop';
import {
  claimStructuredToolCallingEvidence,
  describeRouteCapabilityDiagnostic,
  isExplicitStructuredToolCallingRejection,
} from '../capabilities/RouteCapabilityResolver';
import {
  buildDiagnosticAgentEvent,
  mentionsTextualToolCall,
  translateCoreToSharedAgentEvent,
  type AgentEventBridgeContext,
} from '../AgentEventBridge';
import { dispatchRuntimeHooks } from '../../hooks/runtimeHookDispatch';
import { cancelTurnInteractionRequests } from './cancelTurnInteractionRequests';
import type {
  AgentEvent as CoreAgentEvent,
  Message,
  StreamOptions,
  ToolDefinition,
  UserMessage,
} from '../core/types';
import { runtimeLogService } from '../../runtime/RuntimeLogService';
import {
  recordObservedToolCallingSupport,
  recordObservedToolCallingUnsupported,
} from '../../settings/provider-catalog/EffectiveModelResolver';
import { debuggerLlmService } from '../../sessions/run/DebuggerLlmService';
import { settingsService } from '../../settings/settings-core/SettingsService';
import {
  turnCoordinator,
  createSubagentBudgetState,
  createPolicyBudgetState,
  DEFAULT_SUBAGENT_BUDGET,
} from './TurnCoordinator';
import { agentSlotKey, type AgentSlot, type AgentSlotRegistry } from './AgentSlotRegistry';
import { requireExecutionScopeId } from './executionScope';
import type { DeferredToolActivationTracker } from './DeferredToolActivationTracker';
import type { McpConnectionCoordinator, McpConnectionLease } from './McpConnectionCoordinator';
import {
  isMcpPrefixedToolName,
  partitionDeferredTools,
} from './deferredTools';
import type {
  AgentTurnOptions,
  PreparedAgentRuntime,
  ResolvedRuntimeTools,
  ToolExecutorRuntimeContext,
} from './orchestratorTypes';
import type { TurnCompletionValidator } from '../agent/TurnCompletionValidator';
import { settleJoinedTurnTaskExecutions, settleUnfinishedDirectTasks } from './DirectTaskTurnLifecycle';
import { createOrReuseAgentSlot, isSuccessfulProviderResponse, reportedUsageFields, type AgentSlotRequest } from './AgentSlotFactory';

export interface AgentTurnRunnerDeps {
  validateCompletion: TurnCompletionValidator;
  slots: AgentSlotRegistry;
  mcp: McpConnectionCoordinator;
  deferredActivation: DeferredToolActivationTracker;
  tokenizerService: TokenizerService;
  sessionTurnKey: (sessionId?: string | null) => string;
  resolveRuntimeTools: (
    agentId: AgentRole,
    toolAllowlist: string[],
    sessionId?: string | null,
    turnHandle?: import('./TurnCoordinator').TurnHandle | null,
    projectId?: string | null,
    projectRootPath?: string | null,
    mcpPoolKey?: string | null,
    options?: { excludeRdcLeaseTools?: boolean; excludeSubagent?: boolean },
  ) => ResolvedRuntimeTools;
  createToolSignature: (tools: ToolDefinition[]) => string;
  createToolExecutor: (
    agentId: AgentRole,
    toolAllowlist: string[],
    sessionId?: string | null,
    runtimeContext?: ToolExecutorRuntimeContext,
  ) => ToolExecutor;
}

export class AgentTurnRunner {
  constructor(private readonly deps: AgentTurnRunnerDeps) {}

  getOrCreateAgentSlot(request: AgentSlotRequest): AgentSlot {
    return createOrReuseAgentSlot(this.deps, request);
  }

  async runAgentTurn(input: {
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
    terminalContext?: (messages: Message[], status: 'complete' | 'stopped' | 'error', pendingHandoff?: import('./TurnCoordinator').PendingHandoff, completionDeclaration?: import('./TurnCoordinator').TurnCompletionDeclaration | null, approvedPlan?: import('./TurnCoordinator').TurnHandle['approvedPlan']) => void;
  }): Promise<string> {
    if (!input.providerId || !input.modelId) {
      throw new Error('No provider/model route is configured for this agent.');
    }

    const requestPlan = input.options?.requestPlan;
    if (!requestPlan) {
      throw new Error('RequestPlan is required for every provider request.');
    }
    if (!input.preparedRuntime) {
      throw new Error('TURN_NOT_PREPARED: preparedRuntime is required; call prepareTurnContext/prepareProfileTurn before runAgentTurn.');
    }
    const preparedRuntime = input.preparedRuntime;
    const promptPlan = preparedRuntime.promptPlan;
    const turnPolicy = preparedRuntime.effectivePlan.policy;
    const effectiveModel = input.effectiveModel ?? null;
    const routeCapability = preparedRuntime.routeCapability;
    let mcpLease: McpConnectionLease | null = preparedRuntime.mcpLease ?? null;
    let mcpConnectionErrors = preparedRuntime.mcpConnectionErrors ?? [];
    let executionScopeId: string;
    try {
      executionScopeId = requireExecutionScopeId(input.sessionId);
    } catch (error) {
      await mcpLease?.release({ discardIfIdle: true });
      throw error;
    }
    const sessionKey = this.deps.sessionTurnKey(executionScopeId);
    const turnHooksAllowed = await dispatchRuntimeHooks('turn.before-start', {
      agentId: input.agentId,
      sessionId: executionScopeId,
      projectRoot: input.projectRootPath ?? undefined,
      payload: { turnId: input.turnId, runId: input.runId },
    });
    if (!turnHooksAllowed) {
      await mcpLease?.release({ discardIfIdle: true });
      throw new Error('HOOK_DENIED: turn.before-start');
    }
    let turnHandle;
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
    let slotKey = '';
    let slot: AgentSlot | null = null;
    let unsubscribe: (() => void) | null = null;
    let unregisterAgentProducer: (() => void) | null = null;
    let abortListener: (() => void) | null = null;
    let turnEnded = false;
    let setupCleanupComplete = false;
    try {
    slotKey = agentSlotKey(executionScopeId, input.agentId);
    const capsule = preparedRuntime.effectivePlan.delegationCapsule;
    turnHandle.taskPreparation = {
      sessionId: executionScopeId, turnId: turnHandle.turnId,
      runtimeFingerprint: preparedRuntime.effectivePlan.fingerprint,
      skills: promptPlan.segments.filter(segment => segment.kind === 'preloaded-skill').map(segment => ({
        id: segment.id.replace(/^skill:/, ''), hash: segment.sourceHash.replace(/^sha256:/, ''),
      })),
      inputArtifacts: delegatedArtifactReferences(executionScopeId) ?? [],
      selectedTurnCount: typeof input.contextDiagnostic?.selectedTurnCount === 'number' ? input.contextDiagnostic.selectedTurnCount : null,
      ...(capsule ? { capsuleHash: createHash('sha256').update(JSON.stringify(capsule)).digest('hex') } : {}),
      requestsDomainCapability: Object.values(capsule?.domainExtensions ?? {}).some(flags => Object.values(flags).some(Boolean)),
    };
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
    const frozenToolAllowlist = [...preparedRuntime.effectivePlan.toolAllowlist];
    const liveRuntimeTools = this.deps.resolveRuntimeTools(
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
    const allToolSignature = this.deps.createToolSignature(runtimeTools.definitions);
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
    // native-structured：执行器用 plan 冻结 allowlist；其它路由与注入列表一致。
    const executorAllowlist = routeCapability.toolCallingMode === 'native-structured'
      ? [...effectivePlan.toolAllowlist]
      : activeToolAllowlist;
    const toolExecutor = this.deps.createToolExecutor(input.agentId, executorAllowlist, executionScopeId, {
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
      reviewPermission: (action, signal) => executePermissionReview({
        sessionId: executionScopeId, plan: requestPlan, credentialHandle: preparedRuntime.credentialHandle,
        reasoning: routeCapability.reasoningContract, evidence: permissionReviewEvidence(slot?.agent.messages ?? [], executionScopeId, action.arguments),
        authority: permissionReviewAuthority({ sessionId: executionScopeId, messages: input.initialMessages ?? [],
          currentRequest: input.content, promptPlan, workspace: effectivePlan.projectRootPath, agentId: input.agentId,
          delegated: !!effectivePlan.delegationCapsule }), action, signal,
      }),
    });
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
    const routeDiagnostic = describeRouteCapabilityDiagnostic(routeCapability, runtimeTools.definitions.length);
    if (mcpConnectionErrors.length > 0) {
      input.options?.onEvent?.(buildDiagnosticAgentEvent(sharedEventContext, {
        code: 'mcp_connection_failed',
        severity: 'warning',
        message: 'One or more configured MCP servers could not be connected. MCP tools are unavailable for this turn.',
        technicalMessage: mcpConnectionErrors.join('\n'),
      }));
    }
    if (routeDiagnostic) {
      if (routeDiagnostic.surface === 'runtime-log') {
        runtimeLogService.log({
          scope: 'session',
          namespace: 'agent',
          severity: routeDiagnostic.severity,
          title: 'Model route capability',
          summary: routeDiagnostic.message,
          sessionId: executionScopeId,
          projectId: input.projectId,
          runId: input.runId,
          raw: {
            code: routeDiagnostic.code,
            surface: routeDiagnostic.surface,
            providerId: input.providerId,
            modelId: effectiveModel?.modelId ?? input.modelId,
            protocol: requestPlan.route.protocol,
          },
        });
      } else {
        input.options?.onEvent?.(buildDiagnosticAgentEvent(sharedEventContext, {
          code: routeDiagnostic.code,
          severity: routeDiagnostic.severity,
          message: routeDiagnostic.message,
          technicalMessage: JSON.stringify(routeCapability),
        }));
      }
    }
    slot = this.getOrCreateAgentSlot({
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
      beforeRequestMessages: input.options?.beforeProviderRequestMessages,
      onProviderRequestCommitted: input.options?.onProviderRequestCommitted,
    });
    if (!slot) {
      throw new Error('Agent slot setup did not produce a slot.');
    }
    const activeSlot = slot;

    const userMessage: UserMessage = {
      role: 'user',
      content: input.options?.userContent ?? input.content,
      timestamp: nowMs(),
    };

    let responseText = '';
    let sawStructuredToolCall = false;
    const structuredToolCallingEvidenceGate = { recorded: false };
    unsubscribe = activeSlot.agent.subscribe((event: CoreAgentEvent) => {
      if (event.type === 'message_update') {
        const ev = event.assistantMessageEvent;
        if (ev.type === 'text_delta' && typeof ev.delta === 'string') {
          input.options?.onChunk?.(ev.delta);
        }
        if (ev.type === 'toolcall_end') {
          sawStructuredToolCall = true;
          claimStructuredToolCallingEvidence(
            ev.type,
            routeCapability,
            structuredToolCallingEvidenceGate,
          );
        }
      }
      if (event.type === 'tool_execution_end' && !event.result.isError) {
        if (claimStructuredToolCallingEvidence(
          event.type,
          routeCapability,
          structuredToolCallingEvidenceGate,
        )) {
          try {
            recordObservedToolCallingSupport(
              input.providerId,
              effectiveModel?.modelId ?? input.modelId,
              settingsService.getAll(),
              requestPlan.route.protocol,
            );
          } catch (error) {
            runtimeLogService.log({
              scope: 'session',
              namespace: 'agent',
              severity: 'warning',
              title: 'Tool capability evidence was not persisted',
              summary: error instanceof Error ? error.message : String(error),
              sessionId: executionScopeId,
              projectId: input.projectId,
              runId: input.runId,
              raw: {
                providerId: input.providerId,
                modelId: effectiveModel?.modelId ?? input.modelId,
                protocol: requestPlan.route.protocol,
              },
            });
          }
        }
      }
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        responseText = event.message.content
          .filter((block) => block.type === 'text')
          .map((block) => (block as { text: string }).text)
          .join('');
        if (event.message.usage && isSuccessfulProviderResponse(event.message)) {
          // 按当前实际注入的工具定义计量（含本 turn 内新激活的 deferred 工具）；
          // deferred 段仅计未激活 schema 估算，且仅在 >0 时加入。
          const injectedDefs = activeSlot.agent.state.tools ?? [];
          const { deferredMcp: deferredMcpDefs, deferredBuiltin: deferredBuiltinDefs } = partitionDeferredTools(
            runtimeTools.definitions,
            activeSlot.activatedDeferredTools,
          );
          const isMcpDef = (d: ToolDefinition) => isMcpPrefixedToolName(d.name);
          const isSubagentDef = (d: ToolDefinition) => d.name === 'subagent';
          const mcpDefs = injectedDefs.filter(isMcpDef);
          const subagentDefs = injectedDefs.filter(isSubagentDef);
          const systemDefs = injectedDefs.filter((d) => !isMcpDef(d) && !isSubagentDef(d));

          const pm = promptPlan.metrics;
          const systemPromptChars = pm
            ? pm.systemPrompt
            : promptPlan.systemPrompt.length;
          const rulesChars    = pm?.scopedInstructions ?? 0;
          const skillsChars   = pm?.skills ?? 0;

          // 压缩统计：在 message_end 时对当前 agent 的消息历史分类。
          const compressionStats = activeSlot.contextManager.classifyMessages(
            activeSlot.agent.messages as import('../core/types').AgentMessage[],
          );

          const precomputedBreakdown: ContextUsageBreakdownEntry[] = [
            { id: 'system_prompt', tokens: charsToTokens(systemPromptChars) },
            ...(rulesChars > 0 ? [{ id: 'memory_files' as const, tokens: charsToTokens(rulesChars) }] : []),
            ...(skillsChars > 0 ? [{ id: 'skills' as const, tokens: charsToTokens(skillsChars) }] : []),
            { id: 'system_tools',          tokens: charsToTokens(JSON.stringify(systemDefs).length),   count: systemDefs.length },
            ...(mcpDefs.length > 0
              ? [{
                  id: 'mcp_tools' as const,
                  tokens: charsToTokens(JSON.stringify(mcpDefs).length),
                  count: mcpDefs.length,
                }]
              : []),
            ...(deferredMcpDefs.length > 0
              ? [{
                  id: 'mcp_tools_deferred' as const,
                  tokens: charsToTokens(JSON.stringify(deferredMcpDefs).length),
                  count: deferredMcpDefs.length,
                }]
              : []),
            ...(deferredBuiltinDefs.length > 0
              ? [{
                  id: 'builtin_tools_deferred' as const,
                  tokens: charsToTokens(JSON.stringify(deferredBuiltinDefs).length),
                  count: deferredBuiltinDefs.length,
                }]
              : []),
            ...(subagentDefs.length > 0
              ? [{
                  id: 'subagent_definitions' as const,
                  tokens: charsToTokens(JSON.stringify(subagentDefs).length),
                  count: subagentDefs.length,
                }]
              : []),
            ...(compressionStats.summaryTokens > 0
              ? [{ id: 'summarized_conversation' as const, tokens: compressionStats.summaryTokens }]
              : []),
            { id: 'conversation', tokens: compressionStats.conversationTokens, count: compressionStats.conversationCount },
          ];

          debuggerLlmService.recordAgentTurnUsage({
            runId: input.runId,
            turnId: turnHandle.turnId,
            sessionId: executionScopeId,
            providerId: input.providerId,
            modelId: input.modelId,
            inputTokens: event.message.usage.inputTokens,
            outputTokens: event.message.usage.outputTokens,
            ...reportedUsageFields(event.message.usage),
            ...(event.message.usage.cost ? { cost: event.message.usage.cost } : {}),
            precomputedBreakdown,
          });
        }
        const diagnosticIsLive = turnHandle.isLive(turnGeneration);
        if (diagnosticIsLive && isSuccessfulProviderResponse(event.message) && !sawStructuredToolCall && !responseText.trim()) {
          input.options?.onEvent?.(buildDiagnosticAgentEvent(sharedEventContext, {
            code: 'empty_response_without_tool_call',
            severity: 'warning',
            message: 'Provider returned an empty assistant message without a structured tool call.',
          }));
        } else if (diagnosticIsLive && isSuccessfulProviderResponse(event.message) && !sawStructuredToolCall && mentionsTextualToolCall(responseText)) {
          input.options?.onEvent?.(buildDiagnosticAgentEvent(sharedEventContext, {
            code: 'textual_tool_call_not_executed',
            severity: 'warning',
            message: 'The model wrote a textual tool call, but no structured provider tool call was returned. No tool was executed.',
            technicalMessage: responseText.slice(0, 1200),
          }));
        }
      }
      const sharedEvent = translateCoreToSharedAgentEvent(event, sharedEventContext);
      if (sharedEvent) {
        if (turnHandle.isLive(turnGeneration)) {
          turnHandle.eventSink?.onEvent?.(sharedEvent);
        }
      }
    });

    // abort 信号桥接到 Agent.abort()；同时注册为 turn producer。
    unregisterAgentProducer = turnHandle.registerProducer({
      id: `agent:${slotKey}`,
      abort: () => {
        try {
            activeSlot.agent.abort();
        } catch {
          // ignore
        }
      },
      join: async () => {
        await activeSlot.agent.abortAndJoin();
      },
    });
    if (input.options?.signal) {
      if (input.options.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      abortListener = () => {
        void turnHandle.abortAndJoin({ reason: 'user_stop' });
      };
      input.options.signal.addEventListener('abort', abortListener, { once: true });
    }

    const initialMessageCount = activeSlot.agent.messages.length;
    const settleDirectTasks = (stopped: boolean) => settleUnfinishedDirectTasks({ sessionId: input.sessionId, turnId: turnHandle.turnId, generation: turnHandle.generation, stopped });
    let terminalStatus: 'complete' | 'stopped' | 'error' = 'complete';
    try {
      await activeSlot.agent.prompt(userMessage);
      if (await settleDirectTasks(false)) throw new Error('TASK_COMPLETION_DENIED: Direct Task executions must be settled before the parent turn completes.');
      if (turnHandle.completionDeclaration?.disposition === 'cancelled' && !turnHandle.isAborted) {
        throw new Error('TURN_COMPLETION_INVALID: cancelled requires an actual abort and joined execution.');
      }
      const completionInput = {
        profileId: input.agentId,
        completionContract: turnHandle.runtimePlan?.completionContract,
        investigationMission: turnHandle.runtimePlan?.investigationMission ?? undefined,
        turnId: turnHandle.turnId,
        sessionId: executionScopeId,
        finalAnswerText: responseText,
        disposition: turnHandle.completionDeclaration?.disposition,
        evidenceRefs: turnHandle.completionDeclaration?.evidenceRefs,
      };
      this.deps.validateCompletion(completionInput);
      return responseText;
    } catch (error) {
      terminalStatus = input.options?.signal?.aborted || turnHandle.isAborted ? 'stopped' : 'error';
      if (terminalStatus !== 'stopped') await settleDirectTasks(false);
      if (terminalStatus === 'error' && isExplicitStructuredToolCallingRejection(error)) {
        try {
          recordObservedToolCallingUnsupported(
            input.providerId,
            effectiveModel?.modelId ?? input.modelId,
            settingsService.getAll(),
            requestPlan.route.protocol,
            error instanceof Error ? error.message : String(error),
          );
        } catch (persistError) {
          runtimeLogService.log({
            scope: 'session',
            namespace: 'agent',
            severity: 'warning',
            title: 'Tool capability rejection was not persisted',
            summary: persistError instanceof Error ? persistError.message : String(persistError),
            sessionId: executionScopeId,
            projectId: input.projectId,
            runId: input.runId,
            raw: {
              providerId: input.providerId,
              modelId: effectiveModel?.modelId ?? input.modelId,
              protocol: requestPlan.route.protocol,
            },
          });
        }
      }
      throw error;
    } finally {
      if (turnHandle.isAborted) {
        await activeSlot.agent.abortAndJoin();
      }
      unsubscribe?.();
      unregisterAgentProducer?.();
      if (abortListener && input.options?.signal) {
        input.options.signal.removeEventListener('abort', abortListener);
      }
      cancelTurnInteractionRequests(turnHandle.turnId);
      input.terminalContext?.(activeSlot.agent.messages.slice(initialMessageCount) as Message[], terminalStatus, turnHandle.pendingHandoff ?? undefined, turnHandle.completionDeclaration, terminalStatus === 'complete' ? turnHandle.approvedPlan : null);
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
      turnEnded = true;
      await dispatchRuntimeHooks('turn.after-end', {
        agentId: input.agentId,
        sessionId: executionScopeId,
        projectRoot: input.projectRootPath ?? undefined,
        payload: { turnId: turnHandle.turnId },
      });
      setupCleanupComplete = true;
    }
    } catch (error) {
      if (!setupCleanupComplete) {
        if (abortListener && input.options?.signal) {
          input.options.signal.removeEventListener('abort', abortListener);
        }
        unsubscribe?.();
        unregisterAgentProducer?.();
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
        if (!turnEnded) {
          turnCoordinator.endTurn(turnHandle);
          turnEnded = true;
          await dispatchRuntimeHooks('turn.after-end', {
            agentId: input.agentId,
            sessionId: executionScopeId,
            projectRoot: input.projectRootPath ?? undefined,
            payload: { turnId: turnHandle.turnId },
          });
        }
        setupCleanupComplete = true;
      }
      throw error;
    }
  }
}
