import { settingsService } from '../../services/SettingsService';
import { runtimeLogService } from '../../services/RuntimeLogService';
import type { AgentRunRequest, AgentRunResult, AgentSdkAdapter } from './AgentRunnerPort';
import { toolBridgeAgentToolPort } from './ToolBridgeAgentToolPort';
import { ClaudeAgentSdkAdapter } from './adapters/ClaudeAgentSdkAdapter';
import { LlmAdapterAgentSdkAdapter } from './adapters/LlmAdapterAgentSdkAdapter';
import { OpenAiAgentSdkAdapter } from './adapters/OpenAiAgentSdkAdapter';

export class AgentRunnerRegistry {
  private readonly adapters: AgentSdkAdapter[] = [
    new OpenAiAgentSdkAdapter(),
    new ClaudeAgentSdkAdapter(),
    new LlmAdapterAgentSdkAdapter(),
  ];

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const settings = settingsService.getAll();
    const provider = settings.llm.providers.find((entry) => entry.id === request.providerId);
    if (!provider || !provider.enabled || !provider.isConfigured) {
      throw new Error(`Agent provider is not configured: ${request.providerId}`);
    }

    const adapter = this.adapters.find((entry) => entry.canRun(request));
    if (!adapter) {
      throw new Error(`No AgentRunner adapter for provider: ${request.providerId}`);
    }

    runtimeLogService.log({
      scope: request.sessionId ? 'session' : 'app',
      namespace: 'agent',
      severity: 'info',
      title: 'Agent runner selected',
      summary: `${request.agentId} 使用 ${adapter.id} 执行 ${request.stage || 'stage'}。`,
      sessionId: request.sessionId,
      runId: request.runId,
      raw: {
        agentId: request.agentId,
        providerId: request.providerId,
        modelId: request.modelId,
        adapter: adapter.id,
      },
    });

    return adapter.run(request, toolBridgeAgentToolPort);
  }
}

export const agentRunnerRegistry = new AgentRunnerRegistry();
