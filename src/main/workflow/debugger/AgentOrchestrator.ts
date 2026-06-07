/**
 * AgentOrchestrator — 把多个 AgentRole 映射到新 Agent Runtime 的
 * `Agent` 实例池。每个 AgentRole 持有一个 `Agent`，按需根据
 * 当前 settings/profile 重置 model 与 systemPrompt。
 *
 * 公共契约（不变）：
 *  - `sendMessage(agentId, content, runContext?, options?) → Promise<string>`
 *  - `sendCoworkMessage(agentId, content, options?) → Promise<string>`
 *  - `getAgentState`, `getAllAgentStates`, `configureAgent`, `applyLlmConfig`
 *  - 状态广播仍走 `WorkflowProjectionPublisher`，事件名不变。
 *
 * 内部实现：
 *  - 调用 `Agent.prompt()` 触发新循环；
 *  - 订阅核心 `AgentEvent`，通过 `LegacyEventBridge` 翻译为旧 `AgentEvent`，
 *    供 ConversationService / agent-trace 等老 API 复用。
 */

import type {
  AgentConfig,
  AgentMessage,
  AgentRole,
  AgentState,
  WriteScope,
} from '@shared/types/agent';
import {
  AGENT_DESCRIPTIONS,
  AGENT_DISPLAY_NAMES,
  AGENT_ROLES,
  DEFAULT_MODEL_ROUTING,
  INVESTIGATOR_AGENTS,
  REPORTER_AGENTS,
  VERIFIER_AGENTS,
} from '@shared/constants/agents';
import type { AgentEvent as LegacyAgentEvent } from '@shared/types/agentRuntime';
import type { LLMConfig, LLMStreamEvent } from '@shared/types/llm';
import type { AppMode } from '@shared/types/session';
import type { LlmProviderId } from '@shared/types/settings';
import type { WorkflowStage } from '@shared/types/workflow';
import { generateEventId, nowIso, nowMs } from '@shared/utils/id';
import { Agent } from '../../agent-runtime/agent/Agent';
import type { AgentTool, AgentToolResult } from '../../agent-runtime/agent/AgentTool';
import { toolToDefinition } from '../../agent-runtime/agent/AgentTool';
import type { ToolExecutor } from '../../agent-runtime/agent/AgentLoop';
import type {
  AgentEvent as CoreAgentEvent,
  StreamOptions,
  ToolCall,
  ToolDefinition,
  ToolResultMessage,
  UserMessage,
} from '../../agent-runtime/core/types';
import { getPrimitiveTools } from '../../agent-runtime/tools';
import {
  encodeAgentModel,
  llmAdapterProvider,
} from '../../agent-runtime/LLMAdapterProvider';
import {
  translateCoreToLegacy,
  type LegacyEventContext,
} from '../../agent-runtime/LegacyEventBridge';
import { runtimeLogService } from '../../runtime/RuntimeLogService';
import { storageAdapter } from '../../sessions/StorageAdapter';
import { executionProfileService } from '../../settings/ExecutionProfileService';
import { llmAdapter } from '../../settings/LLMAdapter';
import { providerAccountAuthService } from '../../settings/ProviderAccountAuthService';
import { settingsService } from '../../settings/SettingsService';
import { workflowProjectionPublisher } from './WorkflowProjectionPublisher';
import { isToolAllowedForAgent, normalizeToolName, resolveAgentToolAllowlist } from './DebuggerRuntimePolicy';

interface AgentTurnContext {
  caseId?: string;
  runId?: string;
  sessionId?: string;
  stageId?: WorkflowStage;
  turnId?: string;
}

interface AgentTurnOptions {
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
  onStreamEvent?: (event: LLMStreamEvent) => void;
  onEvent?: (event: LegacyAgentEvent) => void;
  reasoningBudget?: 'auto' | 'low' | 'medium' | 'high';
}

interface AgentCoworkOptions extends AgentTurnOptions {
  sessionId?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  turnId?: string;
  routeAgentId?: AgentRole;
  patternId?: string;
  stage?: WorkflowStage | 'cowork' | 'report';
  /** 用于 cowork 场景的特殊 prompt（替代 content 中的 user message）。 */
  promptOverride?: string;
}

const EXECUTE_PATTERN = /start|execute|debug|analy[sz]e|开始|启动|执行|正式分析|开始调试|调试/i;

