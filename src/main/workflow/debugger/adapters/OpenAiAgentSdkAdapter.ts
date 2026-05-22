import { settingsService } from '../../../settings/SettingsService';
import type { AgentRunRequest, AgentRunResult, AgentSdkAdapter, AgentToolPort } from '../AgentRunnerPort';
import {
  buildAgentRunTrace,
  createToolPolicyDeniedResult,
  formatToolResult,
  prepareAgentTools,
  toolMatchesPolicy,
} from '../AgentToolPolicy';

type OpenAiAgentsModule = {
  Agent: new (config: Record<string, unknown>) => unknown;
  Runner: new (config?: Record<string, unknown>) => {
    run: (agent: unknown, input: string, options?: Record<string, unknown>) => Promise<unknown>;
  };
  run: (agent: unknown, input: string, options?: Record<string, unknown>) => Promise<unknown>;
  setDefaultOpenAIKey?: (apiKey: string) => void;
  setDefaultOpenAIClient?: (client: unknown) => void;
  setOpenAIAPI?: (value: 'chat_completions' | 'responses') => void;
  tool: (options: Record<string, unknown>) => unknown;
};

function readFinalOutput(result: unknown): string {
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;
    for (const key of ['finalOutput', 'output', 'text']) {
      const value = record[key];
      if (typeof value === 'string') {
        return value;
      }
    }
  }
  return typeof result === 'string' ? result : JSON.stringify(result);
}

export class OpenAiAgentSdkAdapter implements AgentSdkAdapter {
  readonly id = 'openai-agents-sdk';

  canRun(request: AgentRunRequest): boolean {
    const settings = settingsService.getAll();
    const provider = settings.llm.providers.find((entry) => entry.id === request.providerId);
    return provider?.authMode !== 'account' && (provider?.id === 'openai' || provider?.kind === 'openai-compatible');
  }

  async run(request: AgentRunRequest, tools: AgentToolPort): Promise<AgentRunResult> {
    const settings = settingsService.getAll();
    const provider = settings.llm.providers.find((entry) => entry.id === request.providerId);
    if (!provider) {
      throw new Error(`OpenAI provider not found: ${request.providerId}`);
    }
    const apiKey = settingsService.getProviderSecret(provider.id, settings.workspace.rootPath);
    if (!apiKey) {
      throw new Error(`OpenAI provider secret is missing: ${provider.id}`);
    }

    const sdk = await import('@openai/agents') as unknown as OpenAiAgentsModule;
    sdk.setDefaultOpenAIKey?.(apiKey);
    const tracingDisabled = provider.id !== 'openai';
    const traceId = `rdc-agent-${request.runId || request.turnId || Date.now().toString(36)}`;
    const workflowName = 'RDC Agent SDK Runner';
    if (provider.baseUrl || provider.id !== 'openai') {
      const { default: OpenAI } = await import('openai') as unknown as {
        default: new (config: Record<string, unknown>) => unknown;
      };
      sdk.setDefaultOpenAIClient?.(new OpenAI({
        apiKey,
        baseURL: provider.baseUrl,
      }));
      sdk.setOpenAIAPI?.(provider.id === 'openai' ? 'responses' : 'chat_completions');
    }
    const toolResults: AgentRunResult['toolResults'] = [];
    const preparedTools = prepareAgentTools(await tools.listTools(request.agentId), request.toolAllowlist);
    const openAiTools = preparedTools.map((tool) => sdk.tool({
      name: tool.sdkName,
      description: `${tool.definition.description}\n\nRDC tool: ${tool.originalName}`,
      parameters: tool.parameters,
      strict: false,
      needsApproval: false,
      execute: async (input: unknown) => {
        const args = input && typeof input === 'object'
          ? input as Record<string, unknown>
          : {};
        if (!toolMatchesPolicy(tool.originalName, request.toolAllowlist)) {
          const result = createToolPolicyDeniedResult(
            tool.originalName,
            `Tool ${tool.originalName} is not allowed by RDC DebuggerRuntime policy.`,
          );
          toolResults.push({
            toolName: tool.originalName,
            result,
          });
          return formatToolResult(result);
        }
        const result = await tools.execute({
          toolName: tool.originalName,
          args,
          runId: request.runId,
          turnId: request.turnId,
          contextId: request.sessionId,
          runtimeOwner: request.agentId,
          signal: request.signal,
        });
        toolResults.push({
          toolName: tool.originalName,
          result,
        });
        return formatToolResult(result);
      },
    }));

    const agent = new sdk.Agent({
      name: request.agentId,
      instructions: request.systemPrompt,
      model: request.modelId,
      modelSettings: {
        temperature: request.temperature,
        maxTokens: request.maxTokens,
      },
      tools: openAiTools,
    });
    const runner = new sdk.Runner({
      tracingDisabled,
      traceIncludeSensitiveData: false,
      workflowName,
      traceId,
      groupId: request.sessionId || request.runId || undefined,
      traceMetadata: {
        adapter: this.id,
        agentId: request.agentId,
        providerId: request.providerId,
        modelId: request.modelId,
        stage: request.stage || 'stage',
      },
    });
    const result = await runner.run(agent, request.prompt, {
      signal: request.signal,
    });
    const text = readFinalOutput(result);
    request.onChunk?.(text);

    return {
      agentId: request.agentId,
      providerId: request.providerId,
      modelId: request.modelId,
      text,
      toolResults,
      trace: buildAgentRunTrace({
        adapter: this.id,
        request,
        providerKind: provider.kind,
        preparedTools,
        policy: {
          tracingDisabled,
          traceIncludeSensitiveData: false,
        },
        guardrails: [
          {
            name: 'rdc-tool-allowlist',
            scope: 'tool-input',
            status: 'enforced',
          },
          {
            name: 'rdc-tool-result-summary',
            scope: 'tool-output',
            status: 'enforced',
          },
          {
            name: 'external-openai-tracing',
            scope: 'sdk-tracing',
            status: tracingDisabled ? 'disabled' : 'available',
            reason: tracingDisabled ? 'non_openai_provider' : 'official_openai_provider',
          },
        ],
        sdkTrace: {
          workflowName,
          traceId,
          externalExport: !tracingDisabled,
          resultKeys: result && typeof result === 'object' ? Object.keys(result as Record<string, unknown>) : [],
        },
      }),
    };
  }
}
