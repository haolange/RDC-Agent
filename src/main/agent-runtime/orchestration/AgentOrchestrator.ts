/**
 * AgentOrchestrator — façade over turn preparation, the turn runner, subagents and MCP.
 *
 * Public contract: `prepareTurnContext` / `sendProfileMessage` / `abortAndJoin`. LLM streaming and tool gating stay
 * in AgentTurnRunner; permissions stay in AgentPermissionPolicy. The composition root (`agentRuntimeRoot.ts`)
 * constructs every collaborator and passes them in; this file depends on their types only.
 */

import { AppError } from '@shared/errors/appError';
import { isTopLevelAgentId } from '@shared/types/agent';
import { agentAccessCeiling } from '@shared/types/agentManifest';
import { AGENT_DISPLAY_NAMES } from '@shared/constants/agents';
import { isSubagentScopeId, isTransientScopeId } from '@shared/utils/executionScope';
import { applyDelegationCapsuleToPromptPlan } from '../prompt/DelegationCapsuleCompiler';
import { runtimeLogService } from '../../runtime/RuntimeLogService';
import { appPathService } from '../../runtime/AppPathService';
import { sessionRecordStore } from '../../sessions/store/sessionStores';
import { settingsService } from '../../settings/settings-core/SettingsService';
import { agentManifestService } from '../../settings/agent-manifests/AgentManifestService';
import { compiledRoutesFromDefinitions } from '../../settings/provider-catalog/compiledAgentRoutes';
import { providerRuntimeCredentialService } from '../../settings/provider-auth/ProviderRuntimeCredentialService';
import { freezeProviderRuntimeCredentials } from '../../settings/provider-auth/ProviderRuntimeCredentialLease';
import { planEffectiveModelRequest, resolveEffectiveModel } from '../../settings/provider-catalog/EffectiveModelResolver';
import { resolveCompactionPercentForProject } from '../context/compactionPercent';
import { delegableProfileIds } from './delegableProfiles';
import { DelegationConfigurationError } from './DelegationConfigurationError';
import { resolveProfileToolAllowlist } from './ProfileTurnPreparation';
import { resolveAgentToolAllowlistFromDefinition } from './RuntimeToolPolicy';
import { createEphemeralScopeId, resolveExecutionScopeId } from './executionScope';
import { turnCoordinator, type AbortReason } from './TurnCoordinator';
import { workflowProjectionPublisher } from './WorkflowProjectionPublisher';
import type { AgentConfig, AgentRole, AgentState } from '@shared/types/agent';
import type { MCPServerStatusSummary } from '@shared/types/mcp';
import type { LlmProviderId } from '@shared/types/settings';
import type { AgentSlotRegistry } from './AgentSlotRegistry';
import type { AgentTurnRunner } from './AgentTurnRunner';
import type { BackgroundSubagentService } from './BackgroundSubagentService';
import type { DeferredToolActivationTracker } from './DeferredToolActivationTracker';
import type { McpConnectionCoordinator } from './McpConnectionCoordinator';
import type { ProfileTurnPreparation } from './ProfileTurnPreparation';
import type { PromptPlanForTurn } from './PromptPlanForTurn';
import type { ToolExecutorFactory } from './ToolExecutorFactory';
import type { TurnPreparationService } from './TurnPreparationService';
import type { AgentProfileTurnOptions, PreparedAgentTurnContext } from './orchestratorTypes';

/** The collaborators the composition root constructs for the façade. */
export interface AgentOrchestratorCollaborators {
  slots: AgentSlotRegistry;
  mcp: McpConnectionCoordinator;
  deferredActivation: DeferredToolActivationTracker;
  promptPlan: PromptPlanForTurn;
  toolExecutors: ToolExecutorFactory;
  turnPrep: TurnPreparationService;
  profilePrep: ProfileTurnPreparation;
  turnRunner: AgentTurnRunner;
  backgroundSubagents: BackgroundSubagentService;
}

