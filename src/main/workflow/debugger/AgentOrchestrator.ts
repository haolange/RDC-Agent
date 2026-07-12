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
import type {
  AgentEvent as SharedAgentEvent,
  AgentAssistantDeltaPayload,
  AgentRuntimeMcpDescriptor,
  AgentSubagentEventPayload,
} from '@shared/types/agentRuntime';
import type { MCPServerStatusSummary } from '@shared/types/mcp';
import type { LLMConfig } from '@shared/types/llm';
import type {
  ConversationTurnControls,
  ResolvedReasoningSelection,
} from '@shared/types/modelCapability';
import {
  CONTEXT_COMPACTION_RATIO,
  resolveActiveContextWindowTokens,
} from '@shared/types/modelCapability';
import type { AppMode, ContextUsageBreakdownEntry } from '@shared/types/session';
import type { LlmProviderId } from '@shared/types/settings';
import type { WorkflowStage } from '@shared/types/workflow';
import type { ConversationAskUserQuestion } from '@shared/types/conversation';
import type { HookEvent } from '@shared/types/rdxRuntime';
import type { PromptPlan } from '@shared/types/rdxRuntime';
import { normalizeAskUserQuestions } from '@shared/utils/askUser';
import { generateEventId, nowIso, nowMs } from '@shared/utils/id';
import { charsToTokens } from '@shared/utils/tokens';
import { Agent } from '../../agent-runtime/agent/Agent';
import { ContextManager } from '../../agent-runtime/agent/ContextManager';
import { requestEnvelopeBuilder, requestSnapshotStore } from '../../agent-runtime/prompt';
import { ErrorRecovery } from '../../agent-runtime/agent/ErrorRecovery';
import { handoffController } from '../../agent-runtime/agent/HandoffController';
import type { AgentTool, AgentToolResult, ToolExecutionContext } from '../../agent-runtime/agent/AgentTool';
import { toolToDefinition } from '../../agent-runtime/agent/AgentTool';
import type { ToolExecutor } from '../../agent-runtime/agent/AgentLoop';
import { getWorkspaceRoot } from '../../agent-runtime/tools/primitives/_shared';
import type {
  AgentEvent as CoreAgentEvent,
  StreamOptions,
  ToolCall,
  ToolDefinition,
  ToolResultMessage,
  UserMessage,
} from '../../agent-runtime/core/types';
import { createToolSearchTool, getPrimitiveTools } from '../../agent-runtime/tools';
import { MCPManager, type MCPServerConfig } from '../../agent-runtime/agent/MCPManager';
import {
  encodeAgentModel,
  configuredRuntimeProvider,
} from '../../agent-runtime/providers/ConfiguredRuntimeProvider';
import { MemoryStore } from '../../agent-runtime/memory/MemoryStore';
import {
  describeRouteCapabilityDiagnostic,
  resolveAgentRouteCapability,
} from '../../agent-runtime/capabilities/RouteCapabilityResolver';
import { createTaskTools, TaskRegistry, MemoryTaskStore, createSessionTaskStore } from '../../agent-runtime/tasks';
import {
  buildDiagnosticAgentEvent,
  mentionsTextualToolCall,
  translateCoreToSharedAgentEvent,
  type AgentEventBridgeContext,
} from '../../agent-runtime/AgentEventBridge';
import { agentUserInputRequestService } from '../../agent-runtime/interactions/AgentUserInputRequestService';
import { agentPermissionPolicyService } from '../../agent-runtime/permissions/AgentPermissionPolicy';
import { agentToolApprovalRequestService } from '../../agent-runtime/permissions/AgentToolApprovalRequestService';
import { withTemporaryPathAccess } from '../../agent-runtime/tools';
import { runtimeLogService } from '../../runtime/RuntimeLogService';
import { appPathService } from '../../runtime/AppPathService';
import { hookEngine } from '../../hooks/HookEngine';
import { storageAdapter } from '../../sessions/StorageAdapter';
import { getRdxRuntimeContext } from '../../sessions/RdxRuntimeContextRegistry';
import { executionProfileService } from '../../settings/ExecutionProfileService';
import { agentRuntimeConfigService } from '../../settings/AgentRuntimeConfigService';
import { llmAdapter } from '../../settings/LLMAdapter';
import { providerAccountAuthService } from '../../settings/ProviderAccountAuthService';
import { settingsService } from '../../settings/SettingsService';
import {
  resolveEffectiveModelId,
  resolveEffectiveTemperature,
  resolveModelCapability,
  resolveReasoningSelection,
  resolveTurnControls,
} from '../../settings/ModelCapabilityResolver';
import { debuggerLlmService } from '../../settings/DebuggerLlmService';
import { workflowProjectionPublisher } from './WorkflowProjectionPublisher';
import { isToolAllowedForAgent, normalizeToolName, resolveAgentToolAllowlist } from './DebuggerRuntimePolicy';

interface AgentTurnContext {
  runId?: string;
  sessionId?: string;
  stageId?: WorkflowStage;
  turnId?: string;
  projectRootPath?: string | null;
  projectId?: string | null;
}

interface AgentTurnOptions {
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
  onEvent?: (event: SharedAgentEvent) => void;
  reasoning?: ResolvedReasoningSelection;
  turnControls?: ConversationTurnControls;
}

interface AgentProfileTurnOptions extends AgentTurnOptions {
  sessionId?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  turnId?: string;
  routeAgentId?: AgentRole;
  stage?: WorkflowStage | 'report';
  /** 当前激活项目根目录，透传到工具执行上下文。 */
  projectRootPath?: string | null;
  /** 当前激活项目 id。 */
  projectId?: string | null;
  promptPlan?: PromptPlan;
}

/** 单个 AgentRole 在内部维护的运行态。 */
interface AgentSlot {
  agent: Agent;
  contextManager: ContextManager;
  providerId: string;
  modelId: string;
  systemPrompt: string;
  toolSignature: string;
  turnSignature: string;
  contextTokenLimit: number;
}

interface ResolvedRuntimeTools {
  definitions: ToolDefinition[];
  toolMap: Map<string, AgentTool>;
}

interface ToolExecutorRuntimeContext {
  sessionId?: string | null;
  turnId?: string;
  eventContext?: AgentEventBridgeContext;
  onEvent?: (event: SharedAgentEvent) => void;
  /** 当前激活项目根目录，用于把工具执行 base 对齐到 project root 而非 process.cwd()。 */
  projectRootPath?: string | null;
  /** 当前激活项目 id（审计/事件关联）。 */
  projectId?: string | null;
}

export class AgentOrchestrator {
  private agentStates: Map<AgentRole, AgentState> = new Map();
  private agentConfigs: Map<AgentRole, AgentConfig> = new Map();
  private agentSlots: Map<string, AgentSlot> = new Map();
  private readonly mcpManager = new MCPManager();
  private readonly connectedMcpServerIds = new Set<string>();
  private readonly failedMcpServers = new Map<string, string>();
  private activeMcpProjectRoot: string | null = null;
  /**
   * 当前 turn 的事件下沉（subagent 工具执行时读取，把子 agent 事件桥接到父 trace）。
   * 单进程串行，无并发问题；runAgentTurn 设置，turn 结束清理。
   */
  private currentTurnEventSink: {
    onEvent?: (event: SharedAgentEvent) => void;
    sessionId?: string | null;
    projectRootPath?: string | null;
    projectId?: string | null;
    agentId?: AgentRole;
  } | null = null;
  /**
   * 待处理的 handoff 请求（agent_handoff 工具成功时设置，
   * ConversationService turn 结束后 consume，实现 session 级 profile 切换）。
   */
  private pendingHandoff: {
    fromAgentId: AgentRole;
    toProfile: AgentRole;
    prompt: string;
    label: string;
    sessionId?: string | null;
  } | null = null;

  constructor() {
    this.initializeAgents();
  }

