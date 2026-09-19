import { enforceMissionTurnCompletion } from '../../investigation/missionCompletionContract';
/**
 * AgentOrchestrator — façade over turn preparation, tool assembly, executor,
 * turn runner, subagent runner, and prompt-plan helpers.
 *
 * Public contract: `sendMessage` / `sendProfileMessage` / `getAgentState` /
 * `configureAgent` / `prepareTurnContext`. LLM streaming and tool gating stay
 * in AgentTurnRunner; permissions stay in AgentPermissionPolicy.
 */

import type {
  AgentConfig,
  AgentMessage,
  AgentRole,
  AgentState,
} from '@shared/types/agent';
import type { MCPServerStatusSummary } from '@shared/types/mcp';
import type { LLMConfig } from '@shared/types/llm';
import type { LlmProviderId } from '@shared/types/settings';
import {
  AGENT_DISPLAY_NAMES,
  AgentSlotRegistry,
  AgentTurnRunner,
  createProfileTestResponse,
  createTestModeStub,
  DeferredToolActivationTracker,
  executionProfileService,
  freezeProviderRuntimeCredentials,
  generateEventId,
  isToolAllowedForAgent,
  isTopLevelAgentId,
  McpConnectionCoordinator,
  MemoryStore,
  nowMs,
  planEffectiveModelRequest,
  PromptPlanForTurn,
  providerRuntimeCredentialService,
  resolveAgentToolAllowlist,
  resolveAgentToolAllowlistFromDefinition,
  resolveCompactionPercentForSettings,
  resolveEffectiveModel,
  RuntimeToolAssembly,
  runtimeLogService,
  appPathService,
  agentManifestService,
  compiledRoutesFromDefinitions,
  settingsService,
  storageAdapter,
  streamTestModeStub,
  SubagentRunner,
  createBackgroundSubagentService,
  type BackgroundSubagentService,
  TokenizerService,
  ToolExecutorFactory,
  turnCoordinator,
  TurnPreparationService,
  ProfileTurnPreparation,
  OrchestratorMemoryUi,
  resolveExecutionScopeId,
  createEphemeralScopeId,
  isTransientExecutionScope,
  workflowProjectionPublisher,
  type AbortReason,
  type AgentProfileTurnOptions,
  type AgentTurnContext,
  type AgentTurnOptions,
  type PreparedAgentTurnContext,
  type TurnHandle,
} from './AgentOrchestrator.deps';
import { applyDelegationCapsuleToPromptPlan } from '../../agent-runtime/prompt/DelegationCapsuleCompiler';
import { stripRdxLeaseToolsFromAllowlist } from '@shared/constants/rdxLeaseTools';

export type { PreparedAgentTurnContext } from './AgentOrchestrator.deps';
export class AgentOrchestrator {
  private readonly slots = new AgentSlotRegistry();
  private readonly mcp = new McpConnectionCoordinator();
  private readonly deferredActivation = new DeferredToolActivationTracker();
  private readonly tokenizerService = new TokenizerService();
  private readonly promptPlan = new PromptPlanForTurn();
  private readonly tools: RuntimeToolAssembly;
  private readonly toolExecutors: ToolExecutorFactory;
  private readonly turnPrep: TurnPreparationService;
  private readonly profilePrep: ProfileTurnPreparation;
  private readonly turnRunner: AgentTurnRunner;
  private readonly subagents: SubagentRunner;
  readonly backgroundSubagents: BackgroundSubagentService;
  private readonly memoryUi: OrchestratorMemoryUi;

