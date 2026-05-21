/**
 * AgentOrchestrator - Agent runner registry facade
 * 只负责角色配置、路由和消息投影；顶层流程阶段和 gate 由 DebuggerRuntime 控制。
 */

import type {
  AgentRole,
  AgentConfig,
  AgentState,
  AgentMessage,
  WriteScope,
} from '@shared/types/agent';
import type { WorkflowStage } from '@shared/types/workflow';
import {
  AGENT_DISPLAY_NAMES,
  AGENT_DESCRIPTIONS,
  DEFAULT_MODEL_ROUTING,
  INVESTIGATOR_AGENTS,
  VERIFIER_AGENTS,
  REPORTER_AGENTS,
} from '@shared/constants/agents';
import { storageAdapter } from './StorageAdapter';
import { generateEventId, nowMs, nowIso } from '@shared/utils/id';
import type { LLMConfig, LLMStreamEvent } from '@shared/types/llm';
import { executionProfileService } from './ExecutionProfileService';
import { settingsService } from './SettingsService';
import { runtimeLogService } from './RuntimeLogService';
import { agentRunnerRegistry } from '../workflow/debugger/AgentRunnerRegistry';
import { workflowProjectionPublisher } from '../workflow/debugger/WorkflowProjectionPublisher';
import { isToolAllowedForAgent, resolveAgentToolAllowlist } from '../workflow/debugger/DebuggerRuntimePolicy';

export class AgentOrchestrator {
  private agentStates: Map<AgentRole, AgentState> = new Map();
  private agentConfigs: Map<AgentRole, AgentConfig> = new Map();

  constructor() {
    // 初始化所有Agent状态
    this.initializeAgents();
  }

  /**
   * 设置主窗口引用
   */
  setMainWindow(_window: unknown): void {
    // Renderer projection is owned by WorkflowProjectionPublisher.
  }

