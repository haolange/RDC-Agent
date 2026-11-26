/**
 * ProfileTurnRunner — runs one profile turn in named phases: begin (scope, status), resolve the profile and route,
 * plan the request and prompt, prepare a child turn's runtime (subagents only), run the prepared turn, and end
 * (transient state, the prepared MCP lease and the owned credential lease).
 *
 * A conversation turn arrives prepared (`sendPrepared`): ConversationTurnStarter froze and committed its runtime. A
 * child turn (`runChildTurn`) prepares its runtime here, under a credential lease the turn owns.
 */

import { AppError } from '@shared/errors/appError';
import { isTopLevelAgentId } from '@shared/types/agent';
import { agentAccessCeiling } from '@shared/types/agentManifest';
import { AGENT_DISPLAY_NAMES } from '@shared/constants/agents';
import { generateEventId } from '@shared/utils/id';
import { isSubagentScopeId, isTransientScopeId } from '@shared/utils/executionScope';
import { stripRdcLeaseToolsFromAllowlist } from '@shared/constants/rdcLeaseTools';
import { runtimeLogService } from '../../runtime/RuntimeLogService';
import { reportProcessFault } from '../../runtime/processFaultHandlers';
import { appPathService } from '../../runtime/AppPathService';
import { sessionRecordStore } from '../../sessions/store/sessionStores';
import { settingsService } from '../../settings/settings-core/SettingsService';
import { agentManifestService } from '../../settings/agent-manifests/AgentManifestService';
import {
  planEffectiveModelRequest,
  resolveEffectiveModel,
} from '../../settings/provider-catalog/EffectiveModelResolver';
import { resolveAgentRouteCapability } from '../capabilities/RouteCapabilityResolver';
import { imageTokenAdjustmentForContent } from '../attachments/ConversationAttachmentMaterializer';
import { applyDelegationCapsuleToPromptPlan } from '../prompt/DelegationCapsuleCompiler';
import { compileEffectivePolicy } from '../permissions/PolicyCompiler';
import { resolveCompactionPercentForProject } from '../context/compactionPercent';
import { delegableProfileIds } from './delegableProfiles';
import { newDelegationBudgetExhausted } from './DelegationAdmission';
import { DelegationConfigurationError } from './DelegationConfigurationError';
import { resolveAgentToolAllowlistFromDefinition } from './RuntimeToolPolicy';
import { createEphemeralScopeId, resolveExecutionScopeId } from './executionScope';
import type { AgentRole } from '@shared/types/agent';
import type { AgentConfig, AgentState } from './AgentSlotRegistry';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type { EffectiveModel, RequestPlan } from '@shared/types/providerCapability';
import type { PromptPlan } from '@shared/types/rdcRuntime';
import type { EffectiveAgentProfile } from '../../settings/agent-manifests/agentRuntimeTypes';
import type { AgentSlotRegistry } from './AgentSlotRegistry';
import type { AgentTurnRunner } from './AgentTurnRunner';
import type { PromptPlanForTurn } from './PromptPlanForTurn';
import type { ProviderRouteCredentials } from './ProviderRouteCredentials';
import type { ToolExecutorFactory } from './ToolExecutorFactory';
import type { TurnPreparationService } from './TurnPreparationService';
import type { AgentProfileTurnOptions, PreparedAgentTurnContext } from './orchestratorTypes';

/** One profile turn: the Agent, its input and the turn options (session, run, controls, callbacks). */
export interface ProfileTurnRequest extends AgentProfileTurnOptions {
  agentId: AgentRole;
  content: string;
}

/** A conversation turn whose runtime `prepareTurnContext` froze and the conversation committed. */
export interface PreparedProfileTurn extends ProfileTurnRequest {
  preparedTurn: PreparedAgentTurnContext;
}

export interface ProfileTurnRunnerDeps {
  slots: AgentSlotRegistry;
  credentials: ProviderRouteCredentials;
  promptPlan: PromptPlanForTurn;
  turnPrep: TurnPreparationService;
  turnRunner: AgentTurnRunner;
  toolExecutors: Pick<ToolExecutorFactory, 'releaseSession'>;
}

