/**
 * AgentOrchestrator — façade over turn preparation, tool assembly, executor,
 * turn runner, subagent runner, and prompt-plan helpers.
 *
 * 公共契约（不变）：
 *  - `sendMessage(agentId, content, runContext?, options?) → Promise<string>`
 *  - `sendProfileMessage(agentId, content, options?) -> Promise<string>`
 *  - `getAgentState`, `getAllAgentStates`, `configureAgent`, `applyLlmConfig`
 *  - `prepareTurnContext`（委托 TurnPreparationService）
 *  - 状态广播仍走 `WorkflowProjectionPublisher`，事件名不变。
 *
 * Phase 4：状态登记委托 AgentSlotRegistry / McpConnectionCoordinator /
 * DeferredToolActivationTracker / HandoffMailbox；TurnEventSink 由 TurnCoordinator 持有。
 *
 * Provider path: LLM streaming is delegated to AgentTurnRunner which uses
 * `configuredRuntimeProvider` (the HAL adapter registry entry point).
 *
 * Tool gating: AgentTurnRunner calls `resolveAgentRouteCapability` to determine
 * `activeToolDefinitions` based on route capability. `describeRouteCapabilityDiagnostic`
 * emits diagnostics for text-only or disabled routes. `recordObservedToolCallingSupport`
 * persists structured tool evidence. Diagnostics include `textual_tool_call_not_executed`
 * and `empty_response_without_tool_call` normalization.
 *
 * Permission: Tools are mediated via `agentPermissionPolicyService.evaluate` and
 * `agentToolApprovalRequestService.request` / `agentToolApprovalRequestService.autoReview`.
 * External path access uses `withTemporaryPathAccess` scoped to tool execution.
 *
 * PromptPlan is required before creating an agent runtime slot.
 * RequestEnvelope snapshots are created via `requestEnvelopeBuilder.build`.
 */

import type {
  AgentConfig,
  AgentMessage,
  AgentRole,
  AgentState,
} from '@shared/types/agent';
import type { MCPServerStatusSummary } from '@shared/types/mcp';
import type { LLMConfig } from '@shared/types/llm';
import type { AppMode } from '@shared/types/session';
import type { LlmProviderId } from '@shared/types/settings';
import type { WorkflowStage } from '@shared/types/workflow';
import {
  AGENT_DISPLAY_NAMES,
  AgentSlotRegistry,
  AgentTurnRunner,
  CONTEXT_COMPACTION_RATIO,
  countContinuationDecisions,
  createProfileTestResponse,
  createTestModeStub,
  DeferredToolActivationTracker,
  executionProfileService,
  freezeProviderRuntimeCredentials,
  generateEventId,
  HandoffMailbox,
  isToolAllowedForAgent,
  isTopLevelAgentId,
  McpConnectionCoordinator,
  MemoryStore,
  nowIso,
  nowMs,
  planEffectiveModelRequest,
  PromptPlanForTurn,
  providerRuntimeCredentialService,
  resolveAgentToolAllowlist,
  resolveEffectiveModel,
  RuntimeToolAssembly,
  runtimeLogService,
  appPathService,
  sessionContextJournal,
  settingsService,
  storageAdapter,
  streamTestModeStub,
  SubagentRunner,
  TokenizerService,
  ToolExecutorFactory,
  turnCoordinator,
  TurnPreparationService,
  workflowProjectionPublisher,
  type AbortReason,
  type AgentProfileTurnOptions,
  type AgentTurnContext,
  type AgentTurnOptions,
  type PreparedAgentTurnContext,
  type TurnHandle,
} from './AgentOrchestrator.deps';

export type { PreparedAgentTurnContext } from './AgentOrchestrator.deps';
export class AgentOrchestrator {
  private readonly slots = new AgentSlotRegistry();
  private readonly mcp = new McpConnectionCoordinator();
  private readonly deferredActivation = new DeferredToolActivationTracker();
  private readonly handoffMailbox = new HandoffMailbox();
  private readonly tokenizerService = new TokenizerService();
  private readonly promptPlan = new PromptPlanForTurn();
  private readonly tools: RuntimeToolAssembly;
  private readonly toolExecutors: ToolExecutorFactory;
  private readonly turnPrep: TurnPreparationService;
  private readonly turnRunner: AgentTurnRunner;
  private readonly subagents: SubagentRunner;