  constructor() {
    this.slots.initializeDefaults();
    this.memoryUi = new OrchestratorMemoryUi(() => this.getMemoryStore('user'));
    const getActiveTurn = (sessionId?: string | null) =>
      turnCoordinator.getActive(this.sessionTurnKey(sessionId));

    this.subagents = new SubagentRunner({
      sendProfileMessage: (agentId, content, options) => this.sendProfileMessage(agentId, content, options),
      systemPromptForAgent: (agentId, prompt) => this.promptPlan.systemPromptForAgent(agentId, prompt),
      getActiveTurn,
    });
    this.backgroundSubagents = createBackgroundSubagentService(this.subagents);
    this.subagents.setBackgroundStarter((input) => this.backgroundSubagents.start(input));

    this.tools = new RuntimeToolAssembly({
      mcp: this.mcp,
      getActiveTurn,
      getMemoryStore: (scope, projectRootPath) => this.getMemoryStore(scope, projectRootPath),
      createSubagentTools: (parentAgentId, sessionId, turnHandle) =>
        this.subagents.createSubagentTools(parentAgentId, sessionId, turnHandle),
      createBackgroundTools: (parentAgentId, sessionId, turnHandle) =>
        this.backgroundSubagents.createTools(parentAgentId, sessionId, turnHandle),
      getMcpServerStatusSummary: (projectRootPath, query) =>
        this.mcp.getMcpServerStatusSummary(projectRootPath, query),
    });

    this.toolExecutors = new ToolExecutorFactory({
      slots: this.slots,
      deferredActivation: this.deferredActivation,
      getActiveTurn,
      resolveRuntimeTools: (...args) => this.tools.resolveRuntimeTools(...args),
      isAllowedForRuntime: (...args) => this.tools.isAllowedForRuntime(...args),
      matchesToolAllowlist: (...args) => this.tools.matchesToolAllowlist(...args),
    });

    this.turnPrep = new TurnPreparationService({
      mcp: this.mcp,
      deferredActivation: this.deferredActivation,
      resolveRuntimeTools: (...args) => this.tools.resolveRuntimeTools(...args),
      createToolSignature: (...args) => this.tools.createToolSignature(...args),
    });
    this.profilePrep = new ProfileTurnPreparation(this.turnPrep);

    this.turnRunner = new AgentTurnRunner({
      validateCompletion: enforceMissionTurnCompletion,
      slots: this.slots,
      mcp: this.mcp,
      deferredActivation: this.deferredActivation,
      tokenizerService: this.tokenizerService,
      sessionTurnKey: (sessionId) => this.sessionTurnKey(sessionId),
      resolveRuntimeTools: (...args) => this.tools.resolveRuntimeTools(...args),
      createToolSignature: (...args) => this.tools.createToolSignature(...args),
      createToolExecutor: (...args) => this.toolExecutors.createToolExecutor(...args),
    });
  }

  getAgentState(sessionOrScopeId: string, agentId: AgentRole): AgentState | null {
    return this.slots.getAgentState(sessionOrScopeId, agentId);
  }

  getAllAgentStates(): AgentState[] {
    return this.slots.getAllAgentStates();
  }

  configureAgent(agentId: AgentRole, config: Partial<AgentConfig>): void {
    this.slots.configureAgent(agentId, config);
  }

  getAgentConfig(agentId: AgentRole): AgentConfig | null {
    return this.slots.getAgentConfig(agentId);
  }

  applyLlmConfig(_config: LLMConfig): void {
    this.slots.applyLlmConfig(
      compiledRoutesFromDefinitions(settingsService.getAll().agents.definitions),
    );
  }

  getToolsForRole(agentId: AgentRole): string[] {
    return resolveAgentToolAllowlist(agentId);
  }

  isToolAllowedForRole(toolName: string, agentId: AgentRole): boolean {
    return isToolAllowedForAgent(toolName, agentId);
  }

  syncSessionSlots(sessionId: string): void {
    this.slots.syncSession(sessionId);
    this.deferredActivation.clearSession(sessionId);
  }

  private releaseTransientAgentState(scopeId: string): void {
    if (!isTransientExecutionScope(scopeId)) return;
    this.toolExecutors.releaseSession(scopeId);
    this.slots.purgeAgentStatesForScope(scopeId);
  }

  releaseSessionToolState = (sessionId: string): void => this.toolExecutors.releaseSession(sessionId);
  private getOrCreateAgentConfig(agentId: AgentRole): AgentConfig {
    return this.slots.getOrCreateAgentConfig(agentId);
  }

  private sessionTurnKey(sessionId?: string | null, ephemeralScopeId?: string | null): string {
    return resolveExecutionScopeId(sessionId, ephemeralScopeId);
  }

