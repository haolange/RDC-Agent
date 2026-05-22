import { z } from 'zod';
import { settingsService } from '../../../settings/SettingsService';
import type { AgentRunRequest, AgentRunResult, AgentSdkAdapter, AgentToolPort } from '../AgentRunnerPort';
import {
  buildAgentRunTrace,
  createToolPolicyDeniedResult,
  formatToolResult,
  prepareAgentTools,
  summarizeSdkMessages,
  toolMatchesPolicy,
} from '../AgentToolPolicy';
import type { ToolDefinition, ToolParameter } from '@shared/types/tool';

type ClaudeAgentSdkModule = {
  query: (request: Record<string, unknown>) => AsyncIterable<Record<string, unknown>>;
  createSdkMcpServer: (options: Record<string, unknown>) => unknown;
  tool: (name: string, description: string, inputSchema: Record<string, unknown>, handler: (args: Record<string, unknown>) => Promise<unknown>, extras?: Record<string, unknown>) => unknown;
};

const CLAUDE_DENIED_BUILTIN_TOOLS = ['Bash', 'Edit', 'Write', 'Read', 'WebSearch'] as const;
const CLAUDE_PERMISSION_MODE = 'dontAsk';

function zodParameter(parameter: ToolParameter): z.ZodTypeAny {
  let schema: z.ZodTypeAny;
  if (parameter.enum?.length) {
    schema = z.enum(parameter.enum as [string, ...string[]]);
  } else if (parameter.type === 'number') {
    schema = z.number();
  } else if (parameter.type === 'boolean') {
    schema = z.boolean();
  } else if (parameter.type === 'array') {
    schema = z.array(z.unknown());
  } else if (parameter.type === 'object') {
    schema = z.record(z.string(), z.unknown());
  } else {
    schema = z.string();
  }

  if (parameter.description) {
    schema = schema.describe(parameter.description);
  }
  return parameter.required ? schema : schema.optional();
}

function zodRawShape(tool: ToolDefinition): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const parameter of tool.parameters ?? []) {
    shape[parameter.name] = zodParameter(parameter);
  }
  return shape;
}

export class ClaudeAgentSdkAdapter implements AgentSdkAdapter {
  readonly id = 'claude-agent-sdk';

  canRun(request: AgentRunRequest): boolean {
    const settings = settingsService.getAll();
    const provider = settings.llm.providers.find((entry) => entry.id === request.providerId);
    return provider?.authMode !== 'account'
      && (provider?.id === 'anthropic' || provider?.kind === 'anthropic' || provider?.kind === 'openrouter' || provider?.kind === 'bedrock' || provider?.kind === 'vertex');
  }