/** The turn's scope and the leases it owns until `endProfileTurn`. */
interface ProfileTurnScope {
  readonly agentId: AgentRole;
  readonly executionScopeId: string;
  readonly fallbackConfig: AgentConfig;
  ownedCredentialHandle?: string;
  preparedLeaseRelease?: () => Promise<void>;
}

/** The effective profiles the turn resolves its Agent from, and that Agent's enabled profile if any. */
interface ProfileSnapshot {
  effectiveProfiles: readonly EffectiveAgentProfile[];
  effectiveProfile: EffectiveAgentProfile | null;
  effectiveProfileIds: string[];
}

/** The profile snapshot and the route the turn runs on. */
interface ProfileRoute extends ProfileSnapshot {
  effectiveProfile: EffectiveAgentProfile;
  config: AgentConfig;
}

/** The planned request and the prompt plan. */
interface ProfileRequestPlan {
  plan: RequestPlan;
  controls: ConversationTurnControls;
  capability: EffectiveModel;
  promptPlan: PromptPlan;
  toolAllowlist: string[];
}

export function resolveProfileToolAllowlist(
  allowlist: string[],
  options?: AgentProfileTurnOptions,
  prepared?: PreparedAgentTurnContext | null,
): string[] {
  const leaseFiltered = options?.excludeRdcLeaseTools ? stripRdcLeaseToolsFromAllowlist(allowlist) : allowlist;
  const maxDepth = Math.min(
    prepared?.runtime.effectivePlan.policy.maxChildDepth ??
      compileEffectivePolicy(options?.projectRootPath ?? null).maxChildDepth,
    options?.policyBudget?.maxChildDepth ?? Infinity,
  );
  return (options?.subagentBudget?.depth ?? options?.policyBudget?.childDepth ?? 0) >= maxDepth ||
    newDelegationBudgetExhausted(options?.policyBudget, options?.subagentBudget)
    ? leaseFiltered.filter((name) => name.trim().toLowerCase() !== 'subagent')
    : leaseFiltered;
}

export class ProfileTurnRunner {
  constructor(private readonly deps: ProfileTurnRunnerDeps) {}

  /** Runs a conversation turn on the runtime it was prepared with. */
  sendPrepared(turn: PreparedProfileTurn): Promise<string> {
    const { preparedTurn, ...request } = turn;
    return this.runProfileTurn(request, async (scope) => {
      const snapshot = this.resolveProfileSnapshot(request);
      const route = this.completeRoute(request, scope, snapshot, this.configuredRoute(request, snapshot));
      const requestPlan = this.planProfileRequest(request, route, preparedTurn);
      return { route, requestPlan, preparedTurn };
    });
  }

  /** Prepares a child turn's runtime under a credential lease the turn owns, then runs it. */
  runChildTurn(request: ProfileTurnRequest): Promise<string> {
    return this.runProfileTurn(request, async (scope) => {
      const route = await this.resolveChildRoute(request, scope);
      const requestPlan = this.planProfileRequest(request, route, null);
      const preparedTurn = await this.prepareChildRuntime(request, scope, route, requestPlan);
      return { route, requestPlan, preparedTurn };
    });
  }

  private async runProfileTurn(
    request: ProfileTurnRequest,
    prepare: (scope: ProfileTurnScope) => Promise<{
      route: ProfileRoute;
      requestPlan: ProfileRequestPlan;
      preparedTurn: PreparedAgentTurnContext;
    }>,
  ): Promise<string> {
    const scope = this.beginProfileTurn(request);
    try {
      const { route, requestPlan, preparedTurn } = await prepare(scope);
      const responseText = await this.runPreparedTurn(request, scope, route, requestPlan, preparedTurn);
      scope.preparedLeaseRelease = undefined;
      this.logProfileTurn(request, route, responseText);
      this.updateAgentStatus(scope.executionScopeId, request.agentId, 'complete');
      return responseText;
    } catch (error) {
      this.updateAgentStatus(scope.executionScopeId, request.agentId, 'error');
      throw error;
    } finally {
      await this.endProfileTurn(scope);
    }
  }