  async sendMessage(
    agentId: AgentRole,
    content: string,
    context?: AgentTurnContext,
    options?: AgentTurnOptions,
  ): Promise<string> {
    const executionScopeId = resolveExecutionScopeId(context?.sessionId, createEphemeralScopeId());
    const fallbackConfig = this.getOrCreateAgentConfig(agentId);
    let ownedCredentialHandle: string | undefined;
    let preparedLeaseRelease: (() => Promise<void>) | undefined;

    this.updateAgentStatus(executionScopeId, agentId, 'thinking');

    try {
      const stub = createTestModeStub(agentId, content, this.getAgentDisplayName(agentId));
      let runtimeProfile = this.resolveRuntimeProfile(agentId);
      let effectiveSnapshot = this.resolveEffectiveAgentProfileSnapshot(agentId, context?.projectRootPath);
      let effectiveProfile = effectiveSnapshot.profile;
      if (!stub) {
        const credentialProviderId = runtimeProfile.providerId;
        ownedCredentialHandle = await this.refreshProviderRuntimeCredentials(credentialProviderId);
        runtimeProfile = this.resolveRuntimeProfile(agentId);
        effectiveSnapshot = this.resolveEffectiveAgentProfileSnapshot(agentId, context?.projectRootPath);
        effectiveProfile = effectiveSnapshot.profile;
        if (runtimeProfile.providerId !== credentialProviderId) {
          providerRuntimeCredentialService.release(ownedCredentialHandle);
          ownedCredentialHandle = await this.refreshProviderRuntimeCredentials(runtimeProfile.providerId);
        }
      }
      const config: AgentConfig = {
        ...fallbackConfig,
        systemPrompt: effectiveProfile?.instructions || runtimeProfile.systemPrompt,
        modelProvider: runtimeProfile.providerId,
        modelName: runtimeProfile.modelId,
        temperature: runtimeProfile.temperature ?? fallbackConfig.temperature,
      };

      await this.recordMessage(agentId, 'user', content, context);

      if (stub) {
        const responseText = await streamTestModeStub(stub, options);
        const finalContent = await this.finalizeRecordedAssistantMessage(
          agentId,
          responseText,
          responseText,
          context,
        );
        this.updateAgentStatus(executionScopeId, agentId, 'complete');
        return finalContent;
      }

      if (!effectiveProfile) {
        throw new Error(`AGENT_PROFILE_UNAVAILABLE: ${agentId}`);
      }
      const settings = settingsService.getAll();
      const sessionRecord = context?.sessionId ? storageAdapter.readSession(context.sessionId) : null;
      const toolAllowlist = resolveAgentToolAllowlistFromDefinition(agentId, effectiveProfile.tools);
      const planning = planEffectiveModelRequest({
        providerId: config.modelProvider,
        modelId: config.modelName,
        settings,
        controls: {
          ...(sessionRecord?.turnControls ?? {}),
          ...(options?.turnControls ?? {}),
          ...(options?.reasoning
            ? { reasoningLevel: options.reasoning.selection === 'unknown' ? 'off' : options.reasoning.selection }
            : {}),
        },
        requestedTemperature: config.temperature,
        compactionThresholdPercent: resolveCompactionPercentForSettings(
          settings,
          context?.projectRootPath ?? null,
        ),
      });
      if (!planning.ok) throw new Error(`${planning.code}: ${planning.message}`);
      const capability = resolveEffectiveModel(config.modelProvider, config.modelName, settings);
      if (!capability) throw new Error(`MODEL_UNAVAILABLE: ${config.modelProvider}/${config.modelName}`);
      const activeContextWindow = planning.plan.contextWindowTokens;
      const promptPlan = this.promptPlan.buildPromptPlanForAgentTurn({
        agentId,
        sessionId: context?.sessionId ?? null,
        projectRootPath: context?.projectRootPath ?? null,
        providerId: config.modelProvider,
        modelId: config.modelName,
        toolAllowlist,
        contextWindowTokens: activeContextWindow,
        capability,
        systemPrompt: config.systemPrompt,
        messageText: content,
        preloadSkillIds: options?.preloadSkillIds,
        effectiveProfile,
      });
      if (!promptPlan) {
        throw new Error(`PROMPT_PLAN_UNAVAILABLE: ${agentId}`);
      }
      const preparedBundle = await this.profilePrep.prepare({
        agentId,
        content,
        systemPrompt: promptPlan.systemPrompt,
        providerId: config.modelProvider,
        modelId: config.modelName,
        toolAllowlist,
        promptPlan,
        effectiveProfile,
        effectiveProfileIds: effectiveSnapshot.enabledProfileIds,
        projectRootPath: context?.projectRootPath ?? null,
        projectId: context?.projectId ?? null,
        sessionId: context?.sessionId ?? null,
        turnId: context?.turnId,
        credentialHandle: ownedCredentialHandle!,
        requestPlan: planning.plan,
        turnControls: planning.controls,
        temperature: config.temperature,
        signal: options?.signal,
        isolateContext: !context?.sessionId,
      });
      preparedLeaseRelease = async () => {
        await preparedBundle.prepared.runtime.mcpLease?.release({ discardIfIdle: true });
      };
      const responseText = await this.turnRunner.runAgentTurn({
        agentId,
        content,
        systemPrompt: promptPlan.systemPrompt,
        providerId: config.modelProvider,
        modelId: config.modelName,
        temperature: planning.plan.temperature,
        profileId: agentId,
        runId: context?.runId,
        sessionId: executionScopeId,
        turnId: context?.turnId ?? preparedBundle.prepared.summary.turnId,
        toolAllowlist: preparedBundle.prepared.toolAllowlist,
        options: {
          ...options,
          reasoning: planning.plan.reasoningWire,
          turnControls: planning.controls,
          requestPlan: planning.plan,
        },
        projectRootPath: context?.projectRootPath ?? null,
        projectId: context?.projectId ?? null,
        promptPlan,
        effectiveModel: preparedBundle.effectiveModel,
        effectiveProfile,
        effectiveProfileIds: effectiveSnapshot.enabledProfileIds,
        credentialHandle: ownedCredentialHandle,
        contextWindow: activeContextWindow,
        contextTokenLimit: preparedBundle.prepared.summary.compactionThresholdTokens,
        initialMessages: preparedBundle.prepared.initialMessages,
        contextDiagnostic: preparedBundle.prepared.contextDiagnostic,
        preparedRuntime: preparedBundle.prepared.runtime,
      });
      preparedLeaseRelease = undefined;

      const finalContent = await this.finalizeRecordedAssistantMessage(
        agentId,
        responseText,
        responseText,
        context,
      );

      this.updateAgentStatus(executionScopeId, agentId, 'complete');
      return finalContent;
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

  async refreshProviderRuntimeCredentials(providerId: LlmProviderId): Promise<string> {
    const lease = await freezeProviderRuntimeCredentials(providerId);
    if (lease.accountCredentialsRefreshed) {
      this.applyLlmConfig(settingsService.getLlmConfig());
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
      let settings = settingsService.getAll();
      const routeAgentId = options?.routeAgentId ?? agentId;
      const modelOverride = options?.modelOverride ?? null;
      const frozenRequestPlan = options?.requestPlan;
      const effectiveProfiles = options?.effectiveProfile
        ? [options.effectiveProfile]
        : agentManifestService.getEffectiveProfiles(
            settings.paths,
            settings.llm.providers,
            [],
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
      if (credentialProviderId && !preparedTurn && process.env.RDC_AGENT_TEST_MODE !== '1') {
        ownedCredentialHandle = await this.refreshProviderRuntimeCredentials(credentialProviderId);
        settings = settingsService.getAll();
        const refreshed = this.resolveEffectiveAgentProfileSnapshot(agentId, options?.projectRootPath);
        route = refreshed.profile?.compiledRoute?.providerId
          ? refreshed.profile.compiledRoute
          : route;
      }
      const effectiveProfileIds = options?.effectiveProfileIds?.length
        ? options.effectiveProfileIds
        : effectiveProfiles.filter((definition) => definition.enabled).map((definition) => definition.id);
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

      if (process.env.RDC_AGENT_TEST_MODE === '1') {
        const finalStub = await createProfileTestResponse(agentId, content, options);
        this.updateAgentStatus(executionScopeId, agentId, 'complete');
        return finalStub;
      }

      if (!effectiveProfile) {
        throw new Error(`AGENT_PROFILE_UNAVAILABLE: ${agentId}`);
      }

      const resolvedAllowlist = preparedTurn?.toolAllowlist
        ?? resolveAgentToolAllowlistFromDefinition(agentId, effectiveProfile.tools);
      const toolAllowlist = options?.excludeRdxLeaseTools
        ? stripRdxLeaseToolsFromAllowlist(resolvedAllowlist)
        : resolvedAllowlist;
      const routeProviderId = config.modelProvider;
      const routeModelId = config.modelName;
      const sessionControls = options?.sessionId
        ? storageAdapter.readSession(options.sessionId)?.turnControls
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
            settings,
            controls: {
              ...(sessionControls ?? {}),
              ...(options?.turnControls ?? {}),
              ...(options?.reasoning
                ? { reasoningLevel: options.reasoning.selection === 'unknown' ? 'off' : options.reasoning.selection }
                : {}),
            },
            requestedTemperature: config.temperature,
            compactionThresholdPercent: resolveCompactionPercentForSettings(
              settings,
              options?.projectRootPath ?? null,
            ),
          });
      if (!planning.ok) throw new Error(`${planning.code}: ${planning.message}`);
      if (options?.frozenDelegationCapsule?.reasoningLevel && planning.plan.reasoningWire.selection !== options.frozenDelegationCapsule.reasoningLevel) throw new Error('DELEGATION_REASONING_UNSUPPORTED: selected route cannot honor the requested reasoning level.');
      const capability = preparedTurn?.effectiveModel
        ?? resolveEffectiveModel(routeProviderId, routeModelId, settings);
      if (!capability) throw new Error(`MODEL_UNAVAILABLE: ${routeProviderId}/${routeModelId}`);
      const activeContextWindow = planning.plan.contextWindowTokens;
      let promptPlan = options?.promptPlan ?? this.promptPlan.buildPromptPlanForAgentTurn({
        agentId,
        sessionId: options?.sessionId ?? null,
        projectRootPath: options?.projectRootPath ?? null,
        providerId: routeProviderId,
        modelId: routeModelId,
        toolAllowlist,
        contextWindowTokens: activeContextWindow,
        capability,
        systemPrompt: config.systemPrompt,
        messageText: typeof content === 'string' ? content : '',
        preloadSkillIds: options?.preloadSkillIds,
        effectiveProfile,
        extraSegments: options?.extraPromptSegments,
      });
      if (!promptPlan) throw new Error(`PROMPT_PLAN_UNAVAILABLE: ${agentId}`);
      if (options?.promptPlan && options.extraPromptSegments?.length) {
        promptPlan = applyDelegationCapsuleToPromptPlan(promptPlan, options.extraPromptSegments);
      }

      const isSubagentSession = Boolean(options?.sessionId?.includes('::subagent::'));
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
          projectRootPath: options?.projectRootPath ?? null,
          projectId: options?.projectId ?? null,
          sessionId: isSubagentSession ? null : (options?.sessionId ?? null),
          turnId: options?.turnId,
          credentialHandle: (() => {
            if (!ownedCredentialHandle) {
              throw new Error('CREDENTIAL_HANDLE_REQUIRED: profile turn preparation requires a credential lease.');
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
          excludeRdxLeaseTools: options?.excludeRdxLeaseTools,
          frozenDelegationCapsule: options?.frozenDelegationCapsule,
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
        systemPrompt: promptPlan.systemPrompt,
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
        promptPlan,
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
          ? (messages, status, pendingHandoff, completionDeclaration) => options.onTerminalContext?.({
              messages,
              executionIdentity: planning.plan.executionIdentity,
              status,
              selectedTurnCount: preparedTurn!.contextDiagnostic.selectedTurnCount,
              filteredArtifactCount: preparedTurn!.contextDiagnostic.filteredArtifactCount,
              pendingHandoff,
              completionDeclaration,
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

  async runSubagent(input: Parameters<SubagentRunner['runSubagent']>[0]): Promise<Awaited<ReturnType<SubagentRunner['runSubagent']>>> { return this.subagents.runSubagent(input); }
  createSubagentTools(parentAgentId: AgentRole, sessionId?: string | null, turnHandle?: TurnHandle | null) { return this.subagents.createSubagentTools(parentAgentId, sessionId, turnHandle); }
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

  private getMemoryStore(scope: 'user' | 'project', projectRootPath?: string | null): MemoryStore {
    if (scope === 'project') {
      if (!projectRootPath) throw new Error('Project scope memory requires an active project.');
      return new MemoryStore(appPathService.getProjectRdxPaths(projectRootPath).memoryPath);
    }
    return new MemoryStore(appPathService.getUserRdxPaths().memoryPath);
  }

  async listMemoriesForUi(): Promise<Array<{ name: string; description: string; type: string; updatedAt: number }>> {
    return this.memoryUi.listMemories();
  }

  async getMemoryForUi(name: string): Promise<{
    name: string; description: string; type: string; content: string; tags?: string[]; createdAt: number; updatedAt: number;
  } | null> {
    return this.memoryUi.getMemory(name);
  }

  async writeMemoryForUi(request: { name: string; description: string; type: 'user' | 'feedback' | 'project' | 'reference'; content: string; tags?: string[] }): Promise<{ success: boolean; name: string; error?: string }> {
    return this.memoryUi.writeMemory(request);
  }

  async deleteMemoryForUi(name: string): Promise<{ success: boolean; error?: string }> {
    return this.memoryUi.deleteMemory(name);
  }


  getMcpServerStatusSummary(projectRootPath?: string | null, query?: string): MCPServerStatusSummary[] {
    return this.mcp.getMcpServerStatusSummary(projectRootPath, query);
  }

  async disconnectAllMcpServers(): Promise<void> {
    await this.mcp.disconnectAll();
  }

  private resolveEffectiveAgentProfileSnapshot(agentId: AgentRole, projectRootPath?: string | null) {
    const settings = settingsService.getAll();
    const profiles = agentManifestService.getEffectiveProfiles(
      settings.paths,
      settings.llm.providers,
      [],
      projectRootPath ?? undefined,
    );
    return {
      profile: profiles.find((definition) => definition.id === agentId && definition.enabled) ?? null,
      enabledProfileIds: profiles.filter((definition) => definition.enabled).map((definition) => definition.id),
    };
  }

  private resolveRuntimeProfile(agentId: AgentRole) {
    const settings = settingsService.getAll();
    return executionProfileService.resolveAgentRuntimeProfile(settings, agentId);
  }

  private getAgentDisplayName(agentId: AgentRole): string {
    const definition = settingsService.getAll().agents.definitions.find((entry) => entry.id === agentId);
    return definition?.name || (isTopLevelAgentId(agentId) ? AGENT_DISPLAY_NAMES[agentId] : agentId);
  }

  private async finalizeRecordedAssistantMessage(
    agentId: AgentRole,
    streamedContent: string,
    fallbackContent: string,
    context?: AgentTurnContext,
  ): Promise<string> {
    const finalContent = streamedContent || fallbackContent;
    await this.recordMessage(agentId, 'assistant', finalContent, context);
    return finalContent;
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

  private async recordMessage(
    agentId: AgentRole,
    role: 'user' | 'assistant' | 'system',
    content: string,
    context?: { caseId?: string; runId?: string; sessionId?: string; turnId?: string },
  ): Promise<void> {
    if (!context?.sessionId) return;

    const message: AgentMessage = {
      id: generateEventId('msg'),
      agentId,
      role,
      content,
      timestamp: nowMs(),
    };

    if (context.runId) {
      await storageAdapter.appendActionEvent(context.sessionId, storageAdapter.createActionEvent({
        runId: context.runId,
        sessionId: context.sessionId,
        agentId,
        eventType: role === 'user' ? 'user_message' : role === 'assistant' ? 'agent_summary' : 'system',
        status: role === 'system' ? 'warning' : 'ok',
        turnId: context.turnId,
        payload: {
          role,
          content,
          message_id: message.id,
        },
      }));
    }

    this.notifyMessage(message, context?.sessionId);
  }

  private notifyMessage(message: AgentMessage, sessionId?: string): void {
    runtimeLogService.log({
      scope: sessionId ? 'session' : 'app',
      namespace: 'agent',
      severity: message.role === 'system' ? 'warning' : 'info',
      title: this.getAgentDisplayName(message.agentId),
      summary: message.content.slice(0, 120) || 'Empty message.',
      sessionId,
      raw: {
        agentId: message.agentId,
        role: message.role,
        messageId: message.id,
        content: message.content,
      },
      timestamp: message.timestamp,
    });
    workflowProjectionPublisher.publishAgentMessage(message);
  }
}

export const agentOrchestrator = new AgentOrchestrator();