export class AgentOrchestrator {
  private readonly slots: AgentSlotRegistry;
  private readonly mcp: McpConnectionCoordinator;
  private readonly deferredActivation: DeferredToolActivationTracker;
  private readonly promptPlan: PromptPlanForTurn;
  private readonly toolExecutors: ToolExecutorFactory;
  private readonly turnPrep: TurnPreparationService;
  private readonly profilePrep: ProfileTurnPreparation;
  private readonly turnRunner: AgentTurnRunner;
  readonly backgroundSubagents: BackgroundSubagentService;

  constructor(collaborators: AgentOrchestratorCollaborators) {
    this.slots = collaborators.slots;
    this.mcp = collaborators.mcp;
    this.deferredActivation = collaborators.deferredActivation;
    this.promptPlan = collaborators.promptPlan;
    this.toolExecutors = collaborators.toolExecutors;
    this.turnPrep = collaborators.turnPrep;
    this.profilePrep = collaborators.profilePrep;
    this.turnRunner = collaborators.turnRunner;
    this.backgroundSubagents = collaborators.backgroundSubagents;
  }

  /** Re-reads the Agent model routes Settings assigns (after a settings or credential change). */
  applyLlmConfig(): void {
    this.slots.applyLlmConfig(compiledRoutesFromDefinitions([...settingsService.agentDefinitions()]));
  }

  syncSessionSlots(sessionId: string): void {
    this.slots.syncSession(sessionId);
    this.deferredActivation.clearSession(sessionId);
  }

  private releaseTransientAgentState(scopeId: string): void {
    if (!isTransientScopeId(scopeId)) return;
    this.toolExecutors.releaseSession(scopeId);
    this.slots.purgeAgentStatesForScope(scopeId);
  }

  releaseSessionToolState = (sessionId: string): void => this.toolExecutors.releaseSession(sessionId);
  private getOrCreateAgentConfig(agentId: AgentRole): AgentConfig {
    return this.slots.getOrCreateAgentConfig(agentId);
  }

  async refreshProviderRuntimeCredentials(providerId: LlmProviderId): Promise<string> {
    const lease = await freezeProviderRuntimeCredentials(providerId);
    if (lease.accountCredentialsRefreshed) {
      this.applyLlmConfig();
    }
    return lease.handle;
  }

  releaseProviderRuntimeCredentials(credentialHandle: string | undefined): void {
    providerRuntimeCredentialService.release(credentialHandle);
  }

  async prepareTurnContext(input: Parameters<TurnPreparationService['prepareTurnContext']>[0]): Promise<PreparedAgentTurnContext> {
    return this.turnPrep.prepareTurnContext(input);
  }