  private beginProfileTurn(request: ProfileTurnRequest): ProfileTurnScope {
    const executionScopeId = resolveExecutionScopeId(request.sessionId, createEphemeralScopeId());
    const fallbackConfig = this.deps.slots.getOrCreateAgentConfig(request.agentId);
    this.updateAgentStatus(executionScopeId, request.agentId, 'thinking');
    return { agentId: request.agentId, executionScopeId, fallbackConfig };
  }

  /** A child turn freezes fresh credentials for its route first; a refreshed account re-reads the route. */
  private async resolveChildRoute(request: ProfileTurnRequest, scope: ProfileTurnScope): Promise<ProfileRoute> {
    const snapshot = this.resolveProfileSnapshot(request);
    let route = this.configuredRoute(request, snapshot);
    const credentialProviderId =
      request.requestPlan?.providerId ?? request.modelOverride?.providerId ?? route?.providerId;
    if (credentialProviderId) {
      scope.ownedCredentialHandle = await this.deps.credentials.refresh(credentialProviderId);
      const refreshed = this.enabledProfile(request.agentId, this.effectiveProfiles(request.projectRootPath));
      route = refreshed?.compiledRoute.providerId ? refreshed.compiledRoute : route;
    }
    return this.completeRoute(request, scope, snapshot, route);
  }

  private resolveProfileSnapshot(request: ProfileTurnRequest): ProfileSnapshot {
    const effectiveProfiles = request.effectiveProfile
      ? [request.effectiveProfile]
      : this.effectiveProfiles(request.projectRootPath);
    return {
      effectiveProfiles,
      effectiveProfile: request.effectiveProfile ?? this.enabledProfile(request.agentId, effectiveProfiles),
      effectiveProfileIds: request.effectiveProfileIds?.length
        ? request.effectiveProfileIds
        : effectiveProfiles.filter((definition) => definition.enabled).map((definition) => definition.id),
    };
  }

  /** The route the profile (or `routeAgentId`) declares, when it names a provider and a model. */
  private configuredRoute(
    request: ProfileTurnRequest,
    snapshot: ProfileSnapshot,
  ): EffectiveAgentProfile['compiledRoute'] | undefined {
    const routeAgentId = request.routeAgentId ?? request.agentId;
    const compiledRoute =
      routeAgentId === request.agentId
        ? snapshot.effectiveProfile?.compiledRoute
        : this.enabledProfile(routeAgentId, snapshot.effectiveProfiles)?.compiledRoute;
    return compiledRoute?.providerId && compiledRoute.modelId ? compiledRoute : undefined;
  }

  /** The turn's model configuration; the Agent must have an enabled profile. */
  private completeRoute(
    request: ProfileTurnRequest,
    scope: ProfileTurnScope,
    snapshot: ProfileSnapshot,
    route: EffectiveAgentProfile['compiledRoute'] | undefined,
  ): ProfileRoute {
    const config = this.routeConfig(request, scope, snapshot.effectiveProfile, route);
    const { effectiveProfile } = snapshot;
    if (!effectiveProfile) throw new AppError('AGENT_PROFILE_UNAVAILABLE', request.agentId);
    return { ...snapshot, effectiveProfile, config };
  }

  private routeConfig(
    request: ProfileTurnRequest,
    scope: ProfileTurnScope,
    effectiveProfile: EffectiveAgentProfile | null,
    route: EffectiveAgentProfile['compiledRoute'] | undefined,
  ): AgentConfig {
    const { fallbackConfig } = scope;
    const modelOverride = request.modelOverride ?? null;
    return {
      ...fallbackConfig,
      modelProvider:
        request.requestPlan?.providerId ??
        (modelOverride ? modelOverride.providerId : route?.providerId) ??
        fallbackConfig.modelProvider,
      modelName:
        request.requestPlan?.effectiveModelId ??
        (modelOverride ? modelOverride.modelId : route?.modelId) ??
        fallbackConfig.modelName,
      systemPrompt: request.systemPrompt || effectiveProfile?.instructions || fallbackConfig.systemPrompt,
      temperature: request.temperature ?? fallbackConfig.temperature,
    };
  }

