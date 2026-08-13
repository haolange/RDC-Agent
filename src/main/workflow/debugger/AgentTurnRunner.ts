/**
 * AgentTurnRunner — runAgentTurn + agent slot creation/reuse.
 */

import type { AgentRole } from '@shared/types/agent';
import type { AgentRouteCapability } from '@shared/types/agentRuntime';
import type { AppMode, ContextUsageBreakdownEntry } from '@shared/types/session';
import type { WorkflowStage } from '@shared/types/workflow';
import type { EffectiveAgentProfile, PromptPlan } from '@shared/types/rdxRuntime';
import type { EffectiveModel } from '@shared/types/providerCapability';
import { CONTEXT_COMPACTION_RATIO } from '@shared/types/modelCapability';
import { generateEventId, nowMs } from '@shared/utils/id';
import { charsToTokens } from '@shared/utils/tokens';
import { Agent } from '../../agent-runtime/agent/Agent';
import { ContextManager } from '../../agent-runtime/agent/ContextManager';
import { TokenizerService } from '../../agent-runtime/core/TokenizerService';
import { ErrorRecovery } from '../../agent-runtime/agent/ErrorRecovery';
import type { ToolExecutor } from '../../agent-runtime/agent/AgentLoop';
import {
  requestEnvelopeBuilder,
  requestSnapshotStore,
} from '../../agent-runtime/prompt';
import { promptCacheCompiler } from '../../agent-runtime/prompt/PromptCacheCompiler';
import {
  encodeAgentModel,
  configuredRuntimeProvider,
} from '../../agent-runtime/providers/ConfiguredRuntimeProvider';
import {
  claimStructuredToolCallingEvidence,
  describeRouteCapabilityDiagnostic,
  resolveAgentRouteCapability,
} from '../../agent-runtime/capabilities/RouteCapabilityResolver';
import {
  buildDiagnosticAgentEvent,
  mentionsTextualToolCall,
  translateCoreToSharedAgentEvent,
  type AgentEventBridgeContext,
} from '../../agent-runtime/AgentEventBridge';
import { agentUserInputRequestService } from '../../agent-runtime/interactions/AgentUserInputRequestService';
import { agentToolApprovalRequestService } from '../../agent-runtime/permissions/AgentToolApprovalRequestService';
import type {
  AssistantMessage,
  AgentEvent as CoreAgentEvent,
  Message,
  StreamOptions,
  ToolDefinition,
  UserMessage,
} from '../../agent-runtime/core/types';
import { runtimeLogService } from '../../runtime/RuntimeLogService';
import {
  recordEffectivePlanSuccess,
  recordObservedToolCallingSupport,
  resolveEffectiveModel,
} from '../../settings/EffectiveModelResolver';
import { debuggerLlmService } from '../../settings/DebuggerLlmService';
import { settingsService } from '../../settings/SettingsService';
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

export function hasActualProviderUsage(message: AssistantMessage): boolean {
  return message.stopReason !== 'error';
}

export interface AgentTurnRunnerDeps {
  slots: AgentSlotRegistry;
  mcp: McpConnectionCoordinator;
  deferredActivation: DeferredToolActivationTracker;
  tokenizerService: TokenizerService;
  sessionTurnKey: (sessionId?: string | null) => string;
  resolveRuntimeTools: (
    agentId: AgentRole,
    toolAllowlist: string[],
    stage?: WorkflowStage | 'report',
    sessionId?: string | null,
    turnHandle?: import('./TurnCoordinator').TurnHandle | null,
    projectId?: string | null,
    projectRootPath?: string | null,
    mcpPoolKey?: string | null,
  ) => ResolvedRuntimeTools;
  createToolSignature: (tools: ToolDefinition[]) => string;
  createToolExecutor: (
    agentId: AgentRole,
    toolAllowlist: string[],
    stage?: WorkflowStage | 'report',
    sessionId?: string | null,
    runtimeContext?: ToolExecutorRuntimeContext,
  ) => ToolExecutor;
}

