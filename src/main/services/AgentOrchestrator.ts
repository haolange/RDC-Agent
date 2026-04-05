/**
 * AgentOrchestrator - Agent编排器
 * 负责协调各Agent角色、管理System Prompt和Model配置
 */

import { BrowserWindow } from 'electron';
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
import { llmAdapter } from '../adapters/LLMAdapter';
import { storageAdapter } from './StorageAdapter';
import { harnessController } from './HarnessController';
import { generateEventId, nowMs, nowIso } from '@shared/utils/id';
import type { LLMConfig } from '@shared/types/llm';
import { executionProfileService } from './ExecutionProfileService';
import { settingsService } from './SettingsService';
import { runtimeLogService } from './RuntimeLogService';

// ============================================
// Specialist 工具绑定（Task 4b）
// ============================================

/**
 * 固定每个 specialist 的工具清单
 * 确保每个 agent 只能访问其职责范围内的工具
 */
// @ts-ignore: reserved for future use
const SPECIALIST_TOOL_BINDINGS: Record<string, string[]> = {
  triage_agent: [
    'rd.session.get_context',
    'rd.event.get_action_tree',
    'rd.macro.summarize_frame',
  ],
  capture_repro_agent: [
    'rd.capture.get_info',
    'rd.capture.list_frames',
    'rd.context.snapshot',
  ],
  pass_graph_pipeline_agent: [
    'rd.pipeline.get_state_summary',
    'rd.pipeline.get_output_targets',
    'rd.macro.find_state_change_point',
  ],
  pixel_forensics_agent: [
    'rd.macro.explain_pixel',
    'rd.texture.get_pixel_value',
    'rd.export.screenshot',
  ],
  shader_ir_agent: [
    'rd.shader.get_disassembly',
    'rd.shader.debug_start',
  ],
  driver_device_agent: [
    'rd.session.get_context',
    'rd.remote.connect',
    'rd.remote.ping',
    'rd.remote.list_devices',
  ],
  // skeptic_agent 和 curator_agent 不直接使用 live tool
  skeptic_agent: [],
  curator_agent: [],
};

/**
 * 默认调试策略：
 * 第一层优先 macro/summary 工具（宏观快速定位）
 * 第二层再下钻 canonical event/pipeline/resource/texture/shader 工具
 */
// @ts-ignore: reserved for future use
const INVESTIGATION_PRIORITY = {
  layer1_macro: ['rd.macro.summarize_frame', 'rd.macro.explain_pixel', 'rd.macro.find_state_change_point'],
  layer2_canonical: ['rd.event.*', 'rd.pipeline.*', 'rd.resource.*', 'rd.texture.*', 'rd.shader.*'],
};

/**
 * Shader 编辑默认只读约束：
 * rd.shader.edit_and_replace 和 rd.macro.shader_hotfix_validate 默认不出现在任何 specialist 的工具清单中
 * 仅在未来 optimizer 模式或用户显式要求时启用
 */
// @ts-ignore: reserved for future use
const SHADER_EDIT_TOOLS = ['rd.shader.edit_and_replace', 'rd.macro.shader_hotfix_validate'];

export class AgentOrchestrator {
  private agentStates: Map<AgentRole, AgentState> = new Map();
  private agentConfigs: Map<AgentRole, AgentConfig> = new Map();
  private mainWindow: BrowserWindow | null = null;

  constructor() {
    // 初始化所有Agent状态
    this.initializeAgents();
  }