  async sendProfileMessage(
    agentId: AgentRole,
    content: string,
    options?: AgentProfileTurnOptions,
  ): Promise<string> {
    const executionScopeId = resolveExecutionScopeId(options?.sessionId, createEphemeralScopeId());
    const fallbackConfig = this.getOrCreateAgentConfig(agentId);
    let ownedCredentialHandle: string | undefined;
    let preparedLeaseRelease: (() => Promise<void>) | undefined;
    let ownsPreparedRuntime = false;

    this.updateAgentStatus(executionScopeId, agentId, 'thinking');

    try {
      let preparedTurn = options?.preparedTurn;
      const routeAgentId = options?.routeAgentId ?? agentId;
      const modelOverride = options?.modelOverride ?? null;
      const frozenRequestPlan = options?.requestPlan;
      const effectiveProfiles = options?.effectiveProfile
        ? [options.effectiveProfile]
        : agentManifestService.getEffectiveProfiles(
            appPathService.getRuntimePaths(),
            options?.projectRootPath ?? undefined,
          );
      const effectiveProfile = options?.effectiveProfile
        ?? effectiveProfiles.find((definition) => definition.id === agentId && definition.enabled)
        ?? null;
      const compiledRoute = (
        routeAgentId === agentId
          ? effectiveProfile?.compiledRoute
          : effectiveProfiles.find((definition) => definition.id === routeAgentId && definition.enabled)?.compiledRoute
      );
      let route = compiledRoute?.providerId && compiledRoute.modelId ? compiledRoute : undefined;
      const credentialProviderId = frozenRequestPlan?.providerId
        ?? preparedTurn?.summary.route.providerId
        ?? modelOverride?.providerId
        ?? route?.providerId;
      if (credentialProviderId && !preparedTurn) {
        ownedCredentialHandle = await this.refreshProviderRuntimeCredentials(credentialProviderId);
        const refreshed = this.resolveEffectiveAgentProfileSnapshot(agentId, options?.projectRootPath);
        route = refreshed.profile?.compiledRoute?.providerId
          ? refreshed.profile.compiledRoute
          : route;
      }
      const effectiveProfileIds = options?.effectiveProfileIds?.length
        ? options.effectiveProfileIds
        : effectiveProfiles.filter((definition) => definition.enabled).map((definition) => definition.id);
      const delegableIds = options?.delegableProfileIds ?? delegableProfileIds(effectiveProfiles);
      const config: AgentConfig = {
        ...fallbackConfig,
        modelProvider: frozenRequestPlan?.providerId
          ?? (modelOverride ? modelOverride.providerId : route?.providerId)
          ?? fallbackConfig.modelProvider,
        modelName: frozenRequestPlan?.effectiveModelId
          ?? (modelOverride ? modelOverride.modelId : route?.modelId)
          ?? fallbackConfig.modelName,
        systemPrompt: options?.systemPrompt || effectiveProfile?.instructions || fallbackConfig.systemPrompt,
        temperature: options?.temperature ?? fallbackConfig.temperature,
      };

      if (!effectiveProfile) {
        throw new AppError('AGENT_PROFILE_UNAVAILABLE', agentId);
      }

      const resolvedAllowlist = preparedTurn?.toolAllowlist
        ?? resolveAgentToolAllowlistFromDefinition(agentId, effectiveProfile.tools, agentAccessCeiling(effectiveProfile));
      const toolAllowlist = resolveProfileToolAllowlist(resolvedAllowlist, options, preparedTurn);
      const routeProviderId = config.modelProvider;
      const routeModelId = config.modelName;
      const sessionControls = options?.sessionId
        ? sessionRecordStore.readSession(options.sessionId)?.turnControls
        : undefined;
      const planning = frozenRequestPlan
        ? {
            ok: true as const,
            plan: frozenRequestPlan,
            controls: options?.turnControls ?? {
              reasoningLevel: frozenRequestPlan.reasoningWire.selection === 'unknown'
                ? 'off' as const
                : frozenRequestPlan.reasoningWire.selection,
              maxContextMode: frozenRequestPlan.contextMode === 'one-million',
              fastModel: frozenRequestPlan.fastMode,
            },
            warnings: [] as string[],
          }
        : planEffectiveModelRequest({
            providerId: routeProviderId,
            modelId: routeModelId,
            providers: settingsService.providerConnections,
            controls: {
              ...(effectiveProfile.reasoningLevel ? { reasoningLevel: effectiveProfile.reasoningLevel } : {}),
              ...(sessionControls ?? {}),
              ...(options?.turnControls ?? {}),
              ...(options?.reasoning
                ? { reasoningLevel: options.reasoning.selection === 'unknown' ? 'off' : options.reasoning.selection }
                : {}),
            },
            requestedTemperature: config.temperature,
            compactionThresholdPercent: resolveCompactionPercentForProject(options?.projectRootPath ?? null),
          });
      if (!planning.ok) {
        const message = `${planning.code}: ${planning.message}`;
        if (options?.frozenDelegationCapsule) throw new DelegationConfigurationError(planning.code, message);
        throw new Error(message);
      }
      if (options?.frozenDelegationCapsule && effectiveProfile.reasoningLevel && planning.plan.reasoningWire.selection !== effectiveProfile.reasoningLevel) {
        throw new DelegationConfigurationError('DELEGATION_REASONING_UNSUPPORTED', 'DELEGATION_REASONING_UNSUPPORTED: selected route cannot honor the Agent reasoning level.');
      }
      const capability = preparedTurn?.effectiveModel
        ?? resolveEffectiveModel(routeProviderId, routeModelId, settingsService.providerConnections);
      if (!capability) {
        const message = `MODEL_UNAVAILABLE: ${routeProviderId}/${routeModelId}`;
        if (options?.frozenDelegationCapsule) throw new DelegationConfigurationError('MODEL_UNAVAILABLE', message);
        throw new Error(message);
      }
      const activeContextWindow = planning.plan.contextWindowTokens;
      let promptPlan = options?.promptPlan ?? this.promptPlan.buildPromptPlanForAgentTurn({
        agentId,
        sessionId: options?.sessionId ?? null,
        projectRootPath: options?.projectRootPath ?? null,
        providerId: routeProviderId,
        modelId: routeModelId,
        toolAllowlist,
        contextWindowTokens: activeContextWindow,
        capability, requestPlan: planning.plan,
        systemPrompt: config.systemPrompt,
        messageText: typeof content === 'string' ? content : '',
        preloadSkillIds: options?.preloadSkillIds,
        effectiveProfile,
        extraSegments: options?.extraPromptSegments,
        effectiveProfiles,
      });
      if (!promptPlan) throw new AppError('PROMPT_PLAN_UNAVAILABLE', agentId);
      if (options?.promptPlan && options.extraPromptSegments?.length) {
        promptPlan = applyDelegationCapsuleToPromptPlan(promptPlan, options.extraPromptSegments);
      }

      const isSubagentSession = Boolean(options?.sessionId && isSubagentScopeId(options.sessionId));
      if (!preparedTurn) {
        const preparedBundle = await this.profilePrep.prepare({
          agentId,
          content,
          systemPrompt: promptPlan.systemPrompt,
          providerId: routeProviderId,
          modelId: routeModelId,
          toolAllowlist,
          promptPlan,
          effectiveProfile,
          effectiveProfileIds: [...effectiveProfileIds],
          delegableProfileIds: [...delegableIds],
          projectRootPath: options?.projectRootPath ?? null,
          projectId: options?.projectId ?? null,
          sessionId: isSubagentSession ? null : (options?.sessionId ?? null),
          turnId: options?.turnId,
          credentialHandle: (() => {
            if (!ownedCredentialHandle) {
              throw new AppError('CREDENTIAL_HANDLE_REQUIRED', 'profile turn preparation requires a credential lease.');
            }
            return ownedCredentialHandle;
          })(),
          requestPlan: planning.plan,
          turnControls: planning.controls,
          temperature: config.temperature,
          visibleTurnIds: options?.visibleTurnIds,
          activeBranchId: options?.activeBranchId,
          signal: options?.signal,
          isolateContext: isSubagentSession || !options?.sessionId,
          excludeRdcLeaseTools: options?.excludeRdcLeaseTools,
          frozenDelegationCapsule: options?.frozenDelegationCapsule,
          subagentDepth: options?.subagentBudget?.depth ?? options?.policyBudget?.childDepth ?? 0,
          inheritedMaxChildDepth: options?.policyBudget?.maxChildDepth, excludeSubagent:
            resolveProfileToolAllowlist(['subagent'], options, preparedTurn).length === 0,
        });
        preparedTurn = preparedBundle.prepared;
        ownsPreparedRuntime = true;
        preparedLeaseRelease = async () => {
          await preparedTurn?.runtime.mcpLease?.release({ discardIfIdle: true });
        };
      }

      const responseText = await this.turnRunner.runAgentTurn({
        agentId,
        content,
        providerId: routeProviderId,
        modelId: routeModelId,
        temperature: planning.plan.temperature,
        profileId: agentId,
        runId: options?.runId,
        sessionId: executionScopeId,
        turnId: options?.turnId ?? preparedTurn.summary.turnId,
        toolAllowlist: preparedTurn.toolAllowlist,
        options: {
          ...options,
          reasoning: planning.plan.reasoningWire,
          turnControls: planning.controls,
          requestPlan: planning.plan,
        },
        projectRootPath: options?.projectRootPath ?? null,
        projectId: options?.projectId ?? null,
        effectiveModel: preparedTurn.effectiveModel,
        effectiveProfile,
        effectiveProfileIds,
        credentialHandle: ownedCredentialHandle ?? preparedTurn.runtime.credentialHandle,
        contextWindow: activeContextWindow,
        contextTokenLimit: preparedTurn.summary.compactionThresholdTokens,
        initialMessages: preparedTurn.initialMessages,
        contextDiagnostic: preparedTurn.contextDiagnostic,
        preparedRuntime: preparedTurn.runtime,
        terminalContext: options?.onTerminalContext
          ? (messages, status, pendingHandoff, completionDeclaration, approvedPlan, completionReceipt) => options.onTerminalContext?.({
              messages,
              executionIdentity: planning.plan.executionIdentity,
              status,
              selectedTurnCount: preparedTurn!.contextDiagnostic.selectedTurnCount,
              filteredArtifactCount: preparedTurn!.contextDiagnostic.filteredArtifactCount,
              pendingHandoff,
              completionDeclaration,
              completionReceipt,
              approvedPlan,
            })
          : undefined,
      });
      if (ownsPreparedRuntime) {
        preparedLeaseRelease = undefined;
      }

      runtimeLogService.log({
        scope: options?.sessionId ? 'session' : 'app',
        namespace: 'agent',
        severity: 'info',
        title: `${this.getAgentDisplayName(agentId)} profile turn`,
        summary: responseText.slice(0, 160) || 'Empty message.',
        sessionId: options?.sessionId,
        raw: {
          agentId,
          providerId: config.modelProvider,
          modelId: config.modelName,
        },
      });

      this.updateAgentStatus(executionScopeId, agentId, 'complete');
      return responseText;
    } catch (error) {
      this.updateAgentStatus(executionScopeId, agentId, 'error');
      throw error;
    } finally {
      this.releaseTransientAgentState(executionScopeId);
      if (preparedLeaseRelease) {
        await preparedLeaseRelease().catch(() => undefined);
      }
      providerRuntimeCredentialService.release(ownedCredentialHandle);
    }
  }