export class AgentTurnRunner {
  constructor(private readonly deps: AgentTurnRunnerDeps) {}

  resolveMaxTurns(agentId: AgentRole, policyMaxTurns?: number, profileMaxTurns?: number | null): number {
    const defaultMax = agentId === 'edit' || agentId === 'debugger' || agentId === 'optimizer' ? 50 : 25;
    const profileMax = typeof profileMaxTurns === 'number' && profileMaxTurns > 0
      ? profileMaxTurns
      : defaultMax;
    if (typeof policyMaxTurns === 'number' && Number.isFinite(policyMaxTurns)) {
      if (policyMaxTurns === 0) {
        throw new Error('POLICY_MAX_TURNS_ZERO: maxTurns must be greater than zero for an executable turn.');
      }
      if (policyMaxTurns > 0) return Math.min(policyMaxTurns, profileMax);
    }
    return profileMax;
  }

  getOrCreateAgentSlot(
    agentId: AgentRole,
    providerId: string,
    modelId: string,
    systemPrompt: string,
    streamOptions: StreamOptions,
    tools: ToolDefinition[] = [],
    toolExecutor = this.deps.createToolExecutor(agentId, [], undefined),
    turnSignature = '',
    sessionId: string = '',
    contextWindow?: number,
    contextTokenLimit?: number,
    promptPlan?: PromptPlan,
    initialMessages: Message[] = [],
    contextDiagnostic?: Record<string, unknown>,
    /** 用于 slot cache key；默认与注入 tools 相同。应传入全部可用工具以稳定复用。 */
    signatureTools?: ToolDefinition[],
    routeCapabilityOverride?: AgentRouteCapability,
    policyMaxTurns?: number,
    profileMaxTurns?: number | null,
  ): AgentSlot {
    if (!promptPlan) {
      throw new Error('PromptPlan is required before creating an agent runtime slot.');
    }
    const executionScopeId = requireExecutionScopeId(sessionId);
    const slotKey = agentSlotKey(executionScopeId, agentId);
    if (this.deps.slots.isQuarantined(slotKey)) {
      throw new Error(`AGENT_SLOT_QUARANTINED: ${slotKey} is still owned by an orphaned turn.`);
    }
    const toolSignature = this.deps.createToolSignature(signatureTools ?? tools);
    const activeContextWindow = contextWindow ?? streamOptions.requestPlan.contextWindowTokens;
    const requestCompactionThreshold = contextTokenLimit
      ?? Math.floor(activeContextWindow * CONTEXT_COMPACTION_RATIO);
    const fixedPromptTokens = promptPlan.totalTokenEstimate + charsToTokens(JSON.stringify(tools).length);
    const resolvedContextTokenLimit = requestCompactionThreshold - fixedPromptTokens;
    if (resolvedContextTokenLimit <= 0) {
      throw new Error('PROMPT_OVERHEAD_EXCEEDS_BUDGET: system prompt and tool schemas leave no conversation budget.');
    }
    const existing = this.deps.slots.getSlot(slotKey);
    if (existing?.agent.isStreaming) {
      throw new Error(`AGENT_SLOT_BUSY: ${slotKey} has not completed its previous provider loop.`);
    }
    if (
      existing
      && existing.providerId === providerId
      && existing.modelId === modelId
      && existing.systemPrompt === systemPrompt
      && existing.toolSignature === toolSignature
      && existing.turnSignature === turnSignature
      && existing.contextTokenLimit === resolvedContextTokenLimit
      && !existing.agent.isStreaming
    ) {
      // 复用 slot：从磁盘权威 history rehydrate，再同步 tools（COW）。
      existing.activatedDeferredTools = this.deps.deferredActivation.resolveActivatedSet(slotKey, toolSignature);
      this.deps.slots.rehydrate(existing, initialMessages as import('../../agent-runtime/core/types').AgentMessage[]);
      existing.agent.setTools(tools);
      return existing;
    }

    // Every turn starts from the active branch materialized by the canonical
    // session journal. The in-memory slot is only an execution cache.
    const agentModel = encodeAgentModel(providerId, modelId, { contextWindow: activeContextWindow });
    const routeProvider = settingsService.getAll().llm.providers.find((provider) => provider.id === providerId);
    const reasoningContract = (routeCapabilityOverride ?? resolveAgentRouteCapability(
      routeProvider,
      modelId,
      resolveEffectiveModel(providerId, modelId, settingsService.getAll()),
    )).reasoningContract;

    const contextManager = new ContextManager({
      modelId,
      contextTokenLimit: resolvedContextTokenLimit,
      toolResultBudget: 200 * 1024,
      keepRecentToolResults: 3,
      tokenizer: this.deps.tokenizerService,
    });

    // ErrorRecovery：错误分类与恢复策略（retry/escalate_tokens/reactive_compact/continue/abort）。
    // fallbackModel 暂省略（无 settings route fallback 配置时只做非 switch 恢复）。
    const errorRecovery = new ErrorRecovery({ primaryModel: agentModel });

    const agent = new Agent({
      initialState: {
        model: agentModel,
        systemPrompt,
        systemPromptSegments: promptPlan.segments,
        tools,
        messages: initialMessages,
      },
      provider: configuredRuntimeProvider,
      toolExecutor,
      streamOptions,
      maxTurns: this.resolveMaxTurns(agentId, policyMaxTurns, profileMaxTurns),
      // transformContext：长对话接近窗口上限时自动压缩历史。
      transformContext: (messages, signal) => contextManager.compress(messages, signal),
      // errorRecovery：provider 错误后自动恢复（重试/提额/压缩/中止）。
      errorRecovery,
      onRequest: ({ model, context: requestContext, streamOptions: requestOptions }) => {
        const callIndex = requestSnapshotStore.nextCallIndex(executionScopeId, turnSignature || undefined);
        const snapshot = requestEnvelopeBuilder.build({
          promptPlan,
          sessionId: executionScopeId,
          turnId: turnSignature || undefined,
          callIndex,
          route: {
            providerId,
            modelId: requestOptions.requestPlan.effectiveModelId,
            protocol: requestOptions.requestPlan.route.protocol ?? routeProvider?.protocol ?? model.api,
          },
          requestPlan: requestOptions.requestPlan,
          messages: requestContext.messages,
          tools: requestContext.tools ?? [],
          controls: {
            temperature: requestOptions.temperature,
            maxTokens: requestOptions.maxTokens,
            topP: requestOptions.topP,
            reasoningSelection: requestOptions.reasoning?.selection,
            contextDiagnostic,
          },
          reasoning: reasoningContract,
          cache: requestOptions.promptCache ?? streamOptions.promptCache ?? promptCacheCompiler.compile({
            promptPlan,
            requestPlan: requestOptions.requestPlan,
            tools: requestContext.tools ?? [],
          }),
        });
        requestSnapshotStore.write(snapshot);
        return snapshot.id;
      },
      onResponse: (requestId, message) => {
        if (!requestId || !hasActualProviderUsage(message)) return;
        recordEffectivePlanSuccess(providerId, modelId, settingsService.getAll(), streamOptions.requestPlan);
        requestSnapshotStore.complete(requestId, executionScopeId, turnSignature || undefined, {
          inputTokens: message.usage.inputTokens,
          outputTokens: message.usage.outputTokens,
          ...(typeof message.usage.cacheReadTokens === 'number'
            ? { cacheReadTokens: message.usage.cacheReadTokens }
            : {}),
          ...(typeof message.usage.cacheWriteTokens === 'number'
            ? { cacheWriteTokens: message.usage.cacheWriteTokens }
            : {}),
          ...(typeof message.usage.cacheHitTokens === 'number'
            ? { cacheHitTokens: message.usage.cacheHitTokens }
            : {}),
          ...(typeof message.usage.cacheMissTokens === 'number'
            ? { cacheMissTokens: message.usage.cacheMissTokens }
            : {}),
          ...(typeof message.usage.reasoningTokens === 'number'
            ? { reasoningTokens: message.usage.reasoningTokens }
            : {}),
          estimated: false,
        });
      },
    });

    const slot: AgentSlot = {
      agent,
      contextManager,
      providerId,
      modelId,
      systemPrompt,
      toolSignature,
      turnSignature,
      contextTokenLimit: resolvedContextTokenLimit,
      activatedDeferredTools: this.deps.deferredActivation.resolveActivatedSet(slotKey, toolSignature),
    };
    this.deps.slots.setSlot(slotKey, slot);
    return slot;
  }

