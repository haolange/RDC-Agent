/**
 * TurnPreparationService — prepareTurnContext (compaction / cache / effectivePlan freeze).
 */

import { createHash } from 'crypto';
import type { AgentRole } from '@shared/types/agent';
import type { AgentRouteCapability } from '@shared/types/agentRuntime';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import { DEFAULT_CONTEXT_COMPACTION_PERCENT } from '@shared/types/modelCapability';
import type { EffectiveModel, RequestPlan } from '@shared/types/providerCapability';
import type { ContextUsageBreakdownEntry, PreparedTurnContextSummary } from '@shared/types/session';
import type { PromptPlan, EffectiveAgentProfile } from '@shared/types/rdxRuntime';
import { charsToTokens } from '@shared/utils/tokens';
import {
  resolveCompactionThresholdTokens,
  resolveEffectiveCompactionPercent,
} from '@shared/utils/contextBudget';
import { nowMs } from '@shared/utils/id';
import { turnPreparationWorkerPool } from '../../workers/TurnPreparationWorkerPool';
import { requestEnvelopeBuilder } from '../../agent-runtime/prompt';
import { promptCacheCompiler } from '../../agent-runtime/prompt/PromptCacheCompiler';
import { requestPlanHeaders } from '../../agent-runtime/providers/requestPlanWire';
import {
  buildEffectiveRuntimePlan,
} from '../../agent-runtime/EffectiveRuntimePlan';
import { compileEffectivePolicy } from '../../agent-runtime/permissions/PolicyCompiler';
import { sessionContextJournal } from '../../conversation/SessionContextJournal';
import {
  isWithinSessionCompactionLine,
  persistGeneratedSessionCompaction,
} from '../../agent-runtime/context/CompactionHandoffService';
import { ROOT_BRANCH_ID } from '@shared/types/conversationBranch';
import { storageAdapter } from '../../sessions/StorageAdapter';
import { agentRuntimeConfigService } from '../../settings/AgentRuntimeConfigService';
import { mcpDescriptorHash } from '../../settings/McpTrustService';
import { settingsService } from '../../settings/SettingsService';
import { agentSlotKey } from './AgentSlotRegistry';
import { resolveExecutionScopeId } from './executionScope';
import {
  combineActiveSkillAllowlists,
} from './DebuggerRuntimePolicy';
import {
  isMcpPrefixedToolName,
  partitionDeferredTools,
  preactivateTaskTools,
} from './deferredTools';
import type { DeferredToolActivationTracker } from './DeferredToolActivationTracker';
import type { McpConnectionCoordinator } from './McpConnectionCoordinator';
import type { TurnHandle } from './TurnCoordinator';
import type { UserMessage, ToolDefinition } from '../../agent-runtime/core/types';
import {
  countContinuationDecisions,
  type FrozenAttachmentManifestEntry,
  type PreparedAgentTurnContext,
  type ResolvedRuntimeTools,
} from './orchestratorTypes';

function aggregateMcpDescriptorHash(
  profile: EffectiveAgentProfile,
  projectRootPath: string | null,
): string | null {
  const enabledIds = new Set(profile.mcpServers);
  if (enabledIds.size === 0) return null;
  const hashes = agentRuntimeConfigService.listMcpServers(projectRootPath ?? undefined)
    .filter((server) => enabledIds.has(server.id) || enabledIds.has(server.name))
    .map((server) => mcpDescriptorHash(server))
    .sort();
  if (hashes.length === 0) return null;
  return createHash('sha256').update(JSON.stringify(hashes)).digest('hex').slice(0, 24);
}

function resolveSkillIntersection(
  profileSkills: readonly string[],
  toolAllowlist: readonly string[],
  projectRootPath: string | null,
  agentId: AgentRole,
): string[] | null {
  const skillAllowedLists: string[][] = [];
  for (const skillId of profileSkills) {
    const skill = agentRuntimeConfigService.loadSkill(skillId, projectRootPath ?? undefined, agentId);
    if (skill?.allowedTools?.length) {
      skillAllowedLists.push([...skill.allowedTools]);
    }
  }
  return combineActiveSkillAllowlists(toolAllowlist, skillAllowedLists);
}