  async run(request: AgentRunRequest, tools: AgentToolPort): Promise<AgentRunResult> {
    const settings = settingsService.getAll();
    const provider = settings.llm.providers.find((entry) => entry.id === request.providerId);
    if (!provider) {
      throw new Error(`Claude provider not found: ${request.providerId}`);
    }
    const apiKey = provider.authMode === 'api-key'
      ? settingsService.getProviderSecret(provider.id, settings.workspace.rootPath)
      : '';
    if (provider.authMode === 'api-key' && !apiKey) {
      throw new Error(`Claude provider secret is missing: ${provider.id}`);
    }

    const sdk = await import('@anthropic-ai/claude-agent-sdk') as unknown as ClaudeAgentSdkModule;
    const abortController = new AbortController();
    request.signal?.addEventListener('abort', () => abortController.abort(), { once: true });
    const messages: Record<string, unknown>[] = [];
    const toolResults: AgentRunResult['toolResults'] = [];
    let text = '';

    const env = {
      ...process.env,
      ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
      ...(provider.baseUrl ? { ANTHROPIC_BASE_URL: provider.baseUrl } : {}),
      ...(provider.kind === 'bedrock' ? {
        CLAUDE_CODE_USE_BEDROCK: '1',
        AWS_REGION: process.env.AWS_REGION || 'us-east-1',
      } : {}),
      ...(provider.kind === 'vertex' ? {
        CLAUDE_CODE_USE_VERTEX: '1',
        CLOUD_ML_REGION: process.env.CLOUD_ML_REGION || 'us-east5',
      } : {}),
      CLAUDE_AGENT_SDK_CLIENT_APP: 'rdc-agent/1.0.0',
    };
    const preparedTools = prepareAgentTools(await tools.listTools(request.agentId), request.toolAllowlist);
    const allowedMcpToolNames = new Set<string>();
    const sdkTools = preparedTools.map((tool) => {
      allowedMcpToolNames.add(`mcp__rdc__${tool.sdkName}`);
      return sdk.tool(
        tool.sdkName,
        `${tool.definition.description}\n\nRDC tool: ${tool.originalName}`,
        zodRawShape(tool.definition),
        async (args: Record<string, unknown>) => {
          if (!toolMatchesPolicy(tool.originalName, request.toolAllowlist)) {
            const result = createToolPolicyDeniedResult(
              tool.originalName,
              `Tool ${tool.originalName} is not allowed by RDC DebuggerRuntime policy.`,
            );
            toolResults.push({
              toolName: tool.originalName,
              result,
            });
            return {
              content: [{
                type: 'text',
                text: formatToolResult(result),
              }],
              is_error: true,
            };
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
          return {
            content: [{
              type: 'text',
              text: formatToolResult(result),
            }],
            is_error: !result.ok,
          };
        },
        {
          annotations: {
            readOnlyHint: true,
          },
        },
      );
    });
    const rdcMcpServer = sdk.createSdkMcpServer({
      name: 'rdc',
      version: '1.0.0',
      instructions: 'RDC ToolBridge proxy. All tool calls are executed by the deterministic DebuggerRuntime tool layer.',
      tools: sdkTools,
      alwaysLoad: sdkTools.length > 0,
    });

    for await (const message of sdk.query({
      prompt: request.prompt,
      abortController,
      options: {
        model: request.modelId,
        systemPrompt: request.systemPrompt,
        maxTurns: 4,
        tools: [],
        mcpServers: sdkTools.length > 0 ? { rdc: rdcMcpServer } : {},
        allowedTools: Array.from(allowedMcpToolNames),
        canUseTool: async (toolName: string, _input: Record<string, unknown>, options: { toolUseID?: string }) => (
          allowedMcpToolNames.has(toolName)
            ? { behavior: 'allow', toolUseID: options.toolUseID }
            : {
                behavior: 'deny',
                message: `Tool ${toolName} is not allowed by RDC DebuggerRuntime policy.`,
                toolUseID: options.toolUseID,
              }
        ),
        disallowedTools: [...CLAUDE_DENIED_BUILTIN_TOOLS],
        permissionMode: CLAUDE_PERMISSION_MODE,
        env,
      },
    })) {
      messages.push(message);
      if (message.type === 'assistant' && message.message && typeof message.message === 'object') {
        const content = (message.message as { content?: unknown }).content;
        if (Array.isArray(content)) {
          const chunk = content
            .map((entry) => (
              entry && typeof entry === 'object' && typeof (entry as { text?: unknown }).text === 'string'
                ? (entry as { text: string }).text
                : ''
            ))
            .join('');
          if (chunk) {
            text += chunk;
            request.onChunk?.(chunk);
          }
        }
      }
      if (message.type === 'result' && typeof message.result === 'string') {
        text = message.result;
      }
    }

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
          permissionMode: CLAUDE_PERMISSION_MODE,
          allowedTools: Array.from(allowedMcpToolNames),
          disallowedTools: [...CLAUDE_DENIED_BUILTIN_TOOLS],
          builtInTools: 'disabled',
          mcpServers: sdkTools.length > 0 ? ['rdc'] : [],
        },
        guardrails: [
          {
            name: 'claude-builtins-denied',
            scope: 'sdk-tools',
            status: 'enforced',
            deniedTools: [...CLAUDE_DENIED_BUILTIN_TOOLS],
          },
          {
            name: 'claude-mcp-only',
            scope: 'tool-surface',
            status: 'enforced',
            allowedTools: Array.from(allowedMcpToolNames),
          },
          {
            name: 'claude-permission-mode',
            scope: 'permissions',
            status: 'enforced',
            mode: CLAUDE_PERMISSION_MODE,
          },
        ],
        sdkTrace: {
          messageSummary: summarizeSdkMessages(messages),
          messageCount: messages.length,
        },
      }),
    };
  }
}