  /**
   * 设置主窗口引用
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
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
    }
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

      // 调用LLM
      const response = await llmAdapter.chat(
        {
          messages,
          model: config.modelName,
          maxTokens: config.maxTokens,
          temperature: config.temperature,
        },
        config.modelProvider
      );

      // 记录消息
      await this.recordMessage(agentId, 'user', content, context);
      const responseContent = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
      await this.recordMessage(agentId, 'assistant', responseContent, context);

      // 更新状态
      this.updateAgentStatus(agentId, 'complete');

      return responseContent;
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
    const runtimeProfile = this.resolveRuntimeProfile(agentId);
    const profileTools = runtimeProfile.toolAllowlist ?? [];
    if (profileTools.length > 0) {
      return profileTools;
    }
    return SPECIALIST_TOOL_BINDINGS[agentId] ?? [];
  }
  
  /**
   * 检查工具是否允许被指定角色使用（Task 4b）
   * shader 编辑工具默认只读，不在任何 specialist 的工具清单中
   */
  isToolAllowedForRole(toolName: string, agentId: AgentRole): boolean {
    // Shader 编辑工具默认不可用
    if (SHADER_EDIT_TOOLS.includes(toolName)) {
      return false; // 仅 optimizer 模式或用户显式要求时启用
    }
  
    const allowedTools = this.getToolsForRole(agentId);
  
    // 支持通配符匹配，如 rd.event.*
    for (const pattern of allowedTools) {
      if (pattern.endsWith('.*')) {
        const prefix = pattern.slice(0, -2);
        if (toolName.startsWith(prefix + '.')) {
          return true;
        }
      } else if (toolName === pattern) {
        return true;
      }
    }
  
    return false;
  }
  
  /**
   * 分派Specialist
   */
  async dispatchSpecialist(
    agentId: AgentRole,
    objective: string,
    context: {
      caseId: string;
      runId: string;
      sessionId: string;
    }
  ): Promise<{ success: boolean; tokenId?: string; error?: string }> {
    // 验证是specialist agent
    if (!INVESTIGATOR_AGENTS.includes(agentId) && !VERIFIER_AGENTS.includes(agentId)) {
      return { success: false, error: `Cannot dispatch non-specialist agent: ${agentId}` };
    }

    // 执行dispatch gate检查
    const gateResult = await harnessController.executeDispatchGate(
      context.caseId,
      context.runId,
      {
        targetAgent: agentId,
        objective,
        orchestrationMode: 'multi_agent',
      }
    );

    if (gateResult.status === 'blocked') {
      return {
        success: false,
        error: gateResult.blockers.map(b => b.reason).join('; '),
      };
    }
    
    // 获取该 specialist 可用的工具列表（Task 4b）
    const allowedTools = this.getToolsForRole(agentId);
    
    // 记录分派的工具约束
    console.log(`[AgentOrchestrator] Dispatching ${agentId} with ${allowedTools.length} allowed tools:`, allowedTools);
    
    // 生成capability token
    const tokenId = generateEventId('tok');
    
    // 记录dispatch事件（包含可用工具列表）
    const event = storageAdapter.createActionEvent({
      runId: context.runId,
      sessionId: context.sessionId,
      agentId: 'rdc-debugger',
      eventType: 'dispatch',
      status: 'sent',
      payload: {
        target_agent: agentId,
        objective,
        capability_token_id: tokenId,
        dispatch_time: nowIso(),
      },
    });

    await storageAdapter.appendActionEvent(context.sessionId, event);

    // 更新agent状态
    this.updateAgentStatus(agentId, 'waiting');

    // 发送任务给specialist
    try {
      const response = await this.sendMessage(agentId, objective, context);

      // 记录完成
      const completeEvent = storageAdapter.createActionEvent({
        runId: context.runId,
        sessionId: context.sessionId,
        agentId,
        eventType: 'artifact_write',
        status: 'ok',
        payload: {
          brief: response.substring(0, 500),
          completed_at: nowIso(),
        },
      });

      await storageAdapter.appendActionEvent(context.sessionId, completeEvent);

      this.updateAgentStatus(agentId, 'complete');

      return { success: true, tokenId };
    } catch (error) {
      this.updateAgentStatus(agentId, 'error');
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
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
    context?: { caseId?: string; runId?: string; sessionId?: string }
  ): Promise<void> {
    if (!context?.sessionId) return;

    const message: AgentMessage = {
      id: generateEventId('msg'),
      agentId,
      role,
      content,
      timestamp: nowMs(),
    };

    // 通知UI
    this.notifyMessage(message, context?.sessionId);
  }

  /**
   * 通知Agent状态变化
   */
  private notifyAgentStateChanged(state: AgentState): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('agent:statusChanged', state);
    }
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
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('agent:message', message);
    }
  }
}

// 单例导出
export const agentOrchestrator = new AgentOrchestrator();