  private planProfileRequest(
    request: ProfileTurnRequest,
    route: ProfileRoute,
    preparedTurn: PreparedAgentTurnContext | null,
  ): ProfileRequestPlan {
    const { effectiveProfile, config } = route;
    const providerId = config.modelProvider;
    const modelId = config.modelName;
    const toolAllowlist = resolveProfileToolAllowlist(
      preparedTurn?.toolAllowlist ??
        resolveAgentToolAllowlistFromDefinition(
          request.agentId,
          effectiveProfile.tools,
          agentAccessCeiling(effectiveProfile),
        ),
      request,
      preparedTurn,
    );
    const { plan, controls } = this.planRequest(request, effectiveProfile, config);
    const capability =
      preparedTurn?.effectiveModel ?? resolveEffectiveModel(providerId, modelId, settingsService.providerConnections);
    if (!capability) {
      const message = `MODEL_UNAVAILABLE: ${providerId}/${modelId}`;
      if (request.frozenDelegationCapsule) throw new DelegationConfigurationError('MODEL_UNAVAILABLE', message);
      throw new Error(message);
    }
    let promptPlan =
      request.promptPlan ??
      this.deps.promptPlan.buildPromptPlanForAgentTurn({
        agentId: request.agentId,
        sessionId: request.sessionId ?? null,
        projectRootPath: request.projectRootPath ?? null,
        providerId,
        modelId,
        toolAllowlist,
        contextWindowTokens: plan.contextWindowTokens,
        capability,
        requestPlan: plan,
        systemPrompt: config.systemPrompt,
        messageText: typeof request.content === 'string' ? request.content : '',
        preloadSkillIds: request.preloadSkillIds,
        effectiveProfile,
        extraSegments: request.extraPromptSegments,
        effectiveProfiles: route.effectiveProfiles,
      });
    if (!promptPlan) throw new AppError('PROMPT_PLAN_UNAVAILABLE', request.agentId);
    if (request.promptPlan && request.extraPromptSegments?.length) {
      promptPlan = applyDelegationCapsuleToPromptPlan(promptPlan, request.extraPromptSegments);
    }
    return { plan, controls, capability, promptPlan, toolAllowlist };
  }

  /** A frozen RequestPlan is used as is; otherwise the route is planned from profile, session and turn controls. */
  private planRequest(
    request: ProfileTurnRequest,
    effectiveProfile: EffectiveAgentProfile,
    config: AgentConfig,
  ): { plan: RequestPlan; controls: ConversationTurnControls } {
    const planned = this.frozenOrPlannedRequest(request, effectiveProfile, config);
    if (
      request.frozenDelegationCapsule &&
      effectiveProfile.reasoningLevel &&
      planned.plan.reasoningWire.selection !== effectiveProfile.reasoningLevel
    ) {
      throw new DelegationConfigurationError(
        'DELEGATION_REASONING_UNSUPPORTED',
        'DELEGATION_REASONING_UNSUPPORTED: selected route cannot honor the Agent reasoning level.',
      );
    }
    return planned;
  }

