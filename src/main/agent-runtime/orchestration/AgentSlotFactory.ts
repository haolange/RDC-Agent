/**
 * AgentSlotFactory — builds or reuses the per-scope Agent execution cache.
 *
 * The slot is only an execution cache; every turn rehydrates from the canonical
 * session journal passed in as `initialMessages`.
 */

import type { AgentRole } from '@shared/types/agent';
import type { AgentRouteCapability } from '@shared/types/agentRuntime';
import type { PromptPlan } from '@shared/types/rdcRuntime';
import { charsToTokens } from '@shared/utils/tokens';
import { resolveTurnOutputTokens } from '@shared/utils/contextBudget';
import { Agent } from '../agent/Agent';
import type { AgentLoopConfig, ToolExecutor } from '../agent/AgentLoop';
import { ErrorRecovery } from '../agent/ErrorRecovery';
import { resolveAgentMaxTurns } from '../agent/ExecutionLimits';
import { createExecutionContextManager } from '../context/ExecutionContextWindow';
import type { TokenizerService } from '../core/TokenizerService';
import type {
  AgentMessage,
  AssistantMessage,
  Message,
  StreamOptions,
  ToolDefinition,
  Usage,
} from '../core/types';
import { resolveAgentRouteCapability } from '../capabilities/RouteCapabilityResolver';
import { RUNTIME_PERMISSION_TOKEN_RESERVE } from '../permissions/RuntimePermissionContext';
import { runtimePermissionStateService } from '../permissions/RuntimePermissionStateService';
import { requestEnvelopeBuilder, requestSnapshotStore } from '../prompt';
import { promptCacheCompiler } from '../prompt/PromptCacheCompiler';
import { configuredRuntimeProvider, encodeAgentModel } from '../providers/ConfiguredRuntimeProvider';
import { recordEffectivePlanSuccess, resolveEffectiveModel } from '../../settings/provider-catalog/EffectiveModelResolver';
import { settingsService } from '../../settings/settings-core/SettingsService';
import { agentSlotKey, type AgentSlot, type AgentSlotRegistry } from './AgentSlotRegistry';
import type { DeferredToolActivationTracker } from './DeferredToolActivationTracker';
import { requireExecutionScopeId } from './executionScope';
import type { AgentProfileTurnOptions } from './orchestratorTypes';

/** A provider response that actually completed (not a transport/stream error). */
export function isSuccessfulProviderResponse(message: AssistantMessage): boolean {
  return message.stopReason !== 'error';
}