  private initializeAgents(): void {
    for (const role of AGENT_ROLES) {
      this.ensureAgentState(role);
      this.agentConfigs.set(role, this.createDefaultAgentConfig(role));
    }
  }

  private ensureAgentState(agentId: AgentRole): AgentState {
    const existing = this.agentStates.get(agentId);
    if (existing) {
      return existing;
    }
    const state: AgentState = {
      agentId,
      status: 'idle',
      lastActivity: nowIso(),
    };
    this.agentStates.set(agentId, state);
    return state;
  }

  private createDefaultAgentConfig(agentId: AgentRole): AgentConfig {
    const fallbackAgentId: AgentId = isTopLevelAgentId(agentId) ? agentId : 'edit';
    const defaultRouting = DEFAULT_MODEL_ROUTING[fallbackAgentId];
    return {
      agentId,
      systemPrompt: '',
      modelProvider: defaultRouting.provider,
      modelName: defaultRouting.model,
      temperature: 0.7,
      maxTokens: 4096,
      category: this.getAgentCategory(agentId),
      writeScope: this.getAgentWriteScopes(agentId),
    };
  }

  private getOrCreateAgentConfig(agentId: AgentRole): AgentConfig {
    this.ensureAgentState(agentId);
    const existing = this.agentConfigs.get(agentId);
    if (existing) {
      return existing;
    }
    const config = this.createDefaultAgentConfig(agentId);
    this.agentConfigs.set(agentId, config);
    return config;
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
    const existing = this.getOrCreateAgentConfig(agentId);
    this.agentConfigs.set(agentId, { ...existing, ...config });
  }

  getAgentConfig(agentId: AgentRole): AgentConfig | null {
    return this.agentConfigs.get(agentId) || null;
  }