  private frozenOrPlannedRequest(
    request: ProfileTurnRequest,
    effectiveProfile: EffectiveAgentProfile,
    config: AgentConfig,
  ): { plan: RequestPlan; controls: ConversationTurnControls } {
    const frozen = request.requestPlan;
    if (frozen) {
      return {
        plan: frozen,
        controls: request.turnControls ?? {
          reasoningLevel:
            frozen.reasoningWire.selection === 'unknown' ? ('off' as const) : frozen.reasoningWire.selection,
          maxContextMode: frozen.contextMode === 'one-million',
          fastModel: frozen.fastMode,
        },
      };
    }
    const sessionControls = request.sessionId
      ? sessionRecordStore.readSession(request.sessionId)?.turnControls
      : undefined;
    const planning = planEffectiveModelRequest({
      providerId: config.modelProvider,
      modelId: config.modelName,
      providers: settingsService.providerConnections,
      controls: {
        ...(effectiveProfile.reasoningLevel ? { reasoningLevel: effectiveProfile.reasoningLevel } : {}),
        ...(sessionControls ?? {}),
        ...(request.turnControls ?? {}),
        ...(request.reasoning
          ? { reasoningLevel: request.reasoning.selection === 'unknown' ? 'off' : request.reasoning.selection }
          : {}),
      },
      requestedTemperature: config.temperature,
      compactionThresholdPercent: resolveCompactionPercentForProject(request.projectRootPath ?? null),
    });
    if (!planning.ok) {
      const message = `${planning.code}: ${planning.message}`;
      if (request.frozenDelegationCapsule) throw new DelegationConfigurationError(planning.code, message);
      throw new Error(message);
    }
    return { plan: planning.plan, controls: planning.controls };
  }

  /** The frozen runtime of a child turn: the same prepareTurnContext plan a conversation turn uses, without a commit. */
  private async prepareChildRuntime(
    request: ProfileTurnRequest,
    scope: ProfileTurnScope,
    route: ProfileRoute,
    requestPlan: ProfileRequestPlan,
  ): Promise<PreparedAgentTurnContext> {
    const { agentId } = request;
    const { config, effectiveProfile } = route;
    const isSubagentSession = Boolean(request.sessionId && isSubagentScopeId(request.sessionId));
    const isolateContext = isSubagentSession || !request.sessionId;
    if (!scope.ownedCredentialHandle) {
      throw new AppError('CREDENTIAL_HANDLE_REQUIRED', 'profile turn preparation requires a credential lease.');
    }
    const excludeSubagent = resolveProfileToolAllowlist(['subagent'], request, null).length === 0;
    const providers = settingsService.providerConnections;
    const routeCapability = resolveAgentRouteCapability(
      providers.get(config.modelProvider),
      config.modelName,
      requestPlan.capability,
      requestPlan.plan,
    );
    const preparedTurn = await this.deps.turnPrep.prepareTurnContext({
      requestId: generateEventId('profile-prep'),
      credentialHandle: scope.ownedCredentialHandle,
      turnId: request.turnId ?? generateEventId('turn'),
      agentId,
      content: request.content,
      imageTokenAdjustment: imageTokenAdjustmentForContent(request.content),
      providerId: config.modelProvider,
      selectedModelId: config.modelName,
      effectiveModel: requestPlan.capability,
      routeCapability,
      requestPlan: requestPlan.plan,
      turnControls: requestPlan.controls,
      promptPlan: requestPlan.promptPlan,
      effectiveProfile,
      effectiveProfileIds: [...route.effectiveProfileIds],
      delegableProfileIds: [...(request.delegableProfileIds ?? delegableProfileIds(route.effectiveProfiles))],
      toolAllowlist: requestPlan.toolAllowlist,
      projectRootPath: request.projectRootPath ?? null,
      projectId: request.projectId ?? null,
      sessionId: isolateContext ? null : (request.sessionId ?? null),
      visibleTurnIds: isolateContext ? [] : (request.visibleTurnIds ?? []),
      activeBranchId: request.activeBranchId ?? null,
      signal: request.signal,
      excludeRdcLeaseTools: request.excludeRdcLeaseTools,
      frozenDelegationCapsule: request.frozenDelegationCapsule,
      subagentDepth: request.subagentBudget?.depth ?? request.policyBudget?.childDepth ?? 0,
      inheritedMaxChildDepth: request.policyBudget?.maxChildDepth,
      excludeSubagent,
    });
    scope.preparedLeaseRelease = async () => {
      await preparedTurn.runtime.mcpLease?.release({ discardIfIdle: true });
    };
    return preparedTurn;
  }