/** Optional provider usage counters, copied only when the provider reported them. */
export function reportedUsageFields(usage: Usage): Partial<Pick<Usage,
  'cacheReadTokens' | 'cacheWriteTokens' | 'cacheHitTokens' | 'cacheMissTokens' | 'reasoningTokens'>> {
  return {
    ...(typeof usage.cacheReadTokens === 'number' ? { cacheReadTokens: usage.cacheReadTokens } : {}),
    ...(typeof usage.cacheWriteTokens === 'number' ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
    ...(typeof usage.cacheHitTokens === 'number' ? { cacheHitTokens: usage.cacheHitTokens } : {}),
    ...(typeof usage.cacheMissTokens === 'number' ? { cacheMissTokens: usage.cacheMissTokens } : {}),
    ...(typeof usage.reasoningTokens === 'number' ? { reasoningTokens: usage.reasoningTokens } : {}),
  };
}

export interface AgentSlotFactoryDeps {
  slots: AgentSlotRegistry;
  deferredActivation: DeferredToolActivationTracker;
  tokenizerService: TokenizerService;
  createToolSignature: (tools: ToolDefinition[]) => string;
}

export interface AgentSlotRequest {
  agentId: AgentRole;
  providerId: string;
  modelId: string;
  systemPrompt: string;
  streamOptions: StreamOptions;
  tools: ToolDefinition[];
  toolExecutor: ToolExecutor;
  turnSignature: string;
  sessionId: string;
  contextWindow: number | undefined;
  contextTokenLimit: number;
  promptPlan?: PromptPlan;
  initialMessages: Message[];
  contextDiagnostic?: Record<string, unknown>;
  /** Slot cache key tools; defaults to `tools`. Pass every available tool for stable reuse. */
  signatureTools?: ToolDefinition[];
  routeCapabilityOverride?: AgentRouteCapability;
  policyMaxTurns?: number;
  profileMaxTurns?: number | null;
  beforeRequestMessages?: AgentLoopConfig['beforeRequestMessages'];
  beforeTerminalResponse?: AgentLoopConfig['beforeTerminalResponse'];
  onLoopBudget?: AgentLoopConfig['onLoopBudget'];
  resolvePromptPlan?: () => PromptPlan;
  resolveRuntimeFingerprint?: () => string;
  onProviderRequestCommitted?: AgentProfileTurnOptions['onProviderRequestCommitted'];
}

export function createOrReuseAgentSlot(deps: AgentSlotFactoryDeps, request: AgentSlotRequest): AgentSlot {
  const {
    agentId, providerId, modelId, systemPrompt, streamOptions, tools, toolExecutor, turnSignature,
    contextWindow, contextTokenLimit, promptPlan, initialMessages, contextDiagnostic, signatureTools,
    routeCapabilityOverride, policyMaxTurns, profileMaxTurns, beforeRequestMessages, beforeTerminalResponse, onLoopBudget, resolvePromptPlan, resolveRuntimeFingerprint, onProviderRequestCommitted,
  } = request;
  if (!promptPlan) {
    throw new Error('PromptPlan is required before creating an agent runtime slot.');
  }
  const executionScopeId = requireExecutionScopeId(request.sessionId);
  const slotKey = agentSlotKey(executionScopeId, agentId);
  if (deps.slots.isQuarantined(slotKey)) {
    throw new Error(`AGENT_SLOT_QUARANTINED: ${slotKey} is still owned by an orphaned turn.`);
  }
  const toolSignature = deps.createToolSignature(signatureTools ?? tools);
  const activeContextWindow = contextWindow ?? streamOptions.requestPlan.contextWindowTokens;
  const requestCompactionThreshold = contextTokenLimit;
  const fixedPromptTokens = promptPlan.totalTokenEstimate + charsToTokens(JSON.stringify(tools).length);
  const resolvedContextTokenLimit = requestCompactionThreshold - fixedPromptTokens;
  if (resolvedContextTokenLimit <= 0) {
    throw new Error('PROMPT_OVERHEAD_EXCEEDS_BUDGET: system prompt and tool schemas leave no conversation budget.');
  }
  const existing = deps.slots.getSlot(slotKey);
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
  ) {
    // Reuse: rehydrate from the canonical history, then swap tools (copy-on-write).
    existing.activatedDeferredTools = deps.deferredActivation.resolveActivatedSet(slotKey, toolSignature);
    deps.slots.rehydrate(existing, initialMessages as AgentMessage[]);
    existing.agent.setTools(tools);
    return existing;
  }

  const agentModel = encodeAgentModel(providerId, modelId, {
    contextWindow: activeContextWindow,
    maxOutputTokens: streamOptions.requestPlan.maxOutputTokens,
  });
  const routeProvider = settingsService.getAll().llm.providers.find((provider) => provider.id === providerId);
  const reasoningContract = (routeCapabilityOverride ?? resolveAgentRouteCapability(
    routeProvider,
    modelId,
    resolveEffectiveModel(providerId, modelId, settingsService.getAll()),
  )).reasoningContract;

  const contextManager = createExecutionContextManager({
    sessionId: executionScopeId, provider: routeProvider,
    model: resolveEffectiveModel(providerId, modelId, settingsService.getAll()),
    plan: streamOptions.requestPlan, credentialHandle: streamOptions.credentialHandle,
    config: { modelId, contextTokenLimit: resolvedContextTokenLimit, tokenizer: deps.tokenizerService },
  });

  const errorRecovery = new ErrorRecovery({ primaryModel: agentModel });
  const toolSchemaTokens = (): number => charsToTokens(JSON.stringify(agent.state.tools).length);

  const agent: Agent = new Agent({
    initialState: {
      model: agentModel,
      systemPrompt,
      systemPromptSegments: promptPlan.segments,
      tools,
      messages: initialMessages,
    },
    provider: configuredRuntimeProvider,
    resolvePermissionState: () => runtimePermissionStateService.getSnapshot(),
    toolExecutor,
    streamOptions,
    maxTurns: resolveAgentMaxTurns(policyMaxTurns, profileMaxTurns),
    beforeTerminalResponse,
    onLoopBudget,
    resolvePromptPlan,
    transformContext: (messages, signal, onProgress) => {
      contextManager.setRequestTokenLimit(
        requestCompactionThreshold - (resolvePromptPlan?.() ?? promptPlan).totalTokenEstimate - RUNTIME_PERMISSION_TOKEN_RESERVE - toolSchemaTokens(),
      );
      return contextManager.compress(messages, signal, onProgress);
    },
    errorRecovery,
    resolveMaxTokens: (messages) => resolveTurnOutputTokens({
      contextWindowTokens: streamOptions.requestPlan.contextWindowTokens,
      maxOutputTokens: streamOptions.requestPlan.maxOutputTokens,
      promptTokens: (resolvePromptPlan?.() ?? promptPlan).totalTokenEstimate + RUNTIME_PERMISSION_TOKEN_RESERVE + toolSchemaTokens()
        + deps.tokenizerService.countMessagesTokens(messages, modelId),
    }),
    onRequest: async ({ model, context: requestContext, streamOptions: requestOptions, mailboxDeliveries }) => {
      const callIndex = requestSnapshotStore.nextCallIndex(executionScopeId, turnSignature || undefined);
      const currentPrompt = resolvePromptPlan?.() ?? promptPlan;
      const actualSegments = requestContext.systemPromptSegments ?? currentPrompt.segments;
      const snapshot = requestEnvelopeBuilder.build({
        promptPlan: { ...currentPrompt, segments: actualSegments, systemPrompt: requestContext.systemPrompt ?? currentPrompt.systemPrompt,
          totalTokenEstimate: actualSegments.reduce((sum, segment) => sum + segment.tokenEstimate, 0) },
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
        mailboxDeliveries,
        tools: requestContext.tools ?? [],
        controls: {
          temperature: requestOptions.temperature,
          maxTokens: requestOptions.maxTokens,
          topP: requestOptions.topP,
          reasoningSelection: requestOptions.reasoning?.selection,
          contextDiagnostic,
          runtimePermissionContext: requestContext.systemPromptSegments?.find((segment) => segment.id === 'runtime:permission'),
          runtimePlanFingerprint: resolveRuntimeFingerprint?.(),
        },
        reasoning: reasoningContract,
        cache: requestOptions.promptCache ?? streamOptions.promptCache ?? promptCacheCompiler.compile({
          promptPlan,
          requestPlan: requestOptions.requestPlan,
          tools: requestContext.tools ?? [],
        }),
      });
      requestSnapshotStore.write(snapshot);
      await onProviderRequestCommitted?.(snapshot.id);
      return snapshot.id;
    },
    onResponse: (requestId, message) => {
      if (!requestId || !isSuccessfulProviderResponse(message)) return;
      recordEffectivePlanSuccess(providerId, modelId, settingsService.getAll(), streamOptions.requestPlan);
      requestSnapshotStore.complete(requestId, executionScopeId, turnSignature || undefined, {
        inputTokens: message.usage.inputTokens,
        outputTokens: message.usage.outputTokens,
        ...reportedUsageFields(message.usage),
        estimated: false,
      });
    },
    beforeRequestMessages,
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
    activatedDeferredTools: deps.deferredActivation.resolveActivatedSet(slotKey, toolSignature),
  };
  deps.slots.setSlot(slotKey, slot);
  return slot;
}
