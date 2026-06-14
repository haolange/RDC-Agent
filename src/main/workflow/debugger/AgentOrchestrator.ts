/**
 * AgentOrchestrator — 把多个 AgentRole 映射到新 Agent Runtime 的
 * `Agent` 实例池。每个 AgentRole 持有一个 `Agent`，按需根据
 * 当前 settings/profile 重置 model 与 systemPrompt。
 *
 * 公共契约（不变）：
 *  - `sendMessage(agentId, content, runContext?, options?) → Promise<string>`
 *  - `sendProfileMessage(agentId, content, options?) -> Promise<string>`
 *  - `getAgentState`, `getAllAgentStates`, `configureAgent`, `applyLlmConfig`
 *  - 状态广播仍走 `WorkflowProjectionPublisher`，事件名不变。
 *
 * 内部实现：
 *  - 调用 `Agent.prompt()` 触发新循环；
 *  - 订阅核心 `AgentEvent`，通过 `AgentEventBridge` 翻译为共享 `AgentEvent`，
 *    供 ConversationService / agent-trace 等老 API 复用。
 */

import * as path from 'path';
import type {
  AgentCategory,
  AgentConfig,
  AgentId,
  AgentMessage,
  AgentRole,
  AgentState,
  WriteScope,
} from '@shared/types/agent';
import { isTopLevelAgentId } from '@shared/types/agent';
import {
  AGENT_CATEGORIES,
  AGENT_DESCRIPTIONS,
  AGENT_DISPLAY_NAMES,
  AGENT_ROLES,
  AGENT_WRITE_SCOPES,
  DEFAULT_MODEL_ROUTING,
} from '@shared/constants/agents';
import type { AgentEvent as SharedAgentEvent } from '@shared/types/agentRuntime';
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
import { createTaskTools, TaskRegistry } from '../../agent-runtime/tasks';
import {
  translateCoreToSharedAgentEvent,
  type AgentEventBridgeContext,
} from '../../agent-runtime/AgentEventBridge';
import { runtimeLogService } from '../../runtime/RuntimeLogService';
import { storageAdapter } from '../../sessions/StorageAdapter';
import { getRdxRuntimeContext } from '../../sessions/RdxRuntimeContextRegistry';
import { executionProfileService } from '../../settings/ExecutionProfileService';
import { agentRuntimeConfigService } from '../../settings/AgentRuntimeConfigService';
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
  onEvent?: (event: SharedAgentEvent) => void;
  reasoningBudget?: 'auto' | 'low' | 'medium' | 'high';
}