  /**
   * 初始化所有Agent
   */
  private initializeAgents(): void {
    const allRoles: AgentRole[] = [
      'rdc-debugger',
      'triage_agent',
      'capture_repro_agent',
      'pass_graph_pipeline_agent',
      'pixel_forensics_agent',
      'shader_ir_agent',
      'driver_device_agent',
      'skeptic_agent',
      'curator_agent',
    ];

    for (const role of allRoles) {
      this.agentStates.set(role, {
        agentId: role,
        status: 'idle',
        lastActivity: nowIso(),
      });

      // 设置默认配置
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

  /**
   * 获取Agent类别
   */
  private getAgentCategory(role: AgentRole): 'orchestrator' | 'investigator' | 'verifier' | 'reporter' {
    if (role === 'rdc-debugger') return 'orchestrator';
    if (INVESTIGATOR_AGENTS.includes(role)) return 'investigator';
    if (VERIFIER_AGENTS.includes(role)) return 'verifier';
    if (REPORTER_AGENTS.includes(role)) return 'reporter';
    return 'investigator';
  }

  /**
   * 获取Agent写入范围
   */
  private getAgentWriteScopes(role: AgentRole): WriteScope[] {
    if (role === 'rdc-debugger') return ['workspace_control'];
    if (INVESTIGATOR_AGENTS.includes(role)) return ['workspace_notes'];
    if (role === 'skeptic_agent') return ['session_signoff'];
    if (role === 'curator_agent') return ['workspace_reports', 'session_artifacts', 'knowledge_library'];
    return [];
  }

  /**
   * 获取Agent状态
   */
  getAgentState(agentId: AgentRole): AgentState | null {
    return this.agentStates.get(agentId) || null;
  }

  /**
   * 获取所有Agent状态
   */
  getAllAgentStates(): AgentState[] {
    return Array.from(this.agentStates.values());
  }

  /**
   * 配置Agent
   */
  configureAgent(agentId: AgentRole, config: Partial<AgentConfig>): void {
    const existing = this.agentConfigs.get(agentId);
    if (existing) {
      this.agentConfigs.set(agentId, { ...existing, ...config });
    }
  }

  /**
   * 获取Agent配置
   */
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

  private resolveRuntimeProfile(agentId: AgentRole, stage?: WorkflowStage) {
    const settings = settingsService.getAll();
    return executionProfileService.resolveAgentRuntimeProfile(settings, stage || 'investigate', agentId);
  }

  private async finalizeRecordedAssistantMessage(
    agentId: AgentRole,
    streamedContent: string,
    fallbackContent: string,
    context?: {
      caseId?: string;
      runId?: string;
      sessionId?: string;
      stageId?: WorkflowStage;
      turnId?: string;
    },
  ): Promise<string> {
    const finalContent = streamedContent || fallbackContent;
    await this.recordMessage(agentId, 'assistant', finalContent, context);
    return finalContent;
  }

  /**
   * 发送消息给Agent
   */
  async sendMessage(
    agentId: AgentRole,
    content: string,
    context?: {
      caseId?: string;
      runId?: string;
      sessionId?: string;
      stageId?: WorkflowStage;
      turnId?: string;
    },
    options?: {
      signal?: AbortSignal;
      onChunk?: (text: string) => void;
      onStreamEvent?: (event: LLMStreamEvent) => void;
    },
  ): Promise<string> {
    const fallbackConfig = this.agentConfigs.get(agentId);
    if (!fallbackConfig) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // 更新状态
    this.updateAgentStatus(agentId, 'thinking');

    try {
      const runtimeProfile = this.resolveRuntimeProfile(agentId, context?.stageId);
      const config: AgentConfig = {
        ...fallbackConfig,
        systemPrompt: runtimeProfile.systemPrompt,
        modelProvider: runtimeProfile.providerId,
        modelName: runtimeProfile.modelId,
        temperature: runtimeProfile.temperature ?? fallbackConfig.temperature,
        maxTokens: runtimeProfile.maxTokens ?? fallbackConfig.maxTokens,
      };

      // 构建消息
      const messages = [
        { role: 'system' as const, content: config.systemPrompt || `You are the ${AGENT_DISPLAY_NAMES[agentId]}. ${AGENT_DESCRIPTIONS[agentId]}` },
        { role: 'user' as const, content },
      ];

      await this.recordMessage(agentId, 'user', content, context);

      const response = await agentRunnerRegistry.run({
        agentId,
        prompt: content,
        systemPrompt: messages[0]?.content ?? '',
        modelId: config.modelName,
        providerId: config.modelProvider,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        toolAllowlist: resolveAgentToolAllowlist(agentId, context?.stageId),
        stage: context?.stageId,
        caseId: context?.caseId,
        runId: context?.runId,
        sessionId: context?.sessionId,
        turnId: context?.turnId,
        signal: options?.signal,
        onChunk: options?.onChunk,
        onStreamEvent: options?.onStreamEvent,
      });
      const finalContent = await this.finalizeRecordedAssistantMessage(
        agentId,
        response.text,
        response.text,
        context,
      );

      // 更新状态
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
    options?: {
      sessionId?: string;
      signal?: AbortSignal;
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
      turnId?: string;
      onChunk?: (text: string) => void;
      onStreamEvent?: (event: LLMStreamEvent) => void;
    },
  ): Promise<string> {
    const fallbackConfig = this.agentConfigs.get(agentId);
    if (!fallbackConfig) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    this.updateAgentStatus(agentId, 'thinking');

    try {
      const settings = settingsService.getAll();
      const routeMap = new Map(settings.llm.agentRoutes.map((route) => [route.agentId, route]));
      const route = routeMap.get(agentId);
      const config: AgentConfig = {
        ...fallbackConfig,
        modelProvider: route?.providerId || fallbackConfig.modelProvider,
        modelName: route?.modelId || fallbackConfig.modelName,
        systemPrompt: options?.systemPrompt || fallbackConfig.systemPrompt,
        temperature: options?.temperature ?? fallbackConfig.temperature,
        maxTokens: options?.maxTokens ?? fallbackConfig.maxTokens,
      };

      if (process.env.RDC_AGENT_TEST_MODE === '1') {
        let userMessage = content;
        try {
          const parsed = JSON.parse(content) as { effective_user_message?: string; user_message?: string };
          userMessage = parsed.effective_user_message || parsed.user_message || content;
        } catch {
          userMessage = content;
        }
        const lower = userMessage.toLowerCase();
        let stub = '我在。你可以先告诉我你遇到了什么现象，或者直接说你希望我现在正式开始调试。';
        if (/ue4|unreal/i.test(userMessage)) {
          stub = 'UE4 是 Unreal Engine 4。它是 Epic Games 的一代游戏引擎，常见于延迟渲染、材质系统、后处理链和 Shader 调试场景。';
        } else if (/你好|您好|hello|hi/i.test(userMessage)) {
          stub = '你好，我是 RDC Debugger。你可以先和我聊现象、问我能力范围，等你准备好 capture 后，我再进入正式的 RenderDoc 调试。';
        } else if (/开始|启动|执行|正式分析|开始调试|debug|analy[sz]e|调试/.test(lower)) {
          stub = '收到，我会先帮你整理正式调试前的关键信息，然后在条件满足时进入严格执行流程。';
        }
        this.updateAgentStatus(agentId, 'complete');
        const finalStub = `${stub}\n<control>{"intent":"${/开始|启动|执行|正式分析|开始调试|debug|analy[sz]e|调试/.test(lower) ? 'execute' : 'talk'}","safe_to_start":${/开始|启动|执行|正式分析|开始调试|debug|analy[sz]e|调试/.test(lower) ? 'true' : 'false'}}</control>`;
        if (options?.onChunk) {
          const midpoint = Math.max(1, Math.ceil(finalStub.length / 2));
          options.onChunk(finalStub.slice(0, midpoint));
          await Promise.resolve();
          options.onChunk(finalStub.slice(midpoint));
        }
        return finalStub;
      }

      const response = await agentRunnerRegistry.run({
        agentId,
        prompt: content,
        systemPrompt: config.systemPrompt || `You are the ${AGENT_DISPLAY_NAMES[agentId]}. ${AGENT_DESCRIPTIONS[agentId]}`,
        modelId: config.modelName,
        providerId: config.modelProvider,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        toolAllowlist: [],
        stage: 'cowork',
        sessionId: options?.sessionId,
        turnId: options?.turnId,
        signal: options?.signal,
        onChunk: options?.onChunk,
        onStreamEvent: options?.onStreamEvent,
      });
      const finalContent = response.text;

      runtimeLogService.log({
        scope: options?.sessionId ? 'session' : 'app',
        namespace: 'agent',
        severity: 'info',
        title: `${AGENT_DISPLAY_NAMES[agentId] || agentId} cowork turn`,
        summary: finalContent.slice(0, 160) || '空消息',
        sessionId: options?.sessionId,
        raw: {
          agentId,
          providerId: response.providerId,
          modelId: response.modelId,
          adapter: response.trace?.adapter,
        },
      });

      this.updateAgentStatus(agentId, 'complete');
      return finalContent;
    } catch (error) {
      this.updateAgentStatus(agentId, 'error');
      throw error;
    }
  }

  /**
   * 获取 Specialist 可用工具清单（Task 4b）
   * 根据角色过滤可用工具，确保 skeptic_agent 和 curator_agent 不接收任何 live tool
   */
  getToolsForRole(agentId: AgentRole): string[] {
    return resolveAgentToolAllowlist(agentId);
  }
  
  /**
   * 检查工具是否允许被指定角色使用（Task 4b）
   * shader 编辑工具默认只读，不在任何 specialist 的工具清单中
   */
  isToolAllowedForRole(toolName: string, agentId: AgentRole): boolean {
    return isToolAllowedForAgent(toolName, agentId);
  }
  
  /**
   * 更新Agent状态
   */
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
        summary: `状态切换为 ${status}。`,
        raw: {
          agentId,
          status,
        },
      });
      this.notifyAgentStateChanged(state);
    }
  }

  /**
   * 记录消息
   */
  private async recordMessage(
    agentId: AgentRole,
    role: 'user' | 'assistant' | 'system',
    content: string,
    context?: { caseId?: string; runId?: string; sessionId?: string; turnId?: string }
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

    // 通知UI
    this.notifyMessage(message, context?.sessionId);
  }

  /**
   * 通知Agent状态变化
   */
  private notifyAgentStateChanged(state: AgentState): void {
    workflowProjectionPublisher.publishAgentStatus(state);
  }

  /**
   * 通知消息
   */
  private notifyMessage(message: AgentMessage, sessionId?: string): void {
    runtimeLogService.log({
      scope: sessionId ? 'session' : 'app',
      namespace: 'agent',
      severity: message.role === 'system' ? 'warning' : 'info',
      title: AGENT_DISPLAY_NAMES[message.agentId] || message.agentId,
      summary: message.content.slice(0, 120) || '空消息',
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

// 单例导出
export const agentOrchestrator = new AgentOrchestrator();