  private runPreparedTurn(
    request: ProfileTurnRequest,
    scope: ProfileTurnScope,
    route: ProfileRoute,
    requestPlan: ProfileRequestPlan,
    preparedTurn: PreparedAgentTurnContext,
  ): Promise<string> {
    const { agentId, content, ...options } = request;
    const { plan, controls } = requestPlan;
    return this.deps.turnRunner.runAgentTurn({
      agentId,
      content,
      providerId: route.config.modelProvider,
      modelId: route.config.modelName,
      profileId: agentId,
      runId: options.runId,
      sessionId: scope.executionScopeId,
      turnId: options.turnId ?? preparedTurn.summary.turnId,
      toolAllowlist: preparedTurn.toolAllowlist,
      options: { ...options, reasoning: plan.reasoningWire, turnControls: controls, requestPlan: plan },
      projectRootPath: options.projectRootPath ?? null,
      projectId: options.projectId ?? null,
      effectiveModel: preparedTurn.effectiveModel,
      contextWindow: plan.contextWindowTokens,
      contextTokenLimit: preparedTurn.summary.compactionThresholdTokens,
      initialMessages: preparedTurn.initialMessages,
      contextDiagnostic: preparedTurn.contextDiagnostic,
      preparedRuntime: preparedTurn.runtime,
      terminalContext: options.onTerminalContext
        ? (messages, status, pendingHandoff, completionDeclaration, approvedPlan, completionReceipt) =>
            options.onTerminalContext?.({
              messages,
              executionIdentity: plan.executionIdentity,
              status,
              selectedTurnCount: preparedTurn.contextDiagnostic.selectedTurnCount,
              filteredArtifactCount: preparedTurn.contextDiagnostic.filteredArtifactCount,
              pendingHandoff,
              completionDeclaration,
              completionReceipt,
              approvedPlan,
            })
        : undefined,
    });
  }

  private logProfileTurn(request: ProfileTurnRequest, route: ProfileRoute, responseText: string): void {
    runtimeLogService.log({
      scope: request.sessionId ? 'session' : 'app',
      namespace: 'agent',
      severity: 'info',
      title: `${this.agentDisplayName(request.agentId)} profile turn`,
      summary: responseText.slice(0, 160) || 'Empty message.',
      sessionId: request.sessionId,
      raw: {
        agentId: request.agentId,
        providerId: route.config.modelProvider,
        modelId: route.config.modelName,
      },
    });
  }

  private async endProfileTurn(scope: ProfileTurnScope): Promise<void> {
    if (isTransientScopeId(scope.executionScopeId)) {
      this.deps.toolExecutors.releaseSession(scope.executionScopeId);
      this.deps.slots.purgeAgentStatesForScope(scope.executionScopeId);
    }
    if (scope.preparedLeaseRelease) {
      await scope
        .preparedLeaseRelease()
        .catch((error: unknown) => reportProcessFault('Prepared RDC lease was not released at turn end', error));
    }
    this.deps.credentials.release(scope.ownedCredentialHandle);
  }

  private effectiveProfiles(projectRootPath: string | null | undefined): readonly EffectiveAgentProfile[] {
    return agentManifestService.getEffectiveProfiles(appPathService.getRuntimePaths(), projectRootPath ?? undefined);
  }

  private enabledProfile(agentId: AgentRole, profiles: readonly EffectiveAgentProfile[]): EffectiveAgentProfile | null {
    return profiles.find((definition) => definition.id === agentId && definition.enabled) ?? null;
  }

  private agentDisplayName(agentId: AgentRole): string {
    const definition = settingsService.agentDefinitions().find((entry) => entry.id === agentId);
    return definition?.name || (isTopLevelAgentId(agentId) ? AGENT_DISPLAY_NAMES[agentId] : agentId);
  }

  private updateAgentStatus(sessionOrScopeId: string, agentId: AgentRole, status: AgentState['status']): void {
    this.deps.slots.updateAgentStatus(sessionOrScopeId, agentId, status);
    runtimeLogService.log({
      scope: 'app',
      namespace: 'agent',
      severity: status === 'error' ? 'error' : status === 'complete' ? 'success' : 'info',
      title: this.agentDisplayName(agentId),
      summary: `Status changed to ${status}.`,
      sessionId: sessionOrScopeId,
      raw: { agentId, sessionId: sessionOrScopeId, status },
    });
  }
}