  applyLlmConfig(config: LLMConfig): void {
    const routeMap = new Map(config.agentRoutes.map((route) => [route.agentId, route]));
    for (const [agentId, agentConfig] of this.agentConfigs.entries()) {
      const fallbackAgentId: AgentId = isTopLevelAgentId(agentId) ? agentId : 'edit';
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
    const fallbackConfig = this.getOrCreateAgentConfig(agentId);

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
      const settings = settingsService.getAll();
      const capability = resolveModelCapability(config.modelProvider, config.modelName, settings);
      const sessionRecord = context?.sessionId ? storageAdapter.readSession(context.sessionId) : null;
      const turnControls = resolveTurnControls(
        capability,
        options?.turnControls,
        sessionRecord?.turnControls,
      );
      const effectiveModelId = resolveEffectiveModelId(capability, turnControls);
      const activeContextWindow = resolveActiveContextWindowTokens(capability, turnControls);
      const contextTokenLimit = Math.floor(activeContextWindow * CONTEXT_COMPACTION_RATIO);
      const reasoning = options?.reasoning ?? resolveReasoningSelection(capability, turnControls);
      const responseText = stub
        ? await this.streamTestModeStub(stub, options)
        : await this.runAgentTurn({
          agentId,
          content,
          systemPrompt,
          providerId: config.modelProvider,
          modelId: effectiveModelId,
          maxTokens: config.maxTokens,
          temperature: config.temperature,
          mode: this.modeForAgent(agentId),
          stage: context?.stageId,
          runId: context?.runId,
          sessionId: context?.sessionId ?? null,
          turnId: context?.turnId,
          toolAllowlist: resolveAgentToolAllowlist(agentId, context?.stageId),
          options: {
            ...options,
            reasoning,
          },
          projectRootPath: context?.projectRootPath ?? null,
          projectId: context?.projectId ?? null,
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
    }
  }

  async sendProfileMessage(
    agentId: AgentRole,
    content: string,
    options?: AgentProfileTurnOptions,
  ): Promise<string> {
    const fallbackConfig = this.getOrCreateAgentConfig(agentId);

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

      const toolAllowlist = resolveAgentToolAllowlist(agentId, options?.stage && options.stage !== 'report' ? options.stage : undefined);
      const routeProviderId = config.modelProvider;
      const routeModelId = config.modelName;
      const capability = resolveModelCapability(routeProviderId, routeModelId, settings);
      const turnControls = resolveTurnControls(
        capability,
        options?.turnControls,
        options?.sessionId ? storageAdapter.readSession(options.sessionId)?.turnControls : undefined,
      );
      const effectiveModelId = resolveEffectiveModelId(capability, turnControls);
      const activeContextWindow = resolveActiveContextWindowTokens(capability, turnControls);
      const contextTokenLimit = Math.floor(activeContextWindow * CONTEXT_COMPACTION_RATIO);
      const reasoning = options?.reasoning ?? resolveReasoningSelection(capability, turnControls);

      const responseText = await this.runAgentTurn({
        agentId,
        content,
        systemPrompt: this.systemPromptForAgent(agentId, config.systemPrompt),
        providerId: routeProviderId,
        modelId: effectiveModelId,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        mode: this.modeForAgent(agentId),
        stage: options?.stage ?? 'investigate',
        runId: undefined,
        sessionId: options?.sessionId ?? null,
        turnId: options?.turnId,
        toolAllowlist,
        options: {
          ...options,
          reasoning,
        },
        projectRootPath: options?.projectRootPath ?? null,
        projectId: options?.projectId ?? null,
        promptPlan: options?.promptPlan,
        contextWindow: activeContextWindow,
        contextTokenLimit,
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
    }
  }

  // -------------------------------------------------------------------
  // Subagent（串行派生隔离 Context）
  // -------------------------------------------------------------------

  /**
   * 派生子 agent 执行任务（串行，父阻塞等待）。
   *
   * 对标 claude-code AgentTool：独立 context/message thread、filtered tools、
   * 独立 permission context。子 agent 事件桥接为 `subagent.*` 事件上抛父 trace。
   * 结果回传 = 函数返回值（不用 mailbox/队列）。
   *
   * @returns 子 agent 最终 assistant 文本。
   */
  async runSubagent(input: {
    parentAgentId: AgentRole;
    parentToolCallId: string;
    targetProfile: AgentRole;
    task: string;
    parentSessionId?: string | null;
    parentOnEvent?: (event: SharedAgentEvent) => void;
    projectRootPath?: string | null;
    projectId?: string | null;
  }): Promise<string> {
    const subagentId = generateEventId('subagent');
    // 子 agent 用独立 sessionId 段隔离 context/messages（不污染父线程持久化）。
    const subagentSessionId = input.parentSessionId
      ? `${input.parentSessionId}::subagent::${subagentId}`
      : null;

    // 通知父 trace：子 agent 启动
    input.parentOnEvent?.({
      id: generateEventId('agent-event'),
      type: 'subagent.started',
      timestamp: nowMs(),
      sessionId: input.parentSessionId ?? null,
      agentId: input.parentAgentId,
      payload: {
        subagentId,
        profile: input.targetProfile,
        parentToolCallId: input.parentToolCallId,
        text: input.task,
      } satisfies AgentSubagentEventPayload,
    });

    // 组装子 agent system prompt（目标 profile instructions）
    const definition = settingsService.getAll().agents.definitions
      .find((d) => d.id === input.targetProfile && d.enabled);
    const systemPrompt = definition?.instructions?.trim()
      || this.systemPromptForAgent(input.targetProfile);

    let resultText = '';
    let resultStatus: 'complete' | 'failed' | 'cancelled' = 'complete';

    try {
      resultText = await this.sendProfileMessage(
        input.targetProfile,
        input.task,
        {
          sessionId: subagentSessionId ?? undefined,
          stage: 'investigate',
          projectRootPath: input.projectRootPath,
          projectId: input.projectId,
          systemPrompt,
          onEvent: (event: SharedAgentEvent) => {
            const basePayload = {
              subagentId,
              profile: input.targetProfile,
              parentToolCallId: input.parentToolCallId,
            } satisfies Pick<AgentSubagentEventPayload, 'subagentId' | 'profile' | 'parentToolCallId'>;

            if (event.type === 'assistant.delta') {
              const delta = event.payload as AgentAssistantDeltaPayload;
              if (delta.text) {
                input.parentOnEvent?.({
                  id: generateEventId('agent-event'),
                  type: 'subagent.delta',
                  timestamp: nowMs(),
                  sessionId: input.parentSessionId ?? null,
                  agentId: input.parentAgentId,
                  payload: {
                    ...basePayload,
                    text: delta.text,
                  } satisfies AgentSubagentEventPayload,
                });
              }
              return;
            }

            if (event.type === 'tool.started') {
              const payload = event.payload as { toolCallId?: string; toolName?: string };
              input.parentOnEvent?.({
                id: generateEventId('agent-event'),
                type: 'subagent.delta',
                timestamp: nowMs(),
                sessionId: input.parentSessionId ?? null,
                agentId: input.parentAgentId,
                payload: {
                  ...basePayload,
                  child: {
                    id: String(payload.toolCallId ?? generateEventId('subagent-tool')),
                    kind: 'tool',
                    title: payload.toolName ? `Tool: ${payload.toolName}` : 'Tool',
                    status: 'running',
                    toolName: payload.toolName,
                  },
                } satisfies AgentSubagentEventPayload,
              });
              return;
            }

            if (event.type === 'tool.completed' || event.type === 'tool.denied') {
              const payload = event.payload as {
                toolCallId?: string;
                toolName?: string;
                result?: { ok?: boolean; error?: { message?: string } };
                reason?: string;
              };
              const failed = event.type === 'tool.denied' || payload.result?.ok === false;
              const summary = failed
                ? (payload.reason || payload.result?.error?.message || 'Tool failed')
                : 'Tool completed';
              input.parentOnEvent?.({
                id: generateEventId('agent-event'),
                type: 'subagent.delta',
                timestamp: nowMs(),
                sessionId: input.parentSessionId ?? null,
                agentId: input.parentAgentId,
                payload: {
                  ...basePayload,
                  child: {
                    id: String(payload.toolCallId ?? generateEventId('subagent-tool')),
                    kind: 'tool',
                    title: payload.toolName ? `Tool: ${payload.toolName}` : 'Tool',
                    status: failed ? 'error' : 'complete',
                    toolName: payload.toolName,
                    summary,
                  },
                } satisfies AgentSubagentEventPayload,
              });
            }
          },
        },
      );
    } catch (error) {
      resultStatus = 'failed';
      resultText = error instanceof Error ? error.message : String(error);
    }

    // 通知父 trace：子 agent 完成
    input.parentOnEvent?.({
      id: generateEventId('agent-event'),
      type: 'subagent.completed',
      timestamp: nowMs(),
      sessionId: input.parentSessionId ?? null,
      agentId: input.parentAgentId,
      payload: {
        subagentId,
        profile: input.targetProfile,
        parentToolCallId: input.parentToolCallId,
        text: resultText,
        status: resultStatus,
      } satisfies AgentSubagentEventPayload,
    });

    return resultText;
  }

  /**
   * 创建 subagent 工具（task / agent），注入父 agent 工具集。
   *
   * - `task`：派生通用 explore 子 agent（对标 claude-code Task 工具）。
   * - `agent`：按指定 profile 派生子 agent。
   */
  createSubagentTools(parentAgentId: AgentRole, sessionId?: string | null): AgentTool[] {
    const orchestrator = this;
    const runSubagentTool: AgentTool<
      { task: string; profile?: string },
      { subagentId: string; profile: string; status: string }
    > = {
      name: 'subagent',
      label: 'Subagent',
      description: 'Delegate a sub-task to an isolated sub-agent. The sub-agent runs to completion (serial, not parallel) and returns its final answer. Use profile to target a specific agent profile (defaults to "ask" read-only).',
      parameters: {
        type: 'object',
        required: ['task'],
        properties: {
          task: { type: 'string', description: 'The task description for the sub-agent.' },
          profile: { type: 'string', description: 'Target profile id. Defaults to "ask" (read-only).' },
        },
      },
      permissionHint: 'readonly',
      async execute(toolCallId, args, _signal) {
        const targetProfile = (typeof args.profile === 'string' && args.profile.trim() ? args.profile.trim() : 'ask') as AgentRole;
        const result = await orchestrator.runSubagent({
          parentAgentId,
          parentToolCallId: toolCallId,
          targetProfile,
          task: args.task,
          parentSessionId: sessionId ?? null,
          parentOnEvent: orchestrator.currentTurnEventSink?.onEvent,
          projectRootPath: orchestrator.currentTurnEventSink?.projectRootPath ?? null,
          projectId: orchestrator.currentTurnEventSink?.projectId ?? null,
        });
        return {
          content: [{ type: 'text', text: result || '(sub-agent returned empty output)' }],
          details: { subagentId: toolCallId, profile: targetProfile, status: 'complete' },
        };
      },
    };

    return [runSubagentTool];
  }

  private getOrCreateAgentSlot(
    agentId: AgentRole,
    providerId: string,
    modelId: string,
    systemPrompt: string,
    tools: ToolDefinition[] = [],
    toolExecutor = this.createToolExecutor(agentId, [], undefined),
    streamOptions?: StreamOptions,
    turnSignature = '',
    sessionId?: string | null,
    contextWindow?: number,
    contextTokenLimit?: number,
    promptPlan?: PromptPlan,
  ): AgentSlot {
    const slotKey = this.agentSlotKey(sessionId, agentId);
    const toolSignature = this.createToolSignature(tools);
    const resolvedContextTokenLimit = contextTokenLimit
      ?? Math.floor((contextWindow ?? 256_000) * CONTEXT_COMPACTION_RATIO);
    const existing = this.agentSlots.get(slotKey);
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
      return existing;
    }

    // 长生命周期 Agent：首次创建时从持久化线程回填历史 messages，
    // 使 Agent 跨轮记忆真实工具调用，重开 session 可完整续接。
    const persistedMessages = sessionId
      ? storageAdapter.readAgentThread(sessionId, agentId)
      : [];

    const agentModel = encodeAgentModel(providerId, modelId, { contextWindow });
    const routeProvider = settingsService.getAll().llm.providers.find((provider) => provider.id === providerId);
    const reasoningContract = resolveAgentRouteCapability(
      routeProvider,
      modelId,
    ).reasoningContract;

    const contextManager = new ContextManager({
      modelId,
      contextTokenLimit: resolvedContextTokenLimit,
      toolResultBudget: 200 * 1024,
      keepRecentToolResults: 3,
    });

    // ErrorRecovery：错误分类与恢复策略（retry/escalate_tokens/reactive_compact/continue/abort）。
    // fallbackModel 暂省略（无 settings route fallback 配置时只做非 switch 恢复）。
    const errorRecovery = new ErrorRecovery({ primaryModel: agentModel });

    const agent = new Agent({
      initialState: {
        model: agentModel,
        systemPrompt,
        tools,
        messages: persistedMessages,
      },
      provider: configuredRuntimeProvider,
      toolExecutor,
      streamOptions,
      maxTurns: this.resolveMaxTurns(agentId),
      // transformContext：长对话接近窗口上限时自动压缩历史。
      transformContext: (messages) => contextManager.compress(messages, agentModel),
      // errorRecovery：provider 错误后自动恢复（重试/提额/压缩/中止）。
      errorRecovery,
      onRequest: promptPlan ? ({ model, context: requestContext, streamOptions: requestOptions }) => {
        const callIndex = requestSnapshotStore.nextCallIndex(sessionId ?? undefined, turnSignature || undefined);
        const snapshot = requestEnvelopeBuilder.build({
          promptPlan,
          sessionId: sessionId ?? undefined,
          turnId: turnSignature || undefined,
          callIndex,
          route: { providerId, modelId, protocol: routeProvider?.protocol ?? model.api },
          messages: requestContext.messages,
          tools: requestContext.tools ?? [],
          controls: {
            temperature: requestOptions.temperature,
            maxTokens: requestOptions.maxTokens,
            topP: requestOptions.topP,
            reasoningSelection: requestOptions.reasoning?.selection,
          },
          reasoning: reasoningContract,
        });
        requestSnapshotStore.write(snapshot);
        return snapshot.id;
      } : undefined,
      onResponse: promptPlan ? (requestId, message) => {
        if (!requestId) return;
        requestSnapshotStore.complete(requestId, sessionId ?? undefined, turnSignature || undefined, {
          inputTokens: message.usage.inputTokens,
          outputTokens: message.usage.outputTokens,
          estimated: false,
        });
      } : undefined,
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
    };
    this.agentSlots.set(slotKey, slot);
    return slot;
  }

  /** 复合 slot key：`${sessionId}::${agentId}`，使 Agent 按 session+profile 隔离。 */
  private agentSlotKey(sessionId: string | null | undefined, agentId: AgentRole): string {
    return sessionId ? `${sessionId}::${agentId}` : `__no_session__::${agentId}`;
  }

  /**
   * Drop in-memory agent slots for a session so the next turn reloads from
   * the (possibly truncated) persisted agent-thread after a branch rewrite.
   */
  invalidateSessionAgentSlots(sessionId: string): void {
    const prefix = `${sessionId}::`;
    for (const key of Array.from(this.agentSlots.keys())) {
      if (key.startsWith(prefix)) {
        this.agentSlots.delete(key);
      }
    }
  }

  /**
   * 解析 Agent 的工具执行轮数上限。
   *
   * 优先用 `.agent.md` frontmatter 的 `max-turns`；
   * 未配置时按 profile 默认：edit/debugger/optimizer=50，ask/plan/analyzer=25。
   */
  private resolveMaxTurns(agentId: AgentRole): number {
    const manifest = settingsService.getAll().agents.definitions
      .find((definition) => definition.id === agentId && definition.enabled);
    if (manifest?.maxTurns && manifest.maxTurns > 0) {
      return manifest.maxTurns;
    }
    if (agentId === 'edit' || agentId === 'debugger' || agentId === 'optimizer') {
      return 50;
    }
    return 25;
  }

  private getMemoryStore(scope: 'user' | 'project', projectRootPath?: string | null): MemoryStore {
    if (scope === 'project') {
      if (!projectRootPath) throw new Error('Project scope memory requires an active project.');
      return new MemoryStore(appPathService.getProjectRdxPaths(projectRootPath).memoryPath);
    }
    return new MemoryStore(appPathService.getUserRdxPaths().memoryPath);
  }

  /** Memory 面板用：列出全部记忆摘要。 */
  async listMemoriesForUi(): Promise<Array<{ name: string; description: string; type: string; updatedAt: number }>> {
    try {
      const all = await this.getMemoryStore('user').listMemories();
      return all.map((m) => ({ name: m.name, description: m.description, type: m.type, updatedAt: m.updatedAt }));
    } catch {
      return [];
    }
  }

  /** Memory 面板用：读取单条记忆详情。 */
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

  /** Memory 面板用：写入记忆。 */
  async writeMemoryForUi(request: { name: string; description: string; type: 'user' | 'feedback' | 'project' | 'reference'; content: string; tags?: string[] }): Promise<{ success: boolean; name: string; error?: string }> {
    try {
      const record = await this.getMemoryStore('user').writeMemory(request);
      return { success: true, name: record.name };
    } catch (error) {
      return { success: false, name: request.name, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Memory 面板用：删除记忆。 */
  async deleteMemoryForUi(name: string): Promise<{ success: boolean; error?: string }> {
    try {
      const deleted = await this.getMemoryStore('user').deleteMemory(name);
      return { success: deleted };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * 消费待处理的 handoff 请求（agent_handoff 工具成功时设置）。
   *
   * ConversationService 在 profile turn 完成后调用：若有 pendingHandoff，
   * emit handoff.requested 事件 + 持久化到 session，下次消息自动用新 profile。
   * 读取后清除（一次性消费）。
   */
  consumePendingHandoff(): {
    fromAgentId: AgentRole;
    toProfile: AgentRole;
    prompt: string;
    label: string;
    sessionId?: string | null;
  } | null {
    const handoff = this.pendingHandoff;
    this.pendingHandoff = null;
    return handoff;
  }

  private createToolSignature(tools: ToolDefinition[]): string {
    return tools.map((tool) => tool.name).sort().join('|');
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
    for (const tool of this.mcpManager.getAgentTools()) {
      availableTools.set(normalizeToolName(tool.name), tool);
    }
    const toolSearchTool = createToolSearchTool(() => Array.from(availableTools.values()));
    availableTools.set(normalizeToolName(toolSearchTool.name), toolSearchTool);

    const definitions: ToolDefinition[] = [];
    const toolMap = new Map<string, AgentTool>();
    for (const tool of availableTools.values()) {
      if (!this.matchesToolAllowlist(tool.name, toolAllowlist)) continue;
      if (!this.isAllowedForRuntime(agentId, tool.name, stage)) continue;
      const normalized = normalizeToolName(tool.name);
      if (!toolMap.has(normalized)) {
        toolMap.set(normalized, tool);
        definitions.push(toolToDefinition(tool));
      }
    }
    return { definitions, toolMap };
  }

  private matchesToolAllowlist(toolName: string, toolAllowlist: string[]): boolean {
    const normalizedToolName = normalizeToolName(toolName);
    return toolAllowlist.some((entry) => {
      const normalizedEntry = normalizeToolName(entry);
      if (normalizedEntry === '*' || normalizedEntry === normalizedToolName) {
        return true;
      }
      if (normalizedEntry.endsWith('.*') && normalizedToolName.startsWith(normalizedEntry.slice(0, -1))) {
        return true;
      }
      if (normalizedEntry.endsWith('*') && normalizedToolName.startsWith(normalizedEntry.slice(0, -1))) {
        return true;
      }
      return false;
    });
  }

  private createToolExecutor(
    agentId: AgentRole,
    toolAllowlist: string[],
    stage?: WorkflowStage | 'report',
    sessionId?: string | null,
    runtimeContext?: ToolExecutorRuntimeContext,
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
        if (normalizedName === 'ask_user') {
          return this.executeAskUserTool(toolCall, agentId, runtimeContext, signal);
        }
        const permissionDecision = agentPermissionPolicyService.evaluate({ tool, toolCall, projectRootPath: runtimeContext?.projectRootPath ?? null });
        if (permissionDecision.action === 'deny') {
          return this.createPolicyDeniedToolResult(toolCall, agentId, permissionDecision.reason);
        }
        if (permissionDecision.action === 'ask_user') {
          if (!runtimeContext?.eventContext || !runtimeContext.turnId) {
            return this.createApprovalRequiredToolResult(toolCall, agentId, permissionDecision.reason ?? 'Tool approval requires an active conversation turn.');
          }
          const approved = await agentToolApprovalRequestService.request({
            agentId,
            sessionId: runtimeContext.sessionId ?? null,
            turnId: runtimeContext.turnId,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            reason: permissionDecision.reason ?? `Tool "${toolCall.name}" requires approval.`,
            risk: permissionDecision.risk,
            context: runtimeContext.eventContext,
            onEvent: runtimeContext.onEvent,
            signal,
          });
          if (!approved) {
            return this.createPolicyDeniedToolResult(toolCall, agentId, 'User denied this tool call.');
          }
        }
        if (permissionDecision.action === 'auto_review') {
          if (!runtimeContext?.eventContext || !runtimeContext.turnId) {
            return this.createPolicyDeniedToolResult(toolCall, agentId, 'Auto-review requires an active conversation turn.');
          }
          const approved = agentToolApprovalRequestService.autoReview({
            agentId,
            sessionId: runtimeContext.sessionId ?? null,
            turnId: runtimeContext.turnId,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            reason: permissionDecision.reason ?? `Tool "${toolCall.name}" requires review.`,
            risk: permissionDecision.risk,
            context: runtimeContext.eventContext,
            onEvent: runtimeContext.onEvent,
            signal,
          });
          if (!approved) {
            return this.createPolicyDeniedToolResult(toolCall, agentId, 'Auto-review denied this tool call.');
          }
        }
        try {
          const projectRootPath = runtimeContext?.projectRootPath ?? null;
          const beforeHooksAllowed = await this.triggerRuntimeHooks('tool.before-call', agentId, runtimeContext, {
            toolName: toolCall.name,
            toolCallId: toolCall.id,
            arguments: toolCall.arguments,
          });
          if (!beforeHooksAllowed) {
            return this.createPolicyDeniedToolResult(toolCall, agentId, 'A blocking lifecycle hook denied this tool call.');
          }
          const toolContext: ToolExecutionContext = {
            workspaceRoot: projectRootPath ?? getWorkspaceRoot(),
            projectRootPath,
            projectId: runtimeContext?.projectId ?? null,
            sessionId: runtimeContext?.sessionId ?? null,
          };
          const result = await withTemporaryPathAccess(
            permissionDecision.temporaryPathRoots,
            () => tool.execute(toolCall.id, toolCall.arguments, signal, onUpdate, toolContext),
          );
          await this.triggerRuntimeHooks('tool.after-call', agentId, runtimeContext, {
            toolName: toolCall.name,
            toolCallId: toolCall.id,
            isError: result.isError === true,
          });
          return this.agentToolResultToMessage(toolCall, result);
        } catch (error) {
          await this.triggerRuntimeHooks('tool.on-error', agentId, runtimeContext, {
            toolName: toolCall.name,
            toolCallId: toolCall.id,
            error: error instanceof Error ? error.message : String(error),
          });
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

  private async triggerRuntimeHooks(
    event: HookEvent,
    agentId: AgentRole,
    runtimeContext: ToolExecutorRuntimeContext | undefined,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const projectRoot = runtimeContext?.projectRootPath ?? undefined;
    hookEngine.load(appPathService.getUserRdxPaths().hooksPath, projectRoot ?? undefined);
    const results = await hookEngine.trigger(event, {
      event,
      agentId,
      toolName: typeof payload.toolName === 'string' ? payload.toolName : undefined,
      sessionId: runtimeContext?.sessionId ?? undefined,
      projectRoot: projectRoot ?? undefined,
      payload,
    });
    for (const result of results) {
      if (!runtimeContext?.eventContext || !runtimeContext.onEvent) continue;
      runtimeContext.onEvent(buildDiagnosticAgentEvent(runtimeContext.eventContext, {
        code: `hook.${result.status}`,
        severity: result.status === 'completed' ? 'info' : result.allowed ? 'warning' : 'error',
        message: `Hook ${result.hookId}: ${result.status}`,
        technicalMessage: JSON.stringify({
          exitCode: result.exitCode,
          reason: result.reason,
          stdout: result.stdout,
          stderr: result.stderr,
        }),
      }));
    }
    return results.every((result) => result.allowed);
  }

  private isAllowedForRuntime(
    agentId: AgentRole,
    toolName: string,
    stage?: WorkflowStage | 'report',
  ): boolean {
    const workflowStage = stage === 'report' ? undefined : stage;
    return isToolAllowedForAgent(toolName, agentId, workflowStage);
  }

  private async executeAskUserTool(
    toolCall: ToolCall,
    agentId: AgentRole,
    runtimeContext: ToolExecutorRuntimeContext | undefined,
    signal?: AbortSignal,
  ): Promise<ToolResultMessage> {
    try {
      const args = toolCall.arguments ?? {};
      const questions = normalizeAskUserQuestions(args);
      if (questions.length === 0) {
        throw new Error('ask_user requires at least one canonical questions[] entry with a prompt.');
      }

      if (!runtimeContext?.eventContext || !runtimeContext.turnId) {
        throw new Error('ask_user requires an active conversation interaction bridge.');
      }

      const answer = await agentUserInputRequestService.request({
        agentId,
        sessionId: runtimeContext.sessionId ?? null,
        turnId: runtimeContext.turnId,
        toolCallId: toolCall.id,
        questions,
        context: runtimeContext.eventContext,
        onEvent: runtimeContext.onEvent,
        signal,
      });

      return {
        role: 'toolResult',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: 'text', text: answer }],
        isError: false,
        timestamp: Date.now(),
      };
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
  }

  private createPolicyDeniedToolResult(toolCall: ToolCall, agentId: AgentRole, reason?: string): ToolResultMessage {
    return {
      role: 'toolResult',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{
        type: 'text',
        text: reason || `Policy denied tool "${toolCall.name}" for ${agentId}.`,
      }],
      isError: true,
      timestamp: Date.now(),
    };
  }

  private createApprovalRequiredToolResult(
    toolCall: ToolCall,
    agentId: AgentRole,
    reason: string,
  ): ToolResultMessage {
    return {
      role: 'toolResult',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{
        type: 'text',
        text: `Approval required for tool "${toolCall.name}" before it can run for ${agentId}. ${reason} No changes were made.`,
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
      details: result.details,
      timestamp: Date.now(),
    };
  }

  private createTaskRuntimeTools(): AgentTool[] {
    // subagent（sessionId 含 ::subagent:: 段）用 MemoryTaskStore，随子 context 结束回收；
    // 顶层 agent 用会话级 FileTaskStore 落盘（${userData}/state/tasks/{sessionId}），供「进度」泳道按会话读取。
    const sessionId = this.currentTurnEventSink?.sessionId ?? null;
    const isSubagent = sessionId?.includes('::subagent::') ?? false;
    const store = isSubagent || !sessionId
      ? new MemoryTaskStore()
      : createSessionTaskStore(sessionId);
    const registry = new TaskRegistry(store);
    // 桥接 task 变更为 AgentEvent，激活 ConversationService 的 task.* 投影。
    registry.onTaskChange = ({ type, task }) => {
      const sink = this.currentTurnEventSink;
      if (!sink?.onEvent) return;
      sink.onEvent({
        id: generateEventId('agent-event'),
        type: type === 'created' ? 'task.created' : 'task.updated',
        timestamp: nowMs(),
        sessionId: sink.sessionId ?? null,
        agentId: sink.agentId,
        payload: {
          taskId: task.id,
          title: task.subject,
          status: task.status,
        },
      });
    };
    return createTaskTools(registry);
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
      this.createMemorySearchTool(sessionId),
      this.createMemoryReadTool(sessionId),
      this.createMemoryWriteTool(),
      this.createMemoryDeleteTool(),
      this.createPlanArtifactTool(sessionId),
      this.createSkillsCatalogTool(),
      this.createSkillReadTool(agentId),
      this.createMcpCatalogTool(),
      ...this.createSubagentTools(agentId, sessionId),
    ];
  }

  private createAskUserTool(agentId: AgentRole): AgentTool<
    { questions?: unknown[] },
    { agentId: AgentRole; questions: ConversationAskUserQuestion[] }
  > {
    return {
      name: 'ask_user',
      label: 'Ask User',
      description: 'Ask the user for a decision or missing information. Use this when progress depends on user input.',
      parameters: {
        type: 'object',
        required: ['questions'],
        properties: {
          questions: {
            type: 'array',
            minItems: 1,
            description: 'Batch of user questions. A single question is represented as an array with one item.',
            items: {
              type: 'object',
              required: ['prompt'],
              properties: {
                questionId: { type: 'string', description: 'Optional stable question id. Runtime generates one when omitted.' },
                prompt: { type: 'string', description: 'The concise question to ask the user.' },
                description: { type: 'string', description: 'Optional supporting context shown below the question title.' },
                allowFreeform: { type: 'boolean', description: 'Whether the user may type a custom answer. Defaults to true.' },
                options: {
                  type: 'array',
                  description: 'Optional mutually exclusive choices.',
                  items: {
                    type: 'object',
                    required: ['label'],
                    properties: {
                      optionId: { type: 'string', description: 'Optional stable option id. Runtime generates one when omitted.' },
                      label: { type: 'string', description: 'Short option label.' },
                      description: { type: 'string', description: 'Optional one-line option detail.' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      permissionHint: 'readonly',
      async execute(_toolCallId, args) {
        const questions = normalizeAskUserQuestions(args);
        return {
          content: [{
            type: 'text',
            text: questions.length > 0
              ? 'ask_user requires the conversation interaction bridge.'
              : 'ask_user requires at least one canonical questions[] entry with a prompt.',
          }],
          isError: true,
          details: { agentId, questions },
        };
      },
    };
  }

  private createAgentHandoffTool(agentId: AgentRole): AgentTool<
    { agent?: string; label?: string; prompt?: string },
    { fromAgentId: AgentRole; toAgentId: string; label: string; prompt: string; valid: boolean }
  > {
    const orchestrator = this;
    return {
      name: 'agent_handoff',
      label: 'Agent Handoff',
      description: 'Request a handoff to another agent profile. The runtime validates the target against the current profile handoffs and prepares the receiving prompt. The actual profile switch is applied by the orchestrator after this turn.',
      parameters: {
        type: 'object',
        required: ['agent'],
        properties: {
          agent: { type: 'string', description: 'Target agent profile id, such as edit, debugger, analyzer, or optimizer.' },
          label: { type: 'string', description: 'Short handoff label. Defaults to the declared handoff label.' },
          prompt: { type: 'string', description: 'Implementation or specialist prompt for the receiving agent. Defaults to the declared handoff prompt.' },
        },
      },
      permissionHint: 'readonly',
      async execute(_toolCallId, args) {
        const toProfile = typeof args.agent === 'string' ? args.agent.trim() : '';
        const resolved = handoffController.resolve(
          agentId,
          toProfile,
          typeof args.prompt === 'string' ? args.prompt : undefined,
          typeof args.label === 'string' ? args.label : undefined,
        );
        if (!resolved.valid || !resolved.request) {
          return {
            content: [{
              type: 'text',
              text: `Handoff rejected: ${resolved.reason ?? 'unknown reason'}`,
            }],
            isError: true,
            details: { fromAgentId: agentId, toAgentId: toProfile, label: '', prompt: '', valid: false },
          };
        }
        const { toProfile: target, label, prompt } = resolved.request;
        // 记录待处理 handoff，供 ConversationService turn 结束后 consume 实现 profile 切换。
        orchestrator.pendingHandoff = {
          fromAgentId: agentId,
          toProfile: target as AgentRole,
          prompt,
          label,
          sessionId: orchestrator.currentTurnEventSink?.sessionId ?? null,
        };
        return {
          content: [{
            type: 'text',
            text: `Handoff prepared from ${agentId} to ${target}: ${label}\n${prompt}`,
          }],
          details: { fromAgentId: agentId, toAgentId: target, label, prompt, valid: true },
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

  private createMemorySearchTool(sessionId?: string | null): AgentTool<
    { scope: 'user' | 'project'; query?: string; limit?: number },
    { sessionId: string | null; scope: 'user' | 'project'; count: number }
  > {
    const resolveStore = this.getMemoryStore.bind(this);
    return {
      name: 'memory_search',
      label: 'Search Memory',
      description: 'Search explicitly saved memories in one declared scope. Memory is never injected automatically.',
      parameters: { type: 'object', required: ['scope'], properties: {
        scope: { type: 'string', enum: ['user', 'project'] },
        query: { type: 'string' },
        limit: { type: 'number' },
      } },
      permissionHint: 'readonly',
      async execute(_id, args, _signal, _update, context) {
        const records = await resolveStore(args.scope, context?.projectRootPath).searchMemories(args.query ?? '', args.limit ?? 20);
        return { content: [{ type: 'text', text: records.length ? records.map((record) => `- ${record.name}: ${record.description}`).join('\n') : 'No matching memories were found.' }], details: { sessionId: sessionId ?? null, scope: args.scope, count: records.length } };
      },
    };
  }

  private createMemoryReadTool(sessionId?: string | null): AgentTool<
    { scope: 'user' | 'project'; name: string },
    { sessionId: string | null; scope: 'user' | 'project'; count: number }
  > {
    const resolveStore = this.getMemoryStore.bind(this);
    return {
      name: 'memory_read',
      label: 'Read Memory',
      description: 'Read one explicitly saved memory by exact name and scope.',
      parameters: { type: 'object', required: ['scope', 'name'], properties: {
        scope: { type: 'string', enum: ['user', 'project'] },
        name: { type: 'string' },
      } },
      permissionHint: 'readonly',
      async execute(_id, args, _signal, _update, context) {
        const record = await resolveStore(args.scope, context?.projectRootPath).getMemory(args.name);
        return { content: [{ type: 'text', text: record ? `# ${record.name}\n\n${record.description}\n\n${record.content}` : `No memory named "${args.name}" was found.` }], details: { sessionId: sessionId ?? null, scope: args.scope, count: record ? 1 : 0 } };
      },
    };
  }

  private createMemoryWriteTool(): AgentTool<
    { scope: 'user' | 'project'; name: string; description: string; type: string; content: string; tags?: string[]; approved: boolean },
    { scope: 'user' | 'project'; name: string; created: boolean }
  > {
    const resolveStore = this.getMemoryStore.bind(this);
    const validTypes = new Set(['user', 'feedback', 'project', 'reference']);
    return {
      name: 'memory_write',
      label: 'Write Memory',
      description: 'Persist a memory only after explicit user intent or interactive approval. Scope must be declared.',
      parameters: {
        type: 'object',
        required: ['scope', 'name', 'description', 'type', 'content', 'approved'],
        properties: {
          scope: { type: 'string', enum: ['user', 'project'] },
          name: { type: 'string', description: 'Kebab-case memory name (unique key).' },
          description: { type: 'string', description: 'One-line summary.' },
          type: { type: 'string', description: 'user | feedback | project | reference' },
          content: { type: 'string', description: 'Full Markdown body.' },
          tags: { type: 'array', items: { type: 'string' } },
          approved: { type: 'boolean', description: 'True only after the user explicitly requested or approved this write.' },
        },
      },
      permissionHint: 'mutation',
      async execute(_toolCallId, args, _signal, _update, context) {
        if (args.approved !== true) {
          return { content: [{ type: 'text', text: 'Memory write requires explicit user approval.' }], isError: true, details: { scope: args.scope, name: args.name, created: false } };
        }
        const type = validTypes.has(args.type) ? (args.type as 'user' | 'feedback' | 'project' | 'reference') : 'project';
        const record = await resolveStore(args.scope, context?.projectRootPath).writeMemory({
          name: args.name.trim(),
          description: args.description.trim(),
          type,
          content: args.content,
          tags: Array.isArray(args.tags) ? args.tags : undefined,
        });
        return {
          content: [{ type: 'text', text: `Memory saved: ${record.name} (${record.type})` }],
          details: { scope: args.scope, name: record.name, created: true },
        };
      },
    };
  }

  private createMemoryDeleteTool(): AgentTool<
    { scope: 'user' | 'project'; name: string; confirmed: boolean },
    { scope: 'user' | 'project'; name: string; deleted: boolean }
  > {
    const resolveStore = this.getMemoryStore.bind(this);
    return {
      name: 'memory_delete',
      label: 'Delete Memory',
      description: 'Delete one scoped memory only after explicit confirmation.',
      parameters: {
        type: 'object',
        required: ['scope', 'name', 'confirmed'],
        properties: {
          scope: { type: 'string', enum: ['user', 'project'] },
          name: { type: 'string', description: 'Memory name to delete.' },
          confirmed: { type: 'boolean' },
        },
      },
      permissionHint: 'mutation',
      async execute(_toolCallId, args, _signal, _update, context) {
        if (args.confirmed !== true) {
          return { content: [{ type: 'text', text: 'Memory deletion requires explicit confirmation.' }], isError: true, details: { scope: args.scope, name: args.name, deleted: false } };
        }
        const deleted = await resolveStore(args.scope, context?.projectRootPath).deleteMemory(args.name.trim());
        return {
          content: [{
            type: 'text',
            text: deleted ? `Memory deleted: ${args.name}` : `No memory named "${args.name}" was found.`,
          }],
          details: { scope: args.scope, name: args.name, deleted },
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
      async execute(_toolCallId, args, _signal, _onUpdate, context) {
        const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
        const skills = agentRuntimeConfigService.listSkills(context?.projectRootPath ?? undefined)
          .filter((skill) => !query || `${skill.id} ${skill.name} ${skill.label} ${skill.description}`.toLowerCase().includes(query));
        const lines = skills.map((skill) => (
          `${skill.id}: ${skill.label || skill.name} (${skill.source})`
        ));
        return {
          content: [{ type: 'text', text: lines.length > 0 ? lines.join('\n') : 'No configured skills matched the query.' }],
          details: { count: skills.length },
        };
      },
    };
  }

  private createSkillReadTool(agentId: AgentRole): AgentTool<
    { skill_id?: string },
    { skillId: string; agentId: AgentRole }
  > {
    return {
      name: 'skill_read',
      label: 'Read Skill',
      description: 'Load the full SKILL.md instructions for one discovered effective skill.',
      parameters: {
        type: 'object',
        required: ['skill_id'],
        properties: {
          skill_id: { type: 'string', description: 'Skill id, for example rdc-context.' },
        },
      },
      permissionHint: 'readonly',
      async execute(_toolCallId, args, _signal, _onUpdate, context) {
        const skillKey = typeof args.skill_id === 'string' ? args.skill_id.trim() : '';
        if (!skillKey) {
          return {
            content: [{ type: 'text', text: 'skill_id is required.' }],
            isError: true,
            details: { skillId: '', agentId },
          };
        }

        const skill = agentRuntimeConfigService.loadSkill(skillKey, context?.projectRootPath ?? undefined);
        if (!skill) {
          return {
            content: [{ type: 'text', text: `Skill is not configured: ${skillKey}` }],
            isError: true,
            details: { skillId: skillKey, agentId },
          };
        }

        return {
          content: [{ type: 'text', text: skill.instructions }],
          details: {
            skillId: skill.id,
            agentId,
            name: skill.name,
            description: skill.description,
            sourcePath: skill.sourcePath,
          },
        };
      },
    };
  }

  /**
   * Settings / IPC 与 mcp 目录工具共用：合并已配置 MCP 与运行时连接状态。
   */
  getMcpServerStatusSummary(projectRootPath?: string | null, query?: string): MCPServerStatusSummary[] {
    const normalizedQuery = query?.trim().toLowerCase() ?? '';
    const configured = agentRuntimeConfigService.listMcpServers(projectRootPath ?? undefined)
      .filter((server) => !normalizedQuery
        || `${server.id} ${server.name} ${server.description}`.toLowerCase().includes(normalizedQuery));
    const runtimeById = new Map(
      this.mcpManager.getServerStatusSummary().map((entry) => [entry.id, entry]),
    );
    return configured.map((server) => {
      const runtime = runtimeById.get(server.id) ?? runtimeById.get(server.name);
      const summary: MCPServerStatusSummary = {
        id: server.id,
        name: server.name,
        connectionStatus: runtime?.connectionStatus ?? 'unknown',
        toolCount: runtime?.toolCount ?? 0,
        tools: runtime?.tools ?? [],
      };
      if (runtime?.lastError) {
        summary.lastError = runtime.lastError;
      }
      return summary;
    });
  }

  private createMcpCatalogTool(): AgentTool<
    { query?: string },
    { count: number; servers: MCPServerStatusSummary[] }
  > {
    const orchestrator = this;
    return {
      name: 'mcp',
      label: 'List MCP Services',
      description: 'List MCP services configured for the current workspace, including connection status and tools.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional case-insensitive filter.' },
        },
      },
      permissionHint: 'readonly',
      async execute(_toolCallId, args, _signal, _onUpdate, context) {
        const query = typeof args.query === 'string' ? args.query : undefined;
        const servers = orchestrator.getMcpServerStatusSummary(context?.projectRootPath ?? null, query);
        const lines = servers.map((server) => {
          const toolNames = (server.tools ?? []).slice(0, 12);
          const toolsLabel = toolNames.length > 0
            ? toolNames.join(', ') + ((server.tools?.length ?? 0) > toolNames.length ? ', …' : '')
            : '(none)';
          const errorLine = server.lastError ? `\n  lastError: ${server.lastError}` : '';
          return [
            `${server.id}: ${server.name}`,
            `  connectionStatus: ${server.connectionStatus}`,
            `  toolCount: ${server.toolCount}`,
            `  tools: ${toolsLabel}${errorLine}`,
          ].join('\n');
        });
        return {
          content: [{ type: 'text', text: lines.length > 0 ? lines.join('\n') : 'No configured MCP services matched the query.' }],
          details: { count: servers.length, servers },
        };
      },
    };
  }

  private getEnabledMcpDescriptors(agentId: AgentRole, projectRootPath?: string | null): AgentRuntimeMcpDescriptor[] {
    const settings = settingsService.getAll();
    const manifest = settings.agents.definitions.find((entry) => entry.id === agentId && entry.enabled);
    const enabledIds = new Set(manifest?.mcpServers ?? []);
    if (enabledIds.size === 0) {
      return [];
    }
    return agentRuntimeConfigService.listMcpServers(projectRootPath ?? undefined)
      .filter((server) => enabledIds.has(server.id) || enabledIds.has(server.name));
  }

  private async ensureMcpConnections(agentId: AgentRole, projectRootPath?: string | null): Promise<string[]> {
    const errors: string[] = [];
    const nextProjectRoot = projectRootPath ? path.resolve(projectRootPath) : null;
    if (this.activeMcpProjectRoot !== nextProjectRoot) {
      await this.mcpManager.disconnectAll();
      this.connectedMcpServerIds.clear();
      this.failedMcpServers.clear();
      this.activeMcpProjectRoot = nextProjectRoot;
    }
    for (const descriptor of this.getEnabledMcpDescriptors(agentId, projectRootPath)) {
      if (this.connectedMcpServerIds.has(descriptor.id)) {
        continue;
      }
      if (this.failedMcpServers.has(descriptor.id)) {
        errors.push(`${descriptor.id}: ${this.failedMcpServers.get(descriptor.id)}`);
        continue;
      }
      try {
        await this.mcpManager.connect(this.toMcpServerConfig(descriptor));
        this.connectedMcpServerIds.add(descriptor.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.failedMcpServers.set(descriptor.id, message);
        errors.push(`${descriptor.id}: ${message}`);
      }
    }
    return errors;
  }

  private toMcpServerConfig(descriptor: AgentRuntimeMcpDescriptor): MCPServerConfig {
    return {
      name: descriptor.id,
      type: descriptor.transport,
      command: descriptor.command,
      args: descriptor.args,
      url: descriptor.url,
      env: descriptor.env,
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
    stage?: WorkflowStage | 'report';
    runId?: string;
    sessionId?: string | null;
    turnId?: string;
    toolAllowlist: string[];
    options?: AgentTurnOptions;
    projectRootPath?: string | null;
    projectId?: string | null;
    /** Ask 路径由 ConversationService 传入的 prompt 分段字符数，用于细化 breakdown。 */
    promptPlan?: PromptPlan;
    contextWindow?: number;
    contextTokenLimit?: number;
  }): Promise<string> {
    if (!input.providerId || !input.modelId) {
      throw new Error('No provider/model route is configured for this agent.');
    }

    const settings = settingsService.getAll();
    const routeProvider = settings.llm.providers.find((entry) => entry.id === input.providerId);
    const routeCapability = resolveAgentRouteCapability(routeProvider, input.modelId);
    const modelCapability = resolveModelCapability(input.providerId, input.modelId, settings);
    const mcpConnectionErrors = await this.ensureMcpConnections(input.agentId, input.projectRootPath);
    const runtimeTools = this.resolveRuntimeTools(input.agentId, input.toolAllowlist, input.stage, input.sessionId);
    const activeToolDefinitions = routeCapability.toolCallingMode === 'native-structured'
      ? runtimeTools.definitions
      : [];
    const activeToolAllowlist = activeToolDefinitions.map((tool) => tool.name);
    const sharedEventContext: AgentEventBridgeContext = {
      agentId: input.agentId,
      runId: input.runId,
      turnId: input.turnId,
      sessionId: input.sessionId ?? null,
      stage: input.stage,
      mode: input.mode,
      providerId: input.providerId,
      modelId: input.modelId,
      toolAllowlist: activeToolAllowlist,
      routeCapability,
    };
    // 设置当前 turn 事件下沉，供 subagent 工具桥接子事件到父 trace。
    this.currentTurnEventSink = {
      onEvent: input.options?.onEvent,
      sessionId: input.sessionId ?? null,
      projectRootPath: input.projectRootPath ?? null,
      projectId: input.projectId ?? null,
      agentId: input.agentId,
    };
    const toolExecutor = this.createToolExecutor(input.agentId, activeToolAllowlist, input.stage, input.sessionId, {
      sessionId: input.sessionId ?? null,
      turnId: input.turnId,
      eventContext: sharedEventContext,
      onEvent: input.options?.onEvent,
      projectRootPath: input.projectRootPath ?? null,
      projectId: input.projectId ?? null,
    });
    const streamOptions: StreamOptions = {
      maxTokens: input.maxTokens,
      temperature: resolveEffectiveTemperature(modelCapability, input.temperature),
      reasoning: input.options?.reasoning,
      reasoningVisibility: input.options?.reasoning?.selection === 'off' ? 'none' : routeCapability.reasoningVisibility,
      signal: input.options?.signal,
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
      input.options?.onEvent?.(buildDiagnosticAgentEvent(sharedEventContext, {
        code: 'route_tool_calling_unsupported',
        severity: routeCapability.toolCallingMode === 'disabled' ? 'error' : 'warning',
        message: routeDiagnostic,
        technicalMessage: JSON.stringify(routeCapability),
      }));
    }
    const slot = this.getOrCreateAgentSlot(
      input.agentId,
      input.providerId,
      input.modelId,
      input.systemPrompt,
      activeToolDefinitions,
      toolExecutor,
      streamOptions,
      input.turnId ?? '',
      input.sessionId,
      input.contextWindow,
      input.contextTokenLimit,
      input.promptPlan,
    );

    const userMessage: UserMessage = {
      role: 'user',
      content: input.content,
      timestamp: nowMs(),
    };

    let responseText = '';
    let sawStructuredToolCall = false;
    const unsubscribe = slot.agent.subscribe((event: CoreAgentEvent) => {
      if (event.type === 'message_update') {
        const ev = event.assistantMessageEvent;
        if (ev.type === 'text_delta' && typeof ev.delta === 'string') {
          input.options?.onChunk?.(ev.delta);
        }
        if (ev.type === 'toolcall_end') {
          sawStructuredToolCall = true;
        }
      }
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        responseText = event.message.content
          .filter((block) => block.type === 'text')
          .map((block) => (block as { text: string }).text)
          .join('');
        if (event.message.usage) {
          // 将 activeToolDefinitions 按来源分组：mcp__* 前缀为 MCP 工具，subagent 为子 Agent，其余为系统工具。
          const isMcpDef = (d: ToolDefinition) => d.name.startsWith('mcp__');
          const isSubagentDef = (d: ToolDefinition) => d.name === 'subagent';
          const mcpDefs      = activeToolDefinitions.filter(isMcpDef);
          const subagentDefs = activeToolDefinitions.filter(isSubagentDef);
          const systemDefs   = activeToolDefinitions.filter((d) => !isMcpDef(d) && !isSubagentDef(d));

          const pm = input.promptPlan?.metrics;
          const systemPromptChars = pm
            ? pm.systemPrompt
            : input.systemPrompt.length;
          const rulesChars    = pm?.scopedInstructions ?? 0;
          const skillsChars   = pm?.skills ?? 0;

          // 压缩统计：在 message_end 时对当前 agent 的消息历史分类。
          const compressionStats = slot.contextManager.classifyMessages(
            slot.agent.messages as import('../../agent-runtime/core/types').AgentMessage[],
          );

          const precomputedBreakdown: ContextUsageBreakdownEntry[] = [
            { id: 'system_prompt', tokens: charsToTokens(systemPromptChars) },
            ...(rulesChars > 0 ? [{ id: 'scoped_instructions' as const, tokens: charsToTokens(rulesChars) }] : []),
            ...(skillsChars > 0 ? [{ id: 'skills' as const, tokens: charsToTokens(skillsChars) }] : []),
            { id: 'system_tools',          tokens: charsToTokens(JSON.stringify(systemDefs).length),   count: systemDefs.length },
            { id: 'mcp_tools',             tokens: charsToTokens(JSON.stringify(mcpDefs).length),      count: mcpDefs.length },
            { id: 'subagent_definitions',  tokens: charsToTokens(JSON.stringify(subagentDefs).length), count: subagentDefs.length },
            ...(compressionStats.summaryTokens > 0
              ? [{ id: 'summarized_conversation' as const, tokens: compressionStats.summaryTokens }]
              : []),
            { id: 'conversation', tokens: compressionStats.conversationTokens, count: compressionStats.conversationCount },
          ];

          debuggerLlmService.recordAgentTurnUsage({
            runId: input.runId,
            sessionId: input.sessionId,
            providerId: input.providerId,
            modelId: input.modelId,
            inputTokens: event.message.usage.inputTokens,
            outputTokens: event.message.usage.outputTokens,
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
      agentUserInputRequestService.cancelTurn(input.turnId);
      agentToolApprovalRequestService.cancelTurn(input.turnId);
      this.currentTurnEventSink = null;
      // 长生命周期 Agent：turn 结束后持久化完整 message 线程，
      // 使重开 session 可从 StorageAdapter 回填并完整续接。
      if (input.sessionId && !input.options?.signal?.aborted) {
        try {
          storageAdapter.writeAgentThread(input.sessionId, input.agentId, [...slot.agent.messages]);
        } catch (error) {
          console.error(`[AgentOrchestrator] writeAgentThread failed for ${input.sessionId}::${input.agentId}:`, error);
        }
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
    return isTopLevelAgentId(agentId) ? agentId as AppMode : 'edit';
  }


  private systemPromptForAgent(agentId: AgentRole, prompt?: string): string {
    if (prompt) {
      return prompt;
    }
    const topLevelAgentId: AgentId | null = isTopLevelAgentId(agentId) ? agentId : null;
    return topLevelAgentId
      ? `You are the ${AGENT_DISPLAY_NAMES[topLevelAgentId]}. ${AGENT_DESCRIPTIONS[topLevelAgentId]}`
      : `You are ${agentId}. Follow the active .agent.md profile and report evidence clearly.`;
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
      : `${this.getAgentDisplayName(agentId)} is ready. Describe the goal and I can use the configured tools for this turn.`;
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