/** 单个 AgentRole 在内部维护的运行态。 */
interface AgentSlot {
  agent: Agent;
  providerId: string;
  modelId: string;
  systemPrompt: string;
}

interface ResolvedRuntimeTools {
  definitions: ToolDefinition[];
  toolMap: Map<string, AgentTool>;
}

export class AgentOrchestrator {
  private agentStates: Map<AgentRole, AgentState> = new Map();
  private agentConfigs: Map<AgentRole, AgentConfig> = new Map();
  private agentSlots: Map<AgentRole, AgentSlot> = new Map();

  constructor() {
    this.initializeAgents();
  }

  setMainWindow(_window: unknown): void {
    // Renderer projection 由 WorkflowProjectionPublisher 拥有。
  }

  private initializeAgents(): void {
    for (const role of AGENT_ROLES) {
      this.agentStates.set(role, {
        agentId: role,
        status: 'idle',
        lastActivity: nowIso(),
      });

      const defaultRouting = DEFAULT_MODEL_ROUTING[role];
      this.agentConfigs.set(role, {
        agentId: role,
        systemPrompt: '',
        modelProvider: defaultRouting.provider,
        modelName: defaultRouting.model,
        temperature: 0.7,
        maxTokens: 4096,
        category: this.getAgentCategory(role),
        writeScope: this.getAgentWriteScopes(role),
      });
    }
  }

  private getAgentCategory(role: AgentRole): 'orchestrator' | 'investigator' | 'verifier' | 'reporter' {
    if (role === 'ask_agent' || role === 'rdc-debugger') return 'orchestrator';
    if (INVESTIGATOR_AGENTS.includes(role)) return 'investigator';
    if (VERIFIER_AGENTS.includes(role)) return 'verifier';
    if (REPORTER_AGENTS.includes(role)) return 'reporter';
    return 'investigator';
  }

  private getAgentWriteScopes(role: AgentRole): WriteScope[] {
    if (role === 'ask_agent') return [];
    if (role === 'rdc-debugger') return ['workspace_control'];
    if (INVESTIGATOR_AGENTS.includes(role)) return ['workspace_notes'];
    if (role === 'skeptic_agent') return ['session_signoff'];
    if (role === 'curator_agent') return ['workspace_reports', 'session_artifacts', 'knowledge_library'];
    return [];
  }

  getAgentState(agentId: AgentRole): AgentState | null {
    return this.agentStates.get(agentId) || null;
  }

  getAllAgentStates(): AgentState[] {
    return Array.from(this.agentStates.values());
  }

  configureAgent(agentId: AgentRole, config: Partial<AgentConfig>): void {
    const existing = this.agentConfigs.get(agentId);
    if (existing) {
      this.agentConfigs.set(agentId, { ...existing, ...config });
    }
  }

  getAgentConfig(agentId: AgentRole): AgentConfig | null {
    return this.agentConfigs.get(agentId) || null;
  }

  applyLlmConfig(config: LLMConfig): void {
    const routeMap = new Map(config.agentRoutes.map((route) => [route.agentId, route]));
    for (const [agentId, agentConfig] of this.agentConfigs.entries()) {
      const fallback = DEFAULT_MODEL_ROUTING[agentId];
      const route = routeMap.get(agentId);
      this.agentConfigs.set(agentId, {
        ...agentConfig,
        modelProvider: route ? route.providerId : fallback.provider,
        modelName: route ? route.modelId : fallback.model,
      });
    }
  }

  getToolsForRole(agentId: AgentRole): string[] {
    return resolveAgentToolAllowlist(agentId);
  }

  isToolAllowedForRole(toolName: string, agentId: AgentRole): boolean {
    return isToolAllowedForAgent(toolName, agentId);
  }

  // -------------------------------------------------------------------
  // 主入口：sendMessage / sendCoworkMessage
  // -------------------------------------------------------------------