  constructor() {
    this.slots.initializeDefaults();
    const getActiveTurn = (sessionId?: string | null) =>
      turnCoordinator.getActive(this.sessionTurnKey(sessionId));

    this.subagents = new SubagentRunner({
      sendProfileMessage: (agentId, content, options) => this.sendProfileMessage(agentId, content, options),
      systemPromptForAgent: (agentId, prompt) => this.promptPlan.systemPromptForAgent(agentId, prompt),
      getActiveTurn,
    });

    this.tools = new RuntimeToolAssembly({
      mcp: this.mcp,
      handoffMailbox: this.handoffMailbox,
      getActiveTurn,
      getMemoryStore: (scope, projectRootPath) => this.getMemoryStore(scope, projectRootPath),
      createSubagentTools: (parentAgentId, sessionId, turnHandle) =>
        this.subagents.createSubagentTools(parentAgentId, sessionId, turnHandle),
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

    this.turnRunner = new AgentTurnRunner({
      slots: this.slots,
      mcp: this.mcp,
      deferredActivation: this.deferredActivation,
      handoffMailbox: this.handoffMailbox,
      tokenizerService: this.tokenizerService,
      sessionTurnKey: (sessionId) => this.sessionTurnKey(sessionId),
      resolveRuntimeTools: (...args) => this.tools.resolveRuntimeTools(...args),
      createToolSignature: (...args) => this.tools.createToolSignature(...args),
      createToolExecutor: (...args) => this.toolExecutors.createToolExecutor(...args),
    });
  }

  getAgentState(agentId: AgentRole): AgentState | null {
    return this.slots.getAgentState(agentId);
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

  applyLlmConfig(config: LLMConfig): void {
    this.slots.applyLlmConfig(config);
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

  private getOrCreateAgentConfig(agentId: AgentRole): AgentConfig {
    return this.slots.getOrCreateAgentConfig(agentId);
  }

  private ensureAgentState(agentId: AgentRole): AgentState {
    return this.slots.ensureAgentState(agentId);
  }

  private sessionTurnKey(sessionId?: string | null): string {
    return sessionId?.trim() || '__anon__';
  }

  async sendMessage(
    agentId: AgentRole,
    content: string,
    context?: AgentTurnContext,
    options?: AgentTurnOptions,
  ): Promise<string> {
    const fallbackConfig = this.getOrCreateAgentConfig(agentId);
    let ownedCredentialHandle: string | undefined;

    this.updateAgentStatus(agentId, 'thinking');

    try {
      const stub = createTestModeStub(agentId, content, this.getAgentDisplayName(agentId));
      let runtimeProfile = this.resolveRuntimeProfile(agentId, context?.stageId);
      if (!stub) {
        const credentialProviderId = runtimeProfile.providerId;
        ownedCredentialHandle = await this.refreshProviderRuntimeCredentials(credentialProviderId);
        runtimeProfile = this.resolveRuntimeProfile(agentId, context?.stageId);
        if (runtimeProfile.providerId !== credentialProviderId) {
          providerRuntimeCredentialService.release(ownedCredentialHandle);
          ownedCredentialHandle = await this.refreshProviderRuntimeCredentials(runtimeProfile.providerId);
        }
      }
      const config: AgentConfig = {
        ...fallbackConfig,
        systemPrompt: runtimeProfile.systemPrompt,
        modelProvider: runtimeProfile.providerId,
        modelName: runtimeProfile.modelId,
        temperature: runtimeProfile.temperature ?? fallbackConfig.temperature,
        maxTokens: runtimeProfile.maxTokens ?? fallbackConfig.maxTokens,
      };

      await this.recordMessage(agentId, 'user', content, context);

      const settings = settingsService.getAll();
      const sessionRecord = context?.sessionId ? storageAdapter.readSession(context.sessionId) : null;
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
      });
      if (!planning.ok) throw new Error(`${planning.code}: ${planning.message}`);
      const capability = resolveEffectiveModel(config.modelProvider, config.modelName, settings);
      if (!capability) throw new Error(`MODEL_UNAVAILABLE: ${config.modelProvider}/${config.modelName}`);
      const activeContextWindow = planning.plan.contextWindowTokens;
      const contextTokenLimit = Math.floor(
        planning.plan.contextBudgetTokens * CONTEXT_COMPACTION_RATIO,
      );
      const toolAllowlist = resolveAgentToolAllowlist(agentId, context?.stageId);
      // Debug 路径与 Composer/Ask 对齐：经 PromptPlanBuilder 拆分 system/memory_files/skills。
      const promptPlan = this.promptPlan.buildPromptPlanForAgentTurn({
        agentId,
        projectRootPath: context?.projectRootPath ?? null,
        providerId: config.modelProvider,
        modelId: config.modelName,
        toolAllowlist,
        contextWindowTokens: activeContextWindow,
        capability,
        systemPrompt: config.systemPrompt,
        messageText: content,
        preloadSkillIds: options?.preloadSkillIds,
      });
      if (!stub && !promptPlan) {
        throw new Error(`PROMPT_PLAN_UNAVAILABLE: ${agentId}`);
      }
      const systemPrompt = promptPlan?.systemPrompt
        ?? this.promptPlan.systemPromptForAgent(agentId, config.systemPrompt);
      const responseText = stub
        ? await streamTestModeStub(stub, options)
        : await this.turnRunner.runAgentTurn({
          agentId,
          content,
          systemPrompt,
          providerId: config.modelProvider,
          modelId: config.modelName,
          maxTokens: config.maxTokens,
          temperature: planning.plan.temperature,
          mode: this.modeForAgent(agentId),
          stage: context?.stageId,
          runId: context?.runId,
          sessionId: context?.sessionId ?? null,
          turnId: context?.turnId,
          toolAllowlist,
          options: {
            ...options,
            reasoning: planning.plan.reasoningWire,
            turnControls: planning.controls,
            requestPlan: planning.plan,
          },
          projectRootPath: context?.projectRootPath ?? null,
          projectId: context?.projectId ?? null,
          promptPlan: promptPlan!,
          effectiveModel: capability,
          credentialHandle: ownedCredentialHandle,
          contextWindow: activeContextWindow,
          contextTokenLimit,
        });

      const finalContent = await this.finalizeRecordedAssistantMessage(
        agentId,
        responseText,
        responseText,
        context,
      );

      this.updateAgentStatus(agentId, 'complete');
      return finalContent;
    } catch (error) {
      this.updateAgentStatus(agentId, 'error');
      throw error;
    } finally {
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
    const fallbackConfig = this.getOrCreateAgentConfig(agentId);
    let ownedCredentialHandle: string | undefined;

    this.updateAgentStatus(agentId, 'thinking');

    try {
      const preparedTurn = options?.preparedTurn;
      let settings = settingsService.getAll();
      let routeMap = new Map(settings.llm.agentRoutes.map((route) => [route.agentId, route]));
      const routeAgentId = options?.routeAgentId ?? agentId;
      let route = routeMap.get(routeAgentId);
      const frozenRequestPlan = options?.requestPlan;
      const credentialProviderId = frozenRequestPlan?.providerId ?? route?.providerId;
      if (credentialProviderId && !preparedTurn && process.env.RDC_AGENT_TEST_MODE !== '1') {
        ownedCredentialHandle = await this.refreshProviderRuntimeCredentials(credentialProviderId);
        settings = settingsService.getAll();
        routeMap = new Map(settings.llm.agentRoutes.map((entry) => [entry.agentId, entry]));
        route = routeMap.get(routeAgentId);
      }
      const config: AgentConfig = {
        ...fallbackConfig,
        modelProvider: frozenRequestPlan?.providerId ?? route?.providerId ?? fallbackConfig.modelProvider,
        modelName: frozenRequestPlan?.effectiveModelId ?? route?.modelId ?? fallbackConfig.modelName,
        systemPrompt: options?.systemPrompt || fallbackConfig.systemPrompt,
        temperature: options?.temperature ?? fallbackConfig.temperature,
        maxTokens: options?.maxTokens ?? fallbackConfig.maxTokens,
      };

      if (process.env.RDC_AGENT_TEST_MODE === '1') {
        const finalStub = await createProfileTestResponse(agentId, content, options);
        this.updateAgentStatus(agentId, 'complete');
        return finalStub;
      }

      const toolAllowlist = preparedTurn?.toolAllowlist
        ?? resolveAgentToolAllowlist(agentId, options?.stage && options.stage !== 'report' ? options.stage : undefined);
      const routeProviderId = config.modelProvider;
      const routeModelId = config.modelName;
      const sessionControls = options?.sessionId ? storageAdapter.readSession(options.sessionId)?.turnControls : undefined;
      const planning = frozenRequestPlan
        ? {
            ok: true as const,
            plan: frozenRequestPlan,
            controls: options?.turnControls ?? {
              reasoningLevel: frozenRequestPlan.reasoningWire.selection === 'unknown'
                ? 'off'
                : frozenRequestPlan.reasoningWire.selection,
              maxContextMode: frozenRequestPlan.contextMode === 'one-million',
              fastModel: frozenRequestPlan.fastMode,
            },
            warnings: [],
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
          });
      if (!planning.ok) throw new Error(`${planning.code}: ${planning.message}`);
      const capability = preparedTurn?.effectiveModel
        ?? resolveEffectiveModel(routeProviderId, routeModelId, settings);
      if (!capability) throw new Error(`MODEL_UNAVAILABLE: ${routeProviderId}/${routeModelId}`);
      const activeContextWindow = planning.plan.contextWindowTokens;
      const contextTokenLimit = Math.floor(
        planning.plan.contextBudgetTokens * CONTEXT_COMPACTION_RATIO,
      );
      const promptPlan = options?.promptPlan ?? this.promptPlan.buildPromptPlanForAgentTurn({
        agentId,
        projectRootPath: options?.projectRootPath ?? null,
        providerId: routeProviderId,
        modelId: routeModelId,
        toolAllowlist,
        contextWindowTokens: activeContextWindow,
        capability,
        systemPrompt: config.systemPrompt,
        messageText: typeof content === 'string' ? content : '',
        preloadSkillIds: options?.preloadSkillIds,
      });
      if (!promptPlan) throw new Error(`PROMPT_PLAN_UNAVAILABLE: ${agentId}`);

      const journalSessionId = options?.sessionId && !options.sessionId.includes('::subagent::')
        ? options.sessionId
        : null;
      const materialized = preparedTurn
        ? {
            messages: preparedTurn.initialMessages,
            selectedTurnCount: preparedTurn.contextDiagnostic.selectedTurnCount,
            filteredArtifactCount: preparedTurn.contextDiagnostic.filteredArtifactCount,
            replayedArtifactCount: preparedTurn.contextDiagnostic.replayedArtifactCount,
            artifactDecisions: [],
            derivedContextStatus: preparedTurn.contextDiagnostic.derivedContextStatus,
            compactedTurnCount: preparedTurn.contextDiagnostic.compactedTurnCount,
          }
        : journalSessionId
          ? sessionContextJournal.materialize(
              journalSessionId,
              options?.visibleTurnIds ?? [],
              planning.plan,
              options?.activeBranchId ?? undefined,
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

      const responseText = await this.turnRunner.runAgentTurn({
        agentId,
        content,
        systemPrompt: promptPlan.systemPrompt,
        providerId: routeProviderId,
        modelId: routeModelId,
        maxTokens: config.maxTokens,
        temperature: planning.plan.temperature,
        mode: this.modeForAgent(agentId),
        stage: options?.stage ?? 'investigate',
        runId: undefined,
        sessionId: options?.sessionId ?? null,
        turnId: options?.turnId,
        toolAllowlist,
        options: {
          ...options,
          reasoning: planning.plan.reasoningWire,
          turnControls: planning.controls,
          requestPlan: planning.plan,
        },
        projectRootPath: options?.projectRootPath ?? null,
        projectId: options?.projectId ?? null,
        promptPlan,
        effectiveModel: capability,
        credentialHandle: ownedCredentialHandle,
        contextWindow: activeContextWindow,
        contextTokenLimit,
        initialMessages: materialized.messages,
        contextDiagnostic: preparedTurn?.contextDiagnostic ?? {
          selectedTurnCount: materialized.selectedTurnCount,
          activeBranchId: options?.activeBranchId ?? null,
          filteredArtifactCount: materialized.filteredArtifactCount,
          replayedArtifactCount: materialized.replayedArtifactCount,
          continuationDecisionCounts: countContinuationDecisions(materialized.artifactDecisions),
          derivedContextStatus: materialized.derivedContextStatus,
          compactedTurnCount: materialized.compactedTurnCount,
          compactionState: 'derived-view-only',
        },
        preparedRuntime: preparedTurn?.runtime,
        terminalContext: options?.onTerminalContext
          ? (messages, status) => options.onTerminalContext?.({
              messages,
              executionIdentity: planning.plan.executionIdentity,
              status,
              selectedTurnCount: materialized.selectedTurnCount,
              filteredArtifactCount: materialized.filteredArtifactCount,
            })
          : undefined,
      });

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

      this.updateAgentStatus(agentId, 'complete');
      return responseText;
    } catch (error) {
      this.updateAgentStatus(agentId, 'error');
      throw error;
    } finally {
      providerRuntimeCredentialService.release(ownedCredentialHandle);
    }
  }

  async runSubagent(input: Parameters<SubagentRunner['runSubagent']>[0]): Promise<Awaited<ReturnType<SubagentRunner['runSubagent']>>> {
    return this.subagents.runSubagent(input);
  }

  createSubagentTools(parentAgentId: AgentRole, sessionId?: string | null, turnHandle?: TurnHandle | null) {
    return this.subagents.createSubagentTools(parentAgentId, sessionId, turnHandle);
  }

  async abortAndJoin(
    sessionId: string | null | undefined,
    options?: { graceMs?: number; forceAfterMs?: number; reason?: AbortReason },
  ): Promise<void> {
    const key = this.sessionTurnKey(sessionId);
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
    try {
      const all = await this.getMemoryStore('user').listMemories();
      return all.map((m) => ({ name: m.name, description: m.description, type: m.type, updatedAt: m.updatedAt }));
    } catch {
      return [];
    }
  }

  async getMemoryForUi(name: string): Promise<{
    name: string; description: string; type: string; content: string; tags?: string[]; createdAt: number; updatedAt: number;
  } | null> {
    try {
      const record = await this.getMemoryStore('user').getMemory(name);
      if (!record) return null;
      return {
        name: record.name,
        description: record.description,
        type: record.type,
        content: record.content,
        tags: record.tags,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    } catch {
      return null;
    }
  }

  async writeMemoryForUi(request: { name: string; description: string; type: 'user' | 'feedback' | 'project' | 'reference'; content: string; tags?: string[] }): Promise<{ success: boolean; name: string; error?: string }> {
    try {
      const record = await this.getMemoryStore('user').writeMemory(request);
      return { success: true, name: record.name };
    } catch (error) {
      return { success: false, name: request.name, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async deleteMemoryForUi(name: string): Promise<{ success: boolean; error?: string }> {
    try {
      const deleted = await this.getMemoryStore('user').deleteMemory(name);
      return { success: deleted };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  consumePendingHandoff(): {
    fromAgentId: AgentRole;
    toProfile: AgentRole;
    prompt: string;
    label: string;
    sessionId?: string | null;
  } | null {
    return this.handoffMailbox.consume();
  }


  getMcpServerStatusSummary(projectRootPath?: string | null, query?: string): MCPServerStatusSummary[] {
    return this.mcp.getMcpServerStatusSummary(projectRootPath, query);
  }

  async disconnectAllMcpServers(): Promise<void> {
    await this.mcp.disconnectAll();
  }

  private resolveRuntimeProfile(agentId: AgentRole, stage?: WorkflowStage) {
    const settings = settingsService.getAll();
    return executionProfileService.resolveAgentRuntimeProfile(settings, stage || 'investigate', agentId);
  }

  private modeForAgent(agentId: AgentRole): AppMode {
    if (agentId === 'plan') {
      return 'ask';
    }
    return isTopLevelAgentId(agentId) ? agentId as AppMode : 'edit';
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

  private updateAgentStatus(agentId: AgentRole, status: AgentState['status']): void {
    const state = this.ensureAgentState(agentId);
    if (state) {
      state.status = status;
      state.lastActivity = nowIso();
      runtimeLogService.log({
        scope: 'app',
        namespace: 'agent',
        severity: status === 'error' ? 'error' : status === 'complete' ? 'success' : 'info',
        title: this.getAgentDisplayName(agentId),
        summary: `Status changed to ${status}.`,
        raw: {
          agentId,
          status,
        },
      });
      this.notifyAgentStateChanged(state);
    }
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

  private notifyAgentStateChanged(state: AgentState): void {
    workflowProjectionPublisher.publishAgentStatus(state);
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