  async abortAndJoin(sessionId: string | null | undefined, options?: { graceMs?: number; forceAfterMs?: number; reason?: AbortReason }): Promise<void> {
    const key = sessionId?.trim();
    if (!key) return;
    // use resolved key without generating a new ephemeral scope
    const handle = turnCoordinator.getActive(key);
    if (!handle) {
      await turnCoordinator.abortSession(key, options?.reason ?? 'user_stop');
      return;
    }
    await handle.abortAndJoin({
      graceMs: options?.graceMs,
      forceAfterMs: options?.forceAfterMs,
      reason: options?.reason ?? 'user_stop',
    });
    turnCoordinator.endTurn(handle);
  }

  getMcpServerStatusSummary(projectRootPath?: string | null, query?: string): MCPServerStatusSummary[] {
    return this.mcp.getMcpServerStatusSummary(projectRootPath, query);
  }

  async disconnectAllMcpServers(): Promise<void> {
    await this.mcp.disconnectAll();
  }

  private resolveEffectiveAgentProfileSnapshot(agentId: AgentRole, projectRootPath?: string | null) {
    const profiles = agentManifestService.getEffectiveProfiles(appPathService.getRuntimePaths(), projectRootPath ?? undefined);
    return {
      profile: profiles.find((definition) => definition.id === agentId && definition.enabled) ?? null,
      profiles,
      enabledProfileIds: profiles.filter((definition) => definition.enabled).map((definition) => definition.id),
    };
  }

  private getAgentDisplayName(agentId: AgentRole): string {
    const definition = settingsService.agentDefinitions().find((entry) => entry.id === agentId);
    return definition?.name || (isTopLevelAgentId(agentId) ? AGENT_DISPLAY_NAMES[agentId] : agentId);
  }

  private updateAgentStatus(sessionOrScopeId: string, agentId: AgentRole, status: AgentState['status']): void {
    const state = this.slots.updateAgentStatus(sessionOrScopeId, agentId, status);
    runtimeLogService.log({
      scope: 'app',
      namespace: 'agent',
      severity: status === 'error' ? 'error' : status === 'complete' ? 'success' : 'info',
      title: this.getAgentDisplayName(agentId),
      summary: `Status changed to ${status}.`,
      sessionId: sessionOrScopeId,
      raw: {
        agentId,
        sessionId: sessionOrScopeId,
        status,
      },
    });
    workflowProjectionPublisher.publishAgentStatus(state);
  }

}