  async sendMessage(
    agentId: AgentRole,
    content: string,
    context?: AgentTurnContext,
    options?: AgentTurnOptions,
  ): Promise<string> {
    const fallbackConfig = this.agentConfigs.get(agentId);
    if (!fallbackConfig) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    this.updateAgentStatus(agentId, 'thinking');

    try {
      let runtimeProfile = this.resolveRuntimeProfile(agentId, context?.stageId);
      await this.refreshAccountRuntimeCredentials(runtimeProfile.providerId);
      runtimeProfile = this.resolveRuntimeProfile(agentId, context?.stageId);
      const config: AgentConfig = {
        ...fallbackConfig,
        systemPrompt: runtimeProfile.systemPrompt,
        modelProvider: runtimeProfile.providerId,
        modelName: runtimeProfile.modelId,
        temperature: runtimeProfile.temperature ?? fallbackConfig.temperature,
        maxTokens: runtimeProfile.maxTokens ?? fallbackConfig.maxTokens,
      };
      const systemPrompt = this.systemPromptForAgent(agentId, config.systemPrompt);

      await this.recordMessage(agentId, 'user', content, context);

      const stub = this.createTestModeStub(agentId, content);
      const responseText = stub
        ? await this.streamTestModeStub(stub, options)
        : await this.runAgentTurn({
          agentId,
          content,
          systemPrompt,
          providerId: config.modelProvider,
          modelId: config.modelName,
          maxTokens: config.maxTokens,
          temperature: config.temperature,
          mode: this.modeForAgent(agentId),
          patternId: this.patternForAgent(agentId),
          stage: context?.stageId,
          runId: context?.runId,
          sessionId: context?.sessionId ?? null,
          turnId: context?.turnId,
          toolAllowlist: resolveAgentToolAllowlist(agentId, context?.stageId),
          options,
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
    }
  }

  async sendCoworkMessage(
    agentId: AgentRole,
    content: string,
    options?: AgentCoworkOptions,
  ): Promise<string> {
    const fallbackConfig = this.agentConfigs.get(agentId);
    if (!fallbackConfig) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    this.updateAgentStatus(agentId, 'thinking');

    try {
      let settings = settingsService.getAll();
      let routeMap = new Map(settings.llm.agentRoutes.map((route) => [route.agentId, route]));
      const routeAgentId = options?.routeAgentId ?? agentId;
      let route = routeMap.get(routeAgentId);
      if (route?.providerId) {
        await this.refreshAccountRuntimeCredentials(route.providerId);
        settings = settingsService.getAll();
        routeMap = new Map(settings.llm.agentRoutes.map((entry) => [entry.agentId, entry]));
        route = routeMap.get(routeAgentId);
      }
      const config: AgentConfig = {
        ...fallbackConfig,
        modelProvider: route?.providerId || fallbackConfig.modelProvider,
        modelName: route?.modelId || fallbackConfig.modelName,
        systemPrompt: options?.systemPrompt || fallbackConfig.systemPrompt,
        temperature: options?.temperature ?? fallbackConfig.temperature,
        maxTokens: options?.maxTokens ?? fallbackConfig.maxTokens,
      };

      if (process.env.RDC_AGENT_TEST_MODE === '1') {
        const finalStub = await this.createCoworkTestResponse(agentId, content, options);
        this.updateAgentStatus(agentId, 'complete');
        return finalStub;
      }

      const userPrompt = options?.promptOverride ?? content;
      const toolAllowlist = resolveAgentToolAllowlist(agentId, options?.stage && options.stage !== 'cowork' && options.stage !== 'report' ? options.stage : undefined);
      const responseText = await this.runAgentTurn({
        agentId,
        content: userPrompt,
        systemPrompt: this.systemPromptForAgent(agentId, config.systemPrompt),
        providerId: config.modelProvider,
        modelId: config.modelName,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        mode: this.modeForAgent(agentId),
        patternId: options?.patternId ?? this.patternForAgent(agentId),
        stage: options?.stage ?? 'cowork',
        runId: undefined,
        sessionId: options?.sessionId ?? null,
        turnId: options?.turnId,
        toolAllowlist,
        options,
        // cowork 每次调用都是独立轮次，不复用缓存 Agent。
        useFreshAgent: true,
      });

      runtimeLogService.log({
        scope: options?.sessionId ? 'session' : 'app',
        namespace: 'agent',
        severity: 'info',
        title: `${AGENT_DISPLAY_NAMES[agentId] || agentId} cowork turn`,
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
    }
  }

  // -------------------------------------------------------------------
  // Agent 实例池
  // -------------------------------------------------------------------

  private getOrCreateAgentSlot(
    agentId: AgentRole,
    providerId: string,
    modelId: string,
    systemPrompt: string,
    tools: ToolDefinition[] = [],
    toolExecutor = this.createToolExecutor(agentId, [], undefined),
    streamOptions?: StreamOptions,
  ): AgentSlot {
    const existing = this.agentSlots.get(agentId);
    if (
      existing
      && existing.providerId === providerId
      && existing.modelId === modelId
      && existing.systemPrompt === systemPrompt
      && !existing.agent.isStreaming
    ) {
      return existing;
    }

    const agent = new Agent({
      initialState: {
        model: encodeAgentModel(providerId, modelId),
        systemPrompt,
        tools,
        messages: [],
      },
      provider: llmAdapterProvider,
      toolExecutor,
      streamOptions,
      maxTurns: 8,
    });

    const slot: AgentSlot = { agent, providerId, modelId, systemPrompt };
    this.agentSlots.set(agentId, slot);
    return slot;
  }

  /** 创建一个全新的 Agent slot（不进入缓存）。适用于 cowork 这种一次性调用。 */
  private createFreshAgentSlot(
    providerId: string,
    modelId: string,
    systemPrompt: string,
    tools: ToolDefinition[] = [],
    toolExecutor = this.createToolExecutor('ask_agent', [], undefined),
    streamOptions?: StreamOptions,
  ): AgentSlot {
    const agent = new Agent({
      initialState: {
        model: encodeAgentModel(providerId, modelId),
        systemPrompt,
        tools,
        messages: [],
      },
      provider: llmAdapterProvider,
      toolExecutor,
      streamOptions,
      maxTurns: 4,
    });
    return { agent, providerId, modelId, systemPrompt };
  }

  private resolveRuntimeTools(
    agentId: AgentRole,
    toolAllowlist: string[],
    stage?: WorkflowStage | 'cowork' | 'report',
  ): ResolvedRuntimeTools {
    const availableTools = new Map<string, AgentTool>();
    for (const tool of getPrimitiveTools()) {
      availableTools.set(normalizeToolName(tool.name), tool);
    }
    const taskListTool = this.createReadonlyTaskListTool();
    availableTools.set(taskListTool.name, taskListTool);

    const definitions: ToolDefinition[] = [];
    const toolMap = new Map<string, AgentTool>();
    for (const name of toolAllowlist) {
      const normalized = normalizeToolName(name);
      const tool = availableTools.get(normalized);
      if (!tool) continue;
      if (!this.isAllowedForRuntime(agentId, tool.name, stage)) continue;
      if (!toolMap.has(tool.name)) {
        toolMap.set(tool.name, tool);
        definitions.push(toolToDefinition(tool));
      }
    }
    return { definitions, toolMap };
  }

  private createToolExecutor(
    agentId: AgentRole,
    toolAllowlist: string[],
    stage?: WorkflowStage | 'cowork' | 'report',
  ): ToolExecutor {
    const tools = this.resolveRuntimeTools(agentId, toolAllowlist, stage).toolMap;
    return {
      execute: async (toolCall: ToolCall, signal?: AbortSignal, onUpdate?: (partialResult: unknown) => void) => {
        const normalizedName = normalizeToolName(toolCall.name);
        if (!this.isAllowedForRuntime(agentId, toolCall.name, stage) || !tools.has(normalizedName)) {
          return this.createPolicyDeniedToolResult(toolCall, agentId);
        }
        const tool = tools.get(normalizedName);
        if (!tool) {
          return this.createPolicyDeniedToolResult(toolCall, agentId);
        }
        try {
          const result = await tool.execute(toolCall.id, toolCall.arguments, signal, onUpdate);
          return this.agentToolResultToMessage(toolCall, result);
        } catch (error) {
          return {
            role: 'toolResult',
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
            isError: true,
            timestamp: Date.now(),
          };
        }
      },
    };
  }

  private isAllowedForRuntime(
    agentId: AgentRole,
    toolName: string,
    stage?: WorkflowStage | 'cowork' | 'report',
  ): boolean {
    const workflowStage = stage === 'cowork' || stage === 'report' ? undefined : stage;
    return isToolAllowedForAgent(toolName, agentId, workflowStage);
  }

  private createPolicyDeniedToolResult(toolCall: ToolCall, agentId: AgentRole): ToolResultMessage {
    return {
      role: 'toolResult',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{
        type: 'text',
        text: `Policy denied tool "${toolCall.name}" for ${agentId}. Ask mode only allows read-only tools.`,
      }],
      isError: true,
      timestamp: Date.now(),
    };
  }

  private agentToolResultToMessage(toolCall: ToolCall, result: AgentToolResult): ToolResultMessage {
    return {
      role: 'toolResult',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: result.content,
      isError: result.isError === true,
      timestamp: Date.now(),
    };
  }

  private createReadonlyTaskListTool(): AgentTool<Record<string, never>, { count: number }> {
    return {
      name: 'task_list',
      label: 'List Tasks',
      description: 'List current conversation tasks without creating or modifying any task records.',
      parameters: {
        type: 'object',
        properties: {},
      },
      permissionHint: 'readonly',
      async execute() {
        return {
          content: [{ type: 'text', text: 'No formal Debugger run tasks are active in Ask mode.' }],
          details: { count: 0 },
        };
      },
    };
  }

  // -------------------------------------------------------------------
  // 单轮 Agent 执行
  // -------------------------------------------------------------------

  private async runAgentTurn(input: {
    agentId: AgentRole;
    content: string;
    systemPrompt: string;
    providerId: string;
    modelId: string;
    maxTokens?: number;
    temperature?: number;
    mode: AppMode;
    patternId: string;
    stage?: WorkflowStage | 'cowork' | 'report';
    runId?: string;
    sessionId?: string | null;
    turnId?: string;
    toolAllowlist: string[];
    options?: AgentTurnOptions;
    /** 为 true 时创建一次性 Agent 实例，不进入缓存（cowork 场景）。 */
    useFreshAgent?: boolean;
  }): Promise<string> {
    if (!input.providerId || !input.modelId) {
      throw new Error('No provider/model route is configured for this agent.');
    }

    const runtimeTools = this.resolveRuntimeTools(input.agentId, input.toolAllowlist, input.stage);
    const toolExecutor = this.createToolExecutor(input.agentId, input.toolAllowlist, input.stage);
    const streamOptions: StreamOptions = {
      maxTokens: input.maxTokens,
      temperature: input.temperature,
      reasoningBudget: input.options?.reasoningBudget,
      signal: input.options?.signal,
    };
    const slot = input.useFreshAgent
      ? this.createFreshAgentSlot(
          input.providerId,
          input.modelId,
          input.systemPrompt,
          runtimeTools.definitions,
          toolExecutor,
          streamOptions,
        )
      : this.getOrCreateAgentSlot(
          input.agentId,
          input.providerId,
          input.modelId,
          input.systemPrompt,
          runtimeTools.definitions,
          toolExecutor,
          streamOptions,
        );

    const userMessage: UserMessage = {
      role: 'user',
      content: input.content,
      timestamp: nowMs(),
    };

    const legacyContext: LegacyEventContext = {
      agentId: input.agentId,
      runId: input.runId,
      turnId: input.turnId,
      sessionId: input.sessionId ?? null,
      stage: input.stage,
      mode: input.mode,
      patternId: input.patternId,
      providerId: input.providerId,
      modelId: input.modelId,
      toolAllowlist: input.toolAllowlist,
    };

    let responseText = '';
    const unsubscribe = slot.agent.subscribe((event: CoreAgentEvent) => {
      if (event.type === 'message_update') {
        const ev = event.assistantMessageEvent;
        if (ev.type === 'text_delta' && typeof ev.delta === 'string') {
          input.options?.onChunk?.(ev.delta);
        }
      }
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        responseText = event.message.content
          .filter((block) => block.type === 'text')
          .map((block) => (block as { text: string }).text)
          .join('');
      }
      const legacyEvent = translateCoreToLegacy(event, legacyContext);
      if (legacyEvent) {
        input.options?.onEvent?.(legacyEvent);
      }
    });

    // abort 信号桥接到 Agent.abort()
    let abortListener: (() => void) | null = null;
    if (input.options?.signal) {
      if (input.options.signal.aborted) {
        unsubscribe();
        throw new DOMException('Aborted', 'AbortError');
      }
      abortListener = () => slot.agent.abort();
      input.options.signal.addEventListener('abort', abortListener, { once: true });
    }

    try {
      // Agent.prompt 内部跑完整循环；返回值是新增的全部消息，
      // 我们只在订阅里收集助手文本，最后返回 `responseText`。
      await slot.agent.prompt(userMessage);
      return responseText;
    } finally {
      unsubscribe();
      if (abortListener && input.options?.signal) {
        input.options.signal.removeEventListener('abort', abortListener);
      }
    }
  }

  private async streamTestModeStub(
    stub: string,
    options?: AgentTurnOptions,
  ): Promise<string> {
    const midpoint = Math.max(1, Math.ceil(stub.length / 2));
    const firstChunk = stub.slice(0, midpoint);
    const secondChunk = stub.slice(midpoint);
    if (firstChunk) {
      options?.onChunk?.(firstChunk);
      await Promise.resolve();
    }
    if (secondChunk) {
      options?.onChunk?.(secondChunk);
      await Promise.resolve();
    }
    return stub;
  }

  // -------------------------------------------------------------------
  // 辅助：profile / system prompt / status
  // -------------------------------------------------------------------

  private resolveRuntimeProfile(agentId: AgentRole, stage?: WorkflowStage) {
    const settings = settingsService.getAll();
    return executionProfileService.resolveAgentRuntimeProfile(settings, stage || 'investigate', agentId);
  }

  private async refreshAccountRuntimeCredentials(providerId: LlmProviderId): Promise<void> {
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
    if (provider?.authMode !== 'account') {
      return;
    }

    await providerAccountAuthService.ensureRuntimeCredentials(providerId);
    const llmConfig = settingsService.getLlmConfig();
    llmAdapter.configure(llmConfig);
    this.applyLlmConfig(llmConfig);
  }

  private modeForAgent(agentId: AgentRole): AppMode {
    return agentId === 'ask_agent' ? 'ask' : 'debugger';
  }

  private patternForAgent(agentId: AgentRole): string {
    return agentId === 'ask_agent' ? 'free-agent' : 'plan-generate-verify';
  }

  private systemPromptForAgent(agentId: AgentRole, prompt?: string): string {
    return prompt || `You are the ${AGENT_DISPLAY_NAMES[agentId]}. ${AGENT_DESCRIPTIONS[agentId]}`;
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
    const state = this.agentStates.get(agentId);
    if (state) {
      state.status = status;
      state.lastActivity = nowIso();
      runtimeLogService.log({
        scope: 'app',
        namespace: 'agent',
        severity: status === 'error' ? 'error' : status === 'complete' ? 'success' : 'info',
        title: AGENT_DISPLAY_NAMES[agentId] || agentId,
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
      title: AGENT_DISPLAY_NAMES[message.agentId] || message.agentId,
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

  // -------------------------------------------------------------------
  // 测试模式 / Stub
  // -------------------------------------------------------------------

  private createTestModeStub(agentId: AgentRole, content: string): string | null {
    if (process.env.RDC_AGENT_TEST_MODE !== '1') {
      return null;
    }
    let userMessage = content;
    try {
      const parsed = JSON.parse(content) as { effective_user_message?: string; user_message?: string };
      userMessage = parsed.effective_user_message || parsed.user_message || content;
    } catch {
      userMessage = content;
    }
    if (userMessage.includes('__RDC_AGENT_E2E_FORCE_COWORK_LLM_FAILURE__')) {
      throw new Error('E2E forced cowork LLM request failure');
    }
    const lower = userMessage.toLowerCase();
    let stub = agentId === 'ask_agent'
      ? 'Ask is ready. I can inspect readonly context, search files or public pages, and explain next steps without starting a Debugger run.'
      : 'Debugger is ready. Describe the symptom and capture context; I will prepare a plan before execution.';
    if (/ue4|unreal/i.test(userMessage)) {
      stub = 'UE4 is Unreal Engine 4, commonly involved in graphics debugging around materials, post-processing, shaders, and render passes.';
    } else if (/hello|hi/i.test(userMessage)) {
      stub = agentId === 'ask_agent'
        ? 'Hello. I can clarify the issue, explain capability boundaries, or guide you to open a .rdc capture without starting RenderDoc execution.'
        : 'Hello. In Debugger mode I will generate an execution plan first, then wait for approval before running the strict workflow.';
    } else if (/start|execute|debug|analy[sz]e/.test(lower)) {
      stub = 'Received. I will prepare the formal debugging plan first, then move into the strict execution flow only when conditions are met.';
    }
    const intent = /start|execute|debug|analy[sz]e/.test(lower) ? 'execute' : 'talk';
    return `${stub}\n<control>{"intent":"${intent}","safe_to_start":${intent === 'execute' ? 'true' : 'false'}}</control>`;
  }

  private async createCoworkTestResponse(
    agentId: AgentRole,
    content: string,
    options?: AgentCoworkOptions,
  ): Promise<string> {
    let userMessage = content;
    try {
      const parsed = JSON.parse(content) as { effective_user_message?: string; user_message?: string };
      userMessage = parsed.effective_user_message || parsed.user_message || content;
    } catch {
      userMessage = content;
    }
    if (userMessage.includes('__RDC_AGENT_E2E_FORCE_COWORK_LLM_FAILURE__')) {
      throw new Error('E2E forced cowork LLM request failure');
    }
    const lower = userMessage.toLowerCase();
    const wantsExecution = EXECUTE_PATTERN.test(userMessage);
    let stub = agentId === 'ask_agent'
      ? 'I can inspect readonly context, search files or public pages, explain boundaries, or guide you to open a .rdc capture without starting a Debugger run.'
      : 'I can help scope the debugging target, or prepare a formal Debugger plan when you are ready to execute.';
    if (/ue4|unreal/i.test(userMessage)) {
      stub = 'UE4 is Unreal Engine 4. In RDC-Agent it is usually relevant to render pass, material, post-process, and shader debugging context.';
    } else if (/hello|hi|你好|您好/i.test(userMessage)) {
      stub = agentId === 'ask_agent'
        ? 'Hello. I can clarify the issue, explain capability boundaries, or guide you to open a .rdc capture without starting RenderDoc execution.'
        : 'Hello. In Debugger mode I prepare an execution plan first, then wait for approval before running the debugging workflow.';
    } else if (wantsExecution || EXECUTE_PATTERN.test(lower)) {
      stub = 'Received. I will prepare the formal debugging plan first, then move into the strict execution flow only when conditions are met.';
    }
    if (agentId === 'ask_agent' && userMessage.includes('__RDC_AGENT_E2E_ASK_READONLY_TOOL__')) {
      const toolCallId = generateEventId('e2e-tool');
      this.emitCoworkTestEvent('tool.started', {
        toolCallId,
        toolName: 'grep',
        args: { pattern: 'ConversationService', path: 'src/main/conversation' },
      }, options);
      this.emitCoworkTestEvent('tool.completed', {
        toolCallId,
        toolName: 'grep',
        result: {
          ok: true,
          data: {
            content: [
              {
                type: 'text',
                text: 'src/main/conversation/ConversationService.ts: Ask readonly trace is visible.',
              },
            ],
          },
          artifacts: [],
          duration_ms: 1,
          trace_id: toolCallId,
        },
      }, options);
      stub = 'I searched the workspace with grep and found the Ask conversation code path. No Debugger run was created.';
    } else if (agentId === 'ask_agent' && userMessage.includes('__RDC_AGENT_E2E_ASK_DENY_WRITE__')) {
      const toolCallId = generateEventId('e2e-tool');
      this.emitCoworkTestEvent('tool.started', {
        toolCallId,
        toolName: 'write_file',
        args: { path: 'should-not-exist.txt' },
      }, options);
      this.emitCoworkTestEvent('tool.denied', {
        toolCallId,
        toolName: 'write_file',
        reason: 'Policy denied: ask_agent can only use readonly tools.',
        result: {
          ok: false,
          data: {},
          artifacts: [],
          error: {
            code: 'AGENT_TOOL_POLICY_DENIED',
            message: 'Policy denied: ask_agent can only use readonly tools.',
            category: 'policy',
          },
          duration_ms: 1,
          trace_id: toolCallId,
        },
      }, options);
      stub = 'I cannot write files in Ask mode. Ask can inspect and search, but mutation requires the appropriate execution flow.';
    }

    const finalStub = `${stub}\n<control>{"intent":"${wantsExecution ? 'execute' : 'talk'}","safe_to_start":${wantsExecution ? 'true' : 'false'}}</control>`;
    if (options?.onChunk) {
      const midpoint = Math.max(1, Math.ceil(finalStub.length / 2));
      options.onChunk(finalStub.slice(0, midpoint));
      await Promise.resolve();
      options.onChunk(finalStub.slice(midpoint));
    }
    return finalStub;
  }

  private emitCoworkTestEvent(
    type: LegacyAgentEvent['type'],
    payload: LegacyAgentEvent['payload'],
    options?: AgentCoworkOptions,
  ): void {
    options?.onEvent?.({
      id: generateEventId('agent-event'),
      type,
      timestamp: nowMs(),
      turnId: options.turnId,
      sessionId: options.sessionId ?? null,
      stage: options.stage,
      payload,
    });
  }
}

export const agentOrchestrator = new AgentOrchestrator();
