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
import type { AgentEvent } from '@shared/types/agentRuntime';
import type { LLMConfig, LLMStreamEvent } from '@shared/types/llm';
import type { AppMode } from '@shared/types/session';
import type { LlmProviderId } from '@shared/types/settings';
import type { WorkflowStage } from '@shared/types/workflow';
import { generateEventId, nowIso, nowMs } from '@shared/utils/id';
import { agentRuntime } from '../../agent-runtime/AgentRuntime';
import { runtimeLogService } from '../../runtime/RuntimeLogService';
import { storageAdapter } from '../../sessions/StorageAdapter';
import { executionProfileService } from '../../settings/ExecutionProfileService';
import { llmAdapter } from '../../settings/LLMAdapter';
import { providerAccountAuthService } from '../../settings/ProviderAccountAuthService';
import { settingsService } from '../../settings/SettingsService';
import { workflowProjectionPublisher } from './WorkflowProjectionPublisher';
import { isToolAllowedForAgent, resolveAgentToolAllowlist } from './DebuggerRuntimePolicy';

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
}

const EXECUTE_PATTERN = /start|execute|debug|analy[sz]e|开始|启动|执行|正式分析|开始调试|调试/i;

export class AgentOrchestrator {
  private agentStates: Map<AgentRole, AgentState> = new Map();
  private agentConfigs: Map<AgentRole, AgentConfig> = new Map();

  constructor() {
    this.initializeAgents();
  }

  setMainWindow(_window: unknown): void {
    // Renderer projection is owned by WorkflowProjectionPublisher.
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

  private emitRuntimeChunk(event: AgentEvent, onChunk?: (text: string) => void): void {
    if (!onChunk || event.type !== 'assistant.delta') {
      return;
    }
    const text = event.payload && typeof event.payload.text === 'string' ? event.payload.text : '';
    if (text) {
      onChunk(text);
    }
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

      const response = await agentRuntime.runTurn({
        agentId,
        mode: this.modeForAgent(agentId),
        prompt: content,
        systemPrompt,
        modelId: config.modelName,
        providerId: config.modelProvider,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        toolAllowlist: resolveAgentToolAllowlist(agentId, context?.stageId),
        stage: context?.stageId,
        patternId: this.patternForAgent(agentId),
        runId: context?.runId,
        sessionId: context?.sessionId,
        turnId: context?.turnId,
        signal: options?.signal,
        onStreamEvent: options?.onStreamEvent,
        onEvent: (event) => this.emitRuntimeChunk(event, options?.onChunk),
      });
      const finalContent = await this.finalizeRecordedAssistantMessage(
        agentId,
        response.text,
        response.text,
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
    options?: AgentTurnOptions & {
      sessionId?: string;
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
      turnId?: string;
      routeAgentId?: AgentRole;
    },
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
        const finalStub = await this.createCoworkTestResponse(agentId, content, options?.onChunk);
        this.updateAgentStatus(agentId, 'complete');
        return finalStub;
      }

      const response = await agentRuntime.runTurn({
        agentId,
        mode: this.modeForAgent(agentId),
        prompt: content,
        systemPrompt: this.systemPromptForAgent(agentId, config.systemPrompt),
        modelId: config.modelName,
        providerId: config.modelProvider,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        toolAllowlist: [],
        stage: 'cowork',
        patternId: this.patternForAgent(agentId),
        sessionId: options?.sessionId,
        turnId: options?.turnId,
        signal: options?.signal,
        onStreamEvent: options?.onStreamEvent,
        onEvent: (event) => this.emitRuntimeChunk(event, options?.onChunk),
      });
      const finalContent = response.text;

      runtimeLogService.log({
        scope: options?.sessionId ? 'session' : 'app',
        namespace: 'agent',
        severity: 'info',
        title: `${AGENT_DISPLAY_NAMES[agentId] || agentId} cowork turn`,
        summary: finalContent.slice(0, 160) || 'Empty message.',
        sessionId: options?.sessionId,
        raw: {
          agentId,
          providerId: config.modelProvider,
          modelId: config.modelName,
        },
      });

      this.updateAgentStatus(agentId, 'complete');
      return finalContent;
    } catch (error) {
      this.updateAgentStatus(agentId, 'error');
      throw error;
    }
  }

  private async createCoworkTestResponse(
    agentId: AgentRole,
    content: string,
    onChunk?: (text: string) => void,
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
      ? 'I can help clarify the problem, explain boundaries, or guide you to open a .rdc capture without starting execution.'
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

    const finalStub = `${stub}\n<control>{"intent":"${wantsExecution ? 'execute' : 'talk'}","safe_to_start":${wantsExecution ? 'true' : 'false'}}</control>`;
    if (onChunk) {
      const midpoint = Math.max(1, Math.ceil(finalStub.length / 2));
      onChunk(finalStub.slice(0, midpoint));
      await Promise.resolve();
      onChunk(finalStub.slice(midpoint));
    }
    return finalStub;
  }

  getToolsForRole(agentId: AgentRole): string[] {
    return resolveAgentToolAllowlist(agentId);
  }

  isToolAllowedForRole(toolName: string, agentId: AgentRole): boolean {
    return isToolAllowedForAgent(toolName, agentId);
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
}

export const agentOrchestrator = new AgentOrchestrator();