  async runAgentTurn(input: {
    agentId: AgentRole;
    content: string;
    systemPrompt: string;
    providerId: string;
    modelId: string;
    maxTokens?: number;
    temperature?: number;
    mode: AppMode;
    stage?: WorkflowStage | 'report';
    runId?: string;
    sessionId?: string | null;
    turnId?: string;
    toolAllowlist: string[];
    options?: AgentTurnOptions;
    projectRootPath?: string | null;
    projectId?: string | null;
    /** Ask 路径由 ConversationService 传入的 prompt 分段字符数，用于细化 breakdown。 */
    promptPlan: PromptPlan;
    effectiveModel?: EffectiveModel;
    effectiveProfile?: EffectiveAgentProfile | null;
    effectiveProfileIds?: readonly string[];
    credentialHandle?: string;
    contextWindow?: number;
    contextTokenLimit?: number;
    initialMessages?: Message[];
    contextDiagnostic?: Record<string, unknown>;
    preparedRuntime?: PreparedAgentRuntime;
    terminalContext?: (messages: Message[], status: 'complete' | 'stopped' | 'error', pendingHandoff?: import('./TurnCoordinator').PendingHandoff) => void;
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
    const turnGeneration = turnHandle.generation;
    turnHandle.eventSink = {
      onEvent: (event) => {
        if (!turnHandle.isLive(turnGeneration)) return;
        input.options?.onEvent?.(event);
      },
      sessionId: executionScopeId,
      projectRootPath: input.projectRootPath ?? null,
      projectId: input.projectId ?? null,
      agentId: input.agentId,
    };

    const frozenToolAllowlist = [...preparedRuntime.effectivePlan.toolAllowlist];
    const liveRuntimeTools = this.deps.resolveRuntimeTools(
      input.agentId,
      frozenToolAllowlist,
      input.stage,
      executionScopeId,
      turnHandle,
      input.projectId,
      input.projectRootPath,
      mcpLease?.poolKey ?? null,
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
      stage: input.stage,
      mode: input.mode,
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
    const toolExecutor = this.deps.createToolExecutor(input.agentId, executorAllowlist, input.stage, executionScopeId, {
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
    });
    const promptCache = preparedRuntime.promptCache;
    const streamOptions: StreamOptions = {
      maxTokens: input.maxTokens,
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
    slot = this.getOrCreateAgentSlot(
      input.agentId,
      input.providerId,
      input.modelId,
      input.systemPrompt,
      streamOptions,
      activeToolDefinitions,
      toolExecutor,
      input.turnId ?? '',
      executionScopeId,
      input.contextWindow,
      input.contextTokenLimit,
      input.promptPlan,
      input.initialMessages,
      input.contextDiagnostic,
      runtimeTools.definitions,
      routeCapability,
      effectivePlan.policy.maxTurns === Number.MAX_SAFE_INTEGER
        ? undefined
        : effectivePlan.policy.maxTurns,
      effectivePlan.profileMaxTurns,
    );
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
          if (claimStructuredToolCallingEvidence(
            ev.type,
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
      }
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        responseText = event.message.content
          .filter((block) => block.type === 'text')
          .map((block) => (block as { text: string }).text)
          .join('');
        if (event.message.usage && hasActualProviderUsage(event.message)) {
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

          const pm = input.promptPlan?.metrics;
          const systemPromptChars = pm
            ? pm.systemPrompt
            : input.systemPrompt.length;
          const rulesChars    = pm?.scopedInstructions ?? 0;
          const skillsChars   = pm?.skills ?? 0;

          // 压缩统计：在 message_end 时对当前 agent 的消息历史分类。
          const compressionStats = activeSlot.contextManager.classifyMessages(
            activeSlot.agent.messages as import('../../agent-runtime/core/types').AgentMessage[],
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
            ...(typeof event.message.usage.cacheReadTokens === 'number'
              ? { cacheReadTokens: event.message.usage.cacheReadTokens }
              : {}),
            ...(typeof event.message.usage.cacheWriteTokens === 'number'
              ? { cacheWriteTokens: event.message.usage.cacheWriteTokens }
              : {}),
            ...(typeof event.message.usage.cacheHitTokens === 'number'
              ? { cacheHitTokens: event.message.usage.cacheHitTokens }
              : {}),
            ...(typeof event.message.usage.cacheMissTokens === 'number'
              ? { cacheMissTokens: event.message.usage.cacheMissTokens }
              : {}),
            ...(typeof event.message.usage.reasoningTokens === 'number'
              ? { reasoningTokens: event.message.usage.reasoningTokens }
              : {}),
            ...(event.message.usage.cost ? { cost: event.message.usage.cost } : {}),
            precomputedBreakdown,
          });
        }
        if (!sawStructuredToolCall && !responseText.trim()) {
          input.options?.onEvent?.(buildDiagnosticAgentEvent(sharedEventContext, {
            code: 'empty_response_without_tool_call',
            severity: 'warning',
            message: 'Provider returned an empty assistant message without a structured tool call.',
          }));
        } else if (!sawStructuredToolCall && mentionsTextualToolCall(responseText)) {
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
    let terminalStatus: 'complete' | 'stopped' | 'error' = 'complete';
    try {
      // Agent.prompt 内部跑完整循环；返回值是新增的全部消息，
      // 我们只在订阅里收集助手文本，最后返回 `responseText`。
      await activeSlot.agent.prompt(userMessage);
      return responseText;
    } catch (error) {
      terminalStatus = input.options?.signal?.aborted || turnHandle.isAborted ? 'stopped' : 'error';
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
      agentUserInputRequestService.cancelTurn(input.turnId);
      agentToolApprovalRequestService.cancelTurn(input.turnId);
      // Terminal context first (ConversationService persists to conversation.jsonl),
      // then flush in-memory slot messages — disk is the single source of truth.
      input.terminalContext?.(activeSlot.agent.messages.slice(initialMessageCount) as Message[], terminalStatus, turnHandle.pendingHandoff ?? undefined);
      this.deps.slots.flush(activeSlot);
      if (turnHandle.isAborted) {
        await turnHandle.abortAndJoin({ reason: turnHandle.reason ?? 'user_stop' });
      }
      if (turnHandle.isOrphaned) {
        // Reserve the key until the orphaned provider/tool loop actually settles.
        this.deps.slots.quarantineSlot(slotKey, activeSlot.agent.activeLoopPromise ?? Promise.resolve());
        this.deps.slots.deleteSlot(slotKey);
      }
      await mcpLease?.release({ discardIfIdle: turnHandle.isOrphaned });
      turnCoordinator.endTurn(turnHandle);
      turnEnded = true;
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
        }
        setupCleanupComplete = true;
      }
      throw error;
    }
  }
}