interface AgentProfileTurnOptions extends AgentTurnOptions {
  sessionId?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  turnId?: string;
  routeAgentId?: AgentRole;
  patternId?: string;
  stage?: WorkflowStage | 'report';
  /** Profile turn prompt that replaces the raw user message for this runtime call. */
  promptOverride?: string;
}

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

  private getAgentCategory(role: AgentRole): AgentCategory {
    return isTopLevelAgentId(role) ? AGENT_CATEGORIES[role] : 'general';
  }

  private getAgentWriteScopes(role: AgentRole): WriteScope[] {
    return isTopLevelAgentId(role) ? AGENT_WRITE_SCOPES[role] : ['workspace_notes'];
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
      const fallbackAgentId: AgentId = isTopLevelAgentId(agentId) ? agentId : 'debugger';
      const fallback = DEFAULT_MODEL_ROUTING[fallbackAgentId];
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
  // Main entry points: workflow run turn / profile turn.
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

  async sendProfileMessage(
    agentId: AgentRole,
    content: string,
    options?: AgentProfileTurnOptions,
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
        const finalStub = await this.createProfileTestResponse(agentId, content, options);
        this.updateAgentStatus(agentId, 'complete');
        return finalStub;
      }

      const userPrompt = options?.promptOverride ?? content;
      const toolAllowlist = resolveAgentToolAllowlist(agentId, options?.stage && options.stage !== 'report' ? options.stage : undefined);
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
        stage: options?.stage ?? 'investigate',
        runId: undefined,
        sessionId: options?.sessionId ?? null,
        turnId: options?.turnId,
        toolAllowlist,
        options,
        // A profile turn is isolated so previous cached chat state cannot leak into this user turn.
        useFreshAgent: true,
      });

      runtimeLogService.log({
        scope: options?.sessionId ? 'session' : 'app',
        namespace: 'agent',
        severity: 'info',
        title: `${AGENT_DISPLAY_NAMES[isTopLevelAgentId(agentId) ? agentId : 'debugger']} profile turn`,
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

  /** Create a fresh one-shot agent slot for an isolated profile turn. */
  private createFreshAgentSlot(
    providerId: string,
    modelId: string,
    systemPrompt: string,
    tools: ToolDefinition[] = [],
    toolExecutor = this.createToolExecutor('ask', [], undefined),
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
    stage?: WorkflowStage | 'report',
    sessionId?: string | null,
  ): ResolvedRuntimeTools {
    const availableTools = new Map<string, AgentTool>();
    for (const tool of getPrimitiveTools()) {
      availableTools.set(normalizeToolName(tool.name), tool);
    }
    for (const tool of this.createTaskRuntimeTools()) {
      availableTools.set(normalizeToolName(tool.name), tool);
    }
    const rdxContextTool = this.createRdxContextTool();
    availableTools.set(rdxContextTool.name, rdxContextTool);
    for (const tool of this.createWorkbenchTools(agentId, sessionId)) {
      availableTools.set(normalizeToolName(tool.name), tool);
    }

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
    stage?: WorkflowStage | 'report',
    sessionId?: string | null,
  ): ToolExecutor {
    const tools = this.resolveRuntimeTools(agentId, toolAllowlist, stage, sessionId).toolMap;
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
        const approvalRequired = tool.permissionHint === 'mutation' || tool.permissionHint === 'destructive';
        if (approvalRequired) {
          return this.createApprovalRequiredToolResult(toolCall, agentId, tool.permissionHint);
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
    stage?: WorkflowStage | 'report',
  ): boolean {
    const workflowStage = stage === 'report' ? undefined : stage;
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

  private createApprovalRequiredToolResult(
    toolCall: ToolCall,
    agentId: AgentRole,
    permissionHint: 'mutation' | 'destructive',
  ): ToolResultMessage {
    const operation = permissionHint === 'destructive' ? 'destructive operation' : 'workspace mutation';
    return {
      role: 'toolResult',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{
        type: 'text',
        text: `Approval required for tool "${toolCall.name}" before ${operation} can run for ${agentId}. No changes were made.`,
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

  private createTaskRuntimeTools(): AgentTool[] {
    const tasksDir = path.join(storageAdapter.getWorkspacePath(), '.tasks');
    return createTaskTools(new TaskRegistry(tasksDir));
  }

  private createRdxContextTool(): AgentTool<Record<string, never>, { available: boolean }> {
    return {
      name: 'rdx_context',
      label: 'RDX Context',
      description: 'Read the current stable RDX runtime context captured by configured shell actions.',
      parameters: {
        type: 'object',
        properties: {},
      },
      permissionHint: 'readonly',
      async execute() {
        const runtimeContext = getRdxRuntimeContext();
        if (!runtimeContext) {
          return {
            content: [{ type: 'text', text: 'No RDX runtime context is currently available.' }],
            details: { available: false },
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(runtimeContext, null, 2) }],
          details: { available: true },
        };
      },
    };
  }

  private createWorkbenchTools(agentId: AgentRole, sessionId?: string | null): AgentTool[] {
    return [
      this.createAskUserTool(agentId),
      this.createAgentHandoffTool(agentId),
      this.createMemoryReadTool(sessionId),
      this.createPlanArtifactTool(sessionId),
      this.createSkillsCatalogTool(),
      this.createMcpCatalogTool(),
    ];
  }

  private createAskUserTool(agentId: AgentRole): AgentTool<
    { question?: string; choices?: string[] },
    { agentId: AgentRole; question: string; choices: string[] }
  > {
    return {
      name: 'ask_user',
      label: 'Ask User',
      description: 'Ask the user for a decision or missing information. Use this when progress depends on user input.',
      parameters: {
        type: 'object',
        required: ['question'],
        properties: {
          question: { type: 'string', description: 'The concise question to ask the user.' },
          choices: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional short mutually exclusive choices.',
          },
        },
      },
      permissionHint: 'readonly',
      async execute(_toolCallId, args) {
        const question = typeof args.question === 'string' && args.question.trim()
          ? args.question.trim()
          : 'The agent needs user input before continuing.';
        const choices = Array.isArray(args.choices)
          ? args.choices.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          : [];
        const suffix = choices.length > 0 ? ` Choices: ${choices.join(' | ')}` : '';
        return {
          content: [{ type: 'text', text: `User input requested by ${agentId}: ${question}${suffix}` }],
          details: { agentId, question, choices },
        };
      },
    };
  }

  private createAgentHandoffTool(agentId: AgentRole): AgentTool<
    { agent?: string; label?: string; prompt?: string },
    { fromAgentId: AgentRole; toAgentId: string; label: string; prompt: string }
  > {
    return {
      name: 'agent_handoff',
      label: 'Agent Handoff',
      description: 'Prepare a handoff to another agent profile without executing it directly.',
      parameters: {
        type: 'object',
        required: ['prompt'],
        properties: {
          agent: { type: 'string', description: 'Target agent profile id, such as edit, debugger, analyzer, or optimizer.' },
          label: { type: 'string', description: 'Short handoff label.' },
          prompt: { type: 'string', description: 'Implementation or specialist prompt for the receiving agent.' },
        },
      },
      permissionHint: 'readonly',
      async execute(_toolCallId, args) {
        const toAgentId = typeof args.agent === 'string' && args.agent.trim() ? args.agent.trim() : 'edit';
        const label = typeof args.label === 'string' && args.label.trim() ? args.label.trim() : `Hand off to ${toAgentId}`;
        const prompt = typeof args.prompt === 'string' && args.prompt.trim()
          ? args.prompt.trim()
          : 'Continue from the current plan and ask for missing context before making changes.';
        return {
          content: [{
            type: 'text',
            text: `Handoff prepared from ${agentId} to ${toAgentId}: ${label}\n${prompt}`,
          }],
          details: { fromAgentId: agentId, toAgentId, label, prompt },
        };
      },
    };
  }

  private createPlanArtifactTool(sessionId?: string | null): AgentTool<
    { title?: string; content?: string },
    { sessionId: string | null; artifactPath?: string }
  > {
    return {
      name: 'plan_artifact',
      label: 'Write Plan Artifact',
      description: 'Write or replace the current session plan artifact. This cannot edit arbitrary workspace files.',
      parameters: {
        type: 'object',
        required: ['content'],
        properties: {
          title: { type: 'string', description: 'Optional plan title.' },
          content: { type: 'string', description: 'Plan content to persist for this session.' },
        },
      },
      permissionHint: 'session_mutation',
      async execute(_toolCallId, args) {
        if (!sessionId) {
          return {
            content: [{ type: 'text', text: 'No active session is available for a plan artifact.' }],
            isError: true,
            details: { sessionId: null },
          };
        }
        const body = typeof args.content === 'string' ? args.content.trim() : '';
        if (!body) {
          return {
            content: [{ type: 'text', text: 'Plan artifact content is required.' }],
            isError: true,
            details: { sessionId },
          };
        }
        const title = typeof args.title === 'string' && args.title.trim()
          ? args.title.trim()
          : 'Agent Plan';
        const artifactPath = storageAdapter.writeSessionPlanArtifact(sessionId, `# ${title}\n\n${body}\n`);
        return {
          content: [{ type: 'text', text: `Plan artifact saved: ${artifactPath}` }],
          details: { sessionId, artifactPath },
        };
      },
    };
  }

  private createMemoryReadTool(sessionId?: string | null): AgentTool<
    { query?: string; limit?: number },
    { sessionId: string | null; count: number }
  > {
    return {
      name: 'memory_read',
      label: 'Read Memory',
      description: 'Read recent session memory and conversation context without mutating persisted data.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional case-insensitive filter.' },
          limit: { type: 'number', description: 'Maximum recent entries to return, default 8.' },
        },
      },
      permissionHint: 'readonly',
      async execute(_toolCallId, args) {
        if (!sessionId) {
          return {
            content: [{ type: 'text', text: 'No active session memory is available for this turn.' }],
            details: { sessionId: null, count: 0 },
          };
        }
        const rawLimit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : 8;
        const limit = Math.max(1, Math.min(20, Math.floor(rawLimit)));
        const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
        const history = storageAdapter.readConversationHistory(sessionId);
        const candidates = query
          ? history.filter((entry) => entry.content.toLowerCase().includes(query))
          : history;
        const entries = candidates.slice(-limit).map((entry) => (
          `${entry.role}${entry.agentId ? `/${entry.agentId}` : ''}: ${entry.content.slice(0, 240)}`
        ));
        return {
          content: [{
            type: 'text',
            text: entries.length > 0 ? entries.join('\n') : 'No matching session memory entries were found.',
          }],
          details: { sessionId, count: entries.length },
        };
      },
    };
  }

  private createSkillsCatalogTool(): AgentTool<
    { query?: string },
    { count: number }
  > {
    return {
      name: 'skills',
      label: 'List Skills',
      description: 'List reusable skills configured for the current workspace.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional case-insensitive filter.' },
        },
      },
      permissionHint: 'readonly',
      async execute(_toolCallId, args) {
        const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
        const skills = agentRuntimeConfigService.listSkills()
          .filter((skill) => !query || `${skill.id} ${skill.name} ${skill.label} ${skill.description}`.toLowerCase().includes(query));
        const lines = skills.map((skill) => (
          `${skill.id}: ${skill.label || skill.name} (${skill.source})${skill.enabledByDefault ? '' : ' - disabled by default'}`
        ));
        return {
          content: [{ type: 'text', text: lines.length > 0 ? lines.join('\n') : 'No configured skills matched the query.' }],
          details: { count: skills.length },
        };
      },
    };
  }

  private createMcpCatalogTool(): AgentTool<
    { query?: string },
    { count: number }
  > {
    return {
      name: 'mcp',
      label: 'List MCP Services',
      description: 'List MCP services configured for the current workspace.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional case-insensitive filter.' },
        },
      },
      permissionHint: 'readonly',
      async execute(_toolCallId, args) {
        const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
        const servers = agentRuntimeConfigService.listMcpServers()
          .filter((server) => !query || `${server.id} ${server.name} ${server.description}`.toLowerCase().includes(query));
        const lines = servers.map((server) => (
          `${server.id}: ${server.name} (${server.transport})${server.enabledByDefault ? '' : ' - disabled by default'}`
        ));
        return {
          content: [{ type: 'text', text: lines.length > 0 ? lines.join('\n') : 'No configured MCP services matched the query.' }],
          details: { count: servers.length },
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
    stage?: WorkflowStage | 'report';
    runId?: string;
    sessionId?: string | null;
    turnId?: string;
    toolAllowlist: string[];
    options?: AgentTurnOptions;
    /** Creates a one-shot agent instance instead of reusing the cached slot. */
    useFreshAgent?: boolean;
  }): Promise<string> {
    if (!input.providerId || !input.modelId) {
      throw new Error('No provider/model route is configured for this agent.');
    }

    const runtimeTools = this.resolveRuntimeTools(input.agentId, input.toolAllowlist, input.stage, input.sessionId);
    const toolExecutor = this.createToolExecutor(input.agentId, input.toolAllowlist, input.stage, input.sessionId);
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

    const sharedEventContext: AgentEventBridgeContext = {
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
      const sharedEvent = translateCoreToSharedAgentEvent(event, sharedEventContext);
      if (sharedEvent) {
        input.options?.onEvent?.(sharedEvent);
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
    if (agentId === 'plan') {
      return 'ask';
    }
    return isTopLevelAgentId(agentId) ? agentId as AppMode : 'debugger';
  }

  private patternForAgent(_agentId: AgentRole): string {
    return 'free-agent';
  }

  private systemPromptForAgent(agentId: AgentRole, prompt?: string): string {
    const topLevelAgentId: AgentId = isTopLevelAgentId(agentId) ? agentId : 'debugger';
    return prompt || `You are the ${AGENT_DISPLAY_NAMES[topLevelAgentId]}. ${AGENT_DESCRIPTIONS[topLevelAgentId]}`;
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
        title: AGENT_DISPLAY_NAMES[isTopLevelAgentId(agentId) ? agentId : 'debugger'] || agentId,
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
      title: AGENT_DISPLAY_NAMES[isTopLevelAgentId(message.agentId) ? message.agentId : 'debugger'] || message.agentId,
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
    if (userMessage.includes('__RDC_AGENT_E2E_FORCE_LLM_FAILURE__')) {
      throw new Error('E2E forced profile LLM request failure');
    }
    const lower = userMessage.toLowerCase();
    let stub = agentId === 'ask'
      ? 'Ask is ready. I can inspect readonly context, search files or public pages, and explain next steps without starting a Debugger run.'
      : `${AGENT_DISPLAY_NAMES[isTopLevelAgentId(agentId) ? agentId : 'debugger']} is ready. Describe the goal and I can use the configured tools for this turn.`;
    if (/ue4|unreal/i.test(userMessage)) {
      stub = 'UE4 is Unreal Engine 4, commonly involved in graphics debugging around materials, post-processing, shaders, and render passes.';
    } else if (/hello|hi/i.test(userMessage)) {
      stub = agentId === 'ask'
        ? 'Hello. I can clarify the issue, explain capability boundaries, or guide you to open a .rdc capture without starting RenderDoc execution.'
        : 'Hello. I can run as a general executable agent using the tools enabled by this agent profile.';
    } else if (/start|execute|debug|analy[sz]e/.test(lower)) {
      stub = 'Received. I will handle this as a normal agent turn using the configured tools and runtime context.';
    }
    return stub;
  }

  private async createProfileTestResponse(
    agentId: AgentRole,
    content: string,
    options?: AgentProfileTurnOptions,
  ): Promise<string> {
    let userMessage = content;
    try {
      const parsed = JSON.parse(content) as { effective_user_message?: string; user_message?: string };
      userMessage = parsed.effective_user_message || parsed.user_message || content;
    } catch {
      userMessage = content;
    }
    if (userMessage.includes('__RDC_AGENT_E2E_FORCE_LLM_FAILURE__')) {
      throw new Error('E2E forced profile LLM request failure');
    }
    const lower = userMessage.toLowerCase();
    let stub = agentId === 'ask'
      ? 'I can inspect readonly context, search files or public pages, explain boundaries, or guide you to open a .rdc capture without starting a Debugger run.'
      : 'I can help scope the target and execute configured tools directly within this agent turn.';
    if (/ue4|unreal/i.test(userMessage)) {
      stub = 'UE4 is Unreal Engine 4. In RDC-Agent it is usually relevant to render pass, material, post-process, and shader debugging context.';
    } else if (/hello|hi|你好|您好/i.test(userMessage)) {
      stub = agentId === 'ask'
        ? 'Hello. I can clarify the issue, explain capability boundaries, or guide you to open a .rdc capture without starting RenderDoc execution.'
        : 'Hello. I can run as a general executable agent using the tools enabled by this agent profile.';
    } else if (/start|execute|debug|analy[sz]e/.test(lower)) {
      stub = 'Received. I will handle this as a normal agent turn using the configured tools and runtime context.';
    }
    if (agentId === 'ask' && userMessage.includes('__RDC_AGENT_E2E_ASK_READONLY_TOOL__')) {
      const toolCallId = generateEventId('e2e-tool');
      this.emitProfileTestEvent('tool.started', {
        toolCallId,
        toolName: 'grep',
        args: { pattern: 'ConversationService', path: 'src/main/conversation' },
      }, options);
      this.emitProfileTestEvent('tool.completed', {
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
    } else if (agentId === 'ask' && userMessage.includes('__RDC_AGENT_E2E_ASK_DENY_WRITE__')) {
      const toolCallId = generateEventId('e2e-tool');
      this.emitProfileTestEvent('tool.started', {
        toolCallId,
        toolName: 'write_file',
        args: { path: 'should-not-exist.txt' },
      }, options);
      this.emitProfileTestEvent('tool.denied', {
        toolCallId,
        toolName: 'write_file',
        reason: 'Policy denied: ask can only use readonly tools.',
        result: {
          ok: false,
          data: {},
          artifacts: [],
          error: {
            code: 'AGENT_TOOL_POLICY_DENIED',
            message: 'Policy denied: ask can only use readonly tools.',
            category: 'policy',
          },
          duration_ms: 1,
          trace_id: toolCallId,
        },
      }, options);
      stub = 'I cannot write files in Ask mode. Ask can inspect and search, but mutation requires the appropriate execution flow.';
    }

    const finalStub = stub;
    if (options?.onChunk) {
      const midpoint = Math.max(1, Math.ceil(finalStub.length / 2));
      options.onChunk(finalStub.slice(0, midpoint));
      await Promise.resolve();
      options.onChunk(finalStub.slice(midpoint));
    }
    return finalStub;
  }

  private emitProfileTestEvent(
    type: SharedAgentEvent['type'],
    payload: SharedAgentEvent['payload'],
    options?: AgentProfileTurnOptions,
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