export interface TurnPreparationServiceDeps {
  mcp: McpConnectionCoordinator;
  deferredActivation: DeferredToolActivationTracker;
  resolveRuntimeTools: (
    agentId: AgentRole,
    toolAllowlist: string[],
    sessionId?: string | null,
    turnHandle?: TurnHandle | null,
    projectId?: string | null,
    projectRootPath?: string | null,
    mcpPoolKey?: string | null,
    options?: { excludeRdxLeaseTools?: boolean },
  ) => ResolvedRuntimeTools;
  createToolSignature: (tools: ToolDefinition[]) => string;
}

export class TurnPreparationService {
  constructor(private readonly deps: TurnPreparationServiceDeps) {}

  async prepareTurnContext(input: {
    requestId: string;
    credentialHandle: string;
    turnId: string;
    agentId: AgentRole;
    content: UserMessage['content'];
    frozenUserContent?: UserMessage['content'];
    attachmentManifest?: FrozenAttachmentManifestEntry[];
    inlineTokenBudget?: number;
    imageTokenAdjustment: number;
    providerId: string;
    selectedModelId: string;
    effectiveModel: EffectiveModel;
    routeCapability: AgentRouteCapability;
    requestPlan: RequestPlan;
    turnControls: ConversationTurnControls;
    promptPlan: PromptPlan;
    effectiveProfile: EffectiveAgentProfile;
    effectiveProfileIds: string[];
    toolAllowlist: string[];
    projectRootPath: string | null;
    projectId: string | null;
    sessionId: string | null;
    visibleTurnIds: string[];
    activeBranchId?: string | null;
    signal?: AbortSignal;
    excludeRdxLeaseTools?: boolean;
    frozenDelegationCapsule?: import('@shared/types/delegationCapsule').DelegationCapsule;
  }): Promise<PreparedAgentTurnContext> {
    const throwIfCancelled = () => {
      if (input.signal?.aborted) throw new Error('REQUEST_CANCELLED: request preparation was cancelled.');
    };
    throwIfCancelled();
    const contextRoute = {
      providerId: input.providerId,
      modelId: input.requestPlan.effectiveModelId,
      protocol: input.requestPlan.route.protocol,
    };
    let materialized = input.sessionId
      ? sessionContextJournal.materialize(
          input.sessionId,
          input.visibleTurnIds,
          input.requestPlan,
          input.activeBranchId ?? undefined,
        )
      : {
          messages: [],
          selectedTurnCount: 0,
          replayedArtifactCount: 0,
          filteredArtifactCount: 0,
          artifactDecisions: [],
          derivedContextStatus: 'none' as const,
          compactedTurnCount: 0,
        };
    throwIfCancelled();
    // Compile the immutable policy before acquiring any external MCP lease.
    // Invalid policy must not spawn processes or establish network connections.
    const turnSettings = settingsService.getAll();
    const compiledPolicy = compileEffectivePolicy(input.projectRootPath);
    const contextCompactionPercent = resolveEffectiveCompactionPercent(
      turnSettings.agentRuntime.context.compactionThresholdPercent ?? DEFAULT_CONTEXT_COMPACTION_PERCENT,
      compiledPolicy.contextCompactionPercent,
    );
    const acquiredMcp = await this.deps.mcp.acquireConnections(
      input.agentId,
      input.projectRootPath,
      input.effectiveProfile.mcpServers,
      input.projectId,
      input.signal,
    );
    const mcpConnectionErrors = acquiredMcp.errors;
    const mcpLease = acquiredMcp.lease;
    try {
      throwIfCancelled();
    const excludeRdxLeaseTools = input.excludeRdxLeaseTools === true;
    const runtimeTools = this.deps.resolveRuntimeTools(
      input.agentId,
      input.toolAllowlist,
      input.sessionId,
      undefined,
      input.projectId,
      input.projectRootPath,
      mcpLease?.poolKey ?? null,
      { excludeRdxLeaseTools },
    );
    const slotKey = agentSlotKey(resolveExecutionScopeId(input.sessionId), input.agentId);
    const toolSignature = this.deps.createToolSignature(runtimeTools.definitions);
    const activatedDeferredTools = this.deps.deferredActivation.resolveActivatedSet(slotKey, toolSignature);
    preactivateTaskTools(runtimeTools.definitions, activatedDeferredTools);
    const { injected, deferredMcp, deferredBuiltin } = partitionDeferredTools(
      runtimeTools.definitions,
      activatedDeferredTools,
    );
    const activeToolDefinitions = input.routeCapability.toolCallingMode === 'native-structured'
      ? injected
      : [];
    const toolTokens = charsToTokens(JSON.stringify(activeToolDefinitions).length);
    const fixedTokens = input.promptPlan.totalTokenEstimate + toolTokens;
    const compactionThreshold = resolveCompactionThresholdTokens(
      input.requestPlan.contextBudgetTokens,
      contextCompactionPercent,
    );
    if (input.sessionId && materialized.derivedContextStatus !== 'applied') {
      const occupiedTokens = storageAdapter.readSessionUsage(input.sessionId)?.occupiedTokens ?? 0;
      if (!isWithinSessionCompactionLine(
        occupiedTokens,
        compactionThreshold,
        input.visibleTurnIds.length,
      )) {
        await persistGeneratedSessionCompaction({
          sessionId: input.sessionId,
          history: storageAdapter.readConversationHistory(input.sessionId),
          visibleTurnIds: input.visibleTurnIds,
          branchId: input.activeBranchId ?? ROOT_BRANCH_ID,
          occupiedTokens,
          compactionThresholdTokens: compactionThreshold,
        });
        materialized = sessionContextJournal.materialize(
          input.sessionId,
          input.visibleTurnIds,
          input.requestPlan,
          input.activeBranchId ?? undefined,
        );
      }
    }
    const messageBudget = compactionThreshold - fixedTokens - input.imageTokenAdjustment;
    if (messageBudget <= 0) {
      throw new Error(
        'PROMPT_OVERHEAD_EXCEEDS_BUDGET: System prompt, skills, and tool schemas exceed the selected model prompt budget.',
      );
    }

    const userTimestamp = nowMs();
    const userMessage: UserMessage = { role: 'user', content: input.content, timestamp: userTimestamp };
    const messages = [...materialized.messages, userMessage];
    const computation = await turnPreparationWorkerPool.run({
      messages,
      modelId: input.requestPlan.effectiveModelId,
      messageBudget,
      imageTokenAdjustment: input.imageTokenAdjustment,
    }, input.signal);
    throwIfCancelled();
    const compactedMessages = computation.compactedMessages;
    const beforeConversationTokens = computation.beforeConversationTokens;
    const afterConversationTokens = computation.afterConversationTokens;
    const uncompactedInputTokens = fixedTokens + beforeConversationTokens;
    const preparedInputTokens = fixedTokens + afterConversationTokens;
    const compactionApplied = computation.compactionApplied;
    const effectiveContextView = materialized.derivedContextView;
    const promptCache = promptCacheCompiler.compile({
      promptPlan: input.promptPlan,
      requestPlan: input.requestPlan,
      tools: activeToolDefinitions,
      ...(effectiveContextView ? { derivedContextView: effectiveContextView } : {}),
    });
    if (preparedInputTokens > compactionThreshold) {
      throw new Error(
        'CONTEXT_CANNOT_FIT: The request cannot fit after compaction. Remove attachments or select a larger context mode.',
      );
    }

    const isMcp = (definition: ToolDefinition) => isMcpPrefixedToolName(definition.name);
    const isSubagent = (definition: ToolDefinition) => definition.name === 'subagent';
    const mcpDefinitions = activeToolDefinitions.filter(isMcp);
    const subagentDefinitions = activeToolDefinitions.filter(isSubagent);
    const systemDefinitions = activeToolDefinitions.filter((definition) => !isMcp(definition) && !isSubagent(definition));
    const classified = computation.classification;
    const metrics = input.promptPlan.metrics;
    const breakdown: ContextUsageBreakdownEntry[] = [
      { id: 'system_prompt', tokens: charsToTokens(metrics.systemPrompt) },
      ...(metrics.scopedInstructions > 0
        ? [{ id: 'memory_files' as const, tokens: charsToTokens(metrics.scopedInstructions) }]
        : []),
      ...(metrics.skills > 0
        ? [{ id: 'skills' as const, tokens: charsToTokens(metrics.skills) }]
        : []),
      { id: 'system_tools', tokens: charsToTokens(JSON.stringify(systemDefinitions).length), count: systemDefinitions.length },
      ...(mcpDefinitions.length > 0
        ? [{ id: 'mcp_tools' as const, tokens: charsToTokens(JSON.stringify(mcpDefinitions).length), count: mcpDefinitions.length }]
        : []),
      ...(deferredMcp.length > 0
        ? [{ id: 'mcp_tools_deferred' as const, tokens: charsToTokens(JSON.stringify(deferredMcp).length), count: deferredMcp.length }]
        : []),
      ...(deferredBuiltin.length > 0
        ? [{ id: 'builtin_tools_deferred' as const, tokens: charsToTokens(JSON.stringify(deferredBuiltin).length), count: deferredBuiltin.length }]
        : []),
      ...(subagentDefinitions.length > 0
        ? [{ id: 'subagent_definitions' as const, tokens: charsToTokens(JSON.stringify(subagentDefinitions).length), count: subagentDefinitions.length }]
        : []),
      ...(classified.summaryTokens > 0
        ? [{ id: 'summarized_conversation' as const, tokens: classified.summaryTokens }]
        : []),
      { id: 'conversation', tokens: classified.conversationTokens + input.imageTokenAdjustment, count: classified.conversationCount },
      { id: 'free', tokens: Math.max(0, input.requestPlan.contextBudgetTokens - preparedInputTokens) },
    ];
    requestEnvelopeBuilder.build({
      promptPlan: input.promptPlan,
      sessionId: input.sessionId ?? undefined,
      turnId: input.turnId,
      callIndex: 0,
      route: contextRoute,
      requestPlan: input.requestPlan,
      messages: compactedMessages,
      tools: activeToolDefinitions,
      controls: { ...input.turnControls },
      reasoning: input.routeCapability.reasoningContract,
      cache: promptCache,
    });
    const lastPreparedMessage = compactedMessages.at(-1);
    if (
      lastPreparedMessage?.role !== 'user'
      || JSON.stringify(lastPreparedMessage.content) !== JSON.stringify(input.content)
    ) {
      throw new Error('CONTEXT_CANNOT_FIT: preparation did not preserve the current user message.');
    }
    const initialMessages = compactedMessages.slice(0, -1);
    // prepareTurn 唯一一次解析 settings → 写入 effectivePlan；runAgentTurn/Executor 不得再读。
    const profile = input.effectiveProfile;
    const profileSkills = profile.skills;
    const skillIntersection = resolveSkillIntersection(
      profileSkills,
      input.toolAllowlist,
      input.projectRootPath,
      input.agentId,
    );
    const effectivePlan = buildEffectiveRuntimePlan({
      agentId: input.agentId,
      projectRootPath: input.projectRootPath,
      projectId: input.projectId,
      profile,
      profileProvenance: profile.provenance,
      enabledProfileIds: input.effectiveProfileIds,
      toolAllowlist: input.toolAllowlist,
      permissionSettings: turnSettings.agentRuntime.permissions,
      routeCapability: input.routeCapability,
      requestPlan: input.requestPlan,
      promptPlan: input.promptPlan,
      policy: compiledPolicy,
      skillIntersection,
      attachmentManifestFingerprint: input.attachmentManifest
        ? JSON.stringify(input.attachmentManifest)
        : null,
      visibleToolNames: activeToolDefinitions.map((definition) => definition.name),
      activatedDeferredTools,
      mcpDescriptorHash: aggregateMcpDescriptorHash(profile, input.projectRootPath),
      compactionThresholdPercent: turnSettings.agentRuntime.context.compactionThresholdPercent
        ?? DEFAULT_CONTEXT_COMPACTION_PERCENT,
      excludeRdxLeaseTools,
      delegationCapsule: input.frozenDelegationCapsule ?? null,
    });
    const summary: PreparedTurnContextSummary = {
      requestId: input.requestId,
      turnId: input.turnId,
      route: {
        providerId: input.providerId,
        adapterId: input.requestPlan.adapterId,
        selectedModelId: input.selectedModelId,
        effectiveModelId: input.requestPlan.effectiveModelId,
        protocol: input.requestPlan.route.protocol,
        catalogRevision: input.requestPlan.catalogRevision,
        routeRevision: input.requestPlan.routeRevision,
        bindingIds: [...input.requestPlan.appliedBindingIds],
      },
      wirePatch: {
        headers: requestPlanHeaders(input.requestPlan),
        body: structuredClone(input.requestPlan.bodyPatch),
      },
      controls: { ...input.turnControls },
      contextMode: input.requestPlan.contextMode,
      preparedInputTokens,
      uncompactedInputTokens,
      promptBudgetTokens: input.requestPlan.contextBudgetTokens,
      contextWindowTokens: input.requestPlan.contextWindowTokens,
      maxOutputTokens: input.requestPlan.maxOutputTokens,
      compactionThresholdTokens: compactionThreshold,
      usagePercent: Math.min(100, Math.round((preparedInputTokens / input.requestPlan.contextBudgetTokens) * 100)),
      breakdown,
      compactionApplied,
      filteredArtifactCount: materialized.filteredArtifactCount,
      derivedContext: {
        status: materialized.derivedContextStatus,
        compactedTurnCount: materialized.compactedTurnCount,
      },
      continuation: {
        executionFingerprint: input.requestPlan.executionIdentity.fingerprint,
        strategy: input.requestPlan.contextTransitionPlan.strategy,
        replayedArtifactCount: materialized.replayedArtifactCount,
        droppedArtifactCount: materialized.filteredArtifactCount,
        decisionCounts: countContinuationDecisions(materialized.artifactDecisions),
      },
      cache: {
        enabled: promptCache.enabled,
        mode: promptCache.mode,
        keyCarrier: promptCache.keyCarrier,
        breakpointCarrier: promptCache.breakpointCarrier,
        ttl: promptCache.ttl,
        breakpoint: promptCache.breakpoint,
        ...(promptCache.prefixFingerprint ? { keyFingerprint: promptCache.prefixFingerprint } : {}),
        stableTokenEstimate: promptCache.stableTokenEstimate,
        stableSegmentCount: promptCache.stableSegmentIds.length,
        providerReported: promptCache.providerReported,
        reason: promptCache.reason,
      },
      preparedAt: nowMs(),
    };
    return {
      summary,
      selectedModelId: input.selectedModelId,
      effectiveModel: input.effectiveModel,
      toolAllowlist: [...effectivePlan.toolAllowlist],
      frozenUserContent: input.frozenUserContent ?? input.content,
      attachmentManifest: input.attachmentManifest ?? [],
      inlineTokenBudget: input.inlineTokenBudget ?? 0,
      initialMessages,
      contextDiagnostic: {
        selectedTurnCount: materialized.selectedTurnCount,
        activeBranchId: input.activeBranchId ?? null,
        filteredArtifactCount: materialized.filteredArtifactCount,
        replayedArtifactCount: materialized.replayedArtifactCount,
        continuationDecisionCounts: countContinuationDecisions(materialized.artifactDecisions),
        derivedContextStatus: materialized.derivedContextStatus,
        compactedTurnCount: materialized.compactedTurnCount,
        compactionState: compactionApplied ? 'prepared' : 'not-required',
      },
      runtime: {
        runtimeTools,
        activeToolDefinitions,
        routeCapability: input.routeCapability,
        mcpConnectionErrors,
        mcpLease,
        credentialHandle: input.credentialHandle,
        promptCache,
        effectivePlan,
      },
    };
    } catch (error) {
      await mcpLease?.release({ discardIfIdle: true });
      throw error;
    }
  }
}
