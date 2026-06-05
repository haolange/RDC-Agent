import fs from 'fs';
import path from 'path';
import type { ToolDefinition as LlmToolDefinition, ToolCall } from '@shared/types/llm';
import type { AgentRole } from '@shared/types/agent';
import type { ToolCallResult, ToolRegistryEntry } from '@shared/types/tool';
import { generateEventId, nowMs } from '@shared/utils/id';
import { appPathService } from '../runtime/AppPathService';
import { toolBridge } from '../tools/ToolBridge';
import { skillRegistry } from '../skills/SkillRegistry';
import { mcpClient } from '../mcp/MCPClientInstance';
import { agentRuntimeConfigService } from '../settings/AgentRuntimeConfigService';
import { isRuntimeToolAllowed } from './AgentRuntimeToolPolicy';

export interface RuntimeToolDefinition {
  name: string;
  modelName: string;
  description: string;
  inputSchema: LlmToolDefinition['input_schema'];
  group: string;
  layer: ToolRegistryEntry['layer'];
  readOnly: boolean;
}

export interface RuntimeToolExecutionRequest {
  agentId: AgentRole;
  toolCall: ToolCall;
  originalToolName: string;
  allowlist: string[];
  sessionId?: string | null;
  turnId?: string;
  runId?: string;
  signal?: AbortSignal;
}

const primitiveTool = (
  name: string,
  description: string,
  properties: LlmToolDefinition['input_schema']['properties'] = {},
  required: string[] = [],
  readOnly = true,
): RuntimeToolDefinition => ({
  name,
  modelName: toModelToolName(name),
  description,
  inputSchema: {
    type: 'object',
    properties,
    required,
  },
  group: 'primitive',
  layer: 'primitive',
  readOnly,
});

export function toModelToolName(toolName: string): string {
  return toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export class ToolRegistry {
  async listTools(): Promise<RuntimeToolDefinition[]> {
    const primitiveTools: RuntimeToolDefinition[] = [
      primitiveTool('primitive.read', 'Read a UTF-8 text file from the active workspace.', {
        path: { type: 'string', description: 'Workspace-relative or absolute path.' },
      }, ['path']),
      primitiveTool('primitive.glob', 'List files under the active workspace using a simple glob-like suffix pattern.', {
        pattern: { type: 'string', description: 'Pattern such as **/*.ts or *.json.' },
      }, ['pattern']),
      primitiveTool('primitive.grep', 'Search text files under the active workspace for a literal pattern.', {
        pattern: { type: 'string', description: 'Literal text to search for.' },
      }, ['pattern']),
      primitiveTool('primitive.webFetch', 'Fetch a URL as text through the provider runtime.', {
        url: { type: 'string', description: 'HTTP or HTTPS URL.' },
      }, ['url']),
      primitiveTool('primitive.webSearch', 'Search the web when a search provider is configured.', {
        query: { type: 'string', description: 'Search query.' },
      }, ['query']),
      primitiveTool('primitive.askUser', 'Request clarification from the user through the UI approval channel.', {
        question: { type: 'string', description: 'Question to ask the user.' },
      }, ['question']),
      primitiveTool('primitive.task.list', 'List readonly runtime task descriptors.', {}, []),
      primitiveTool('primitive.bash', 'Run a shell command. Disabled for Ask.', {
        command: { type: 'string', description: 'Command to execute.' },
      }, ['command'], false),
      primitiveTool('primitive.write', 'Write a file. Disabled for Ask.', {
        path: { type: 'string', description: 'Target path.' },
        content: { type: 'string', description: 'File content.' },
      }, ['path', 'content'], false),
      primitiveTool('primitive.edit', 'Edit a file by replacing text. Disabled for Ask.', {
        path: { type: 'string', description: 'Target path.' },
        search: { type: 'string', description: 'Exact text to replace.' },
        replace: { type: 'string', description: 'Replacement text.' },
        replaceAll: { type: 'boolean', description: 'Replace all occurrences instead of the first occurrence.' },
      }, ['path', 'search', 'replace'], false),
      primitiveTool('primitive.remove', 'Remove a file. Disabled for Ask.', {
        path: { type: 'string', description: 'Target path.' },
      }, ['path'], false),
    ];

    const catalog = await toolBridge.loadCatalog();
    const rdcTools: RuntimeToolDefinition[] = (catalog.tools ?? []).map((tool) => ({
      name: tool.name,
      modelName: toModelToolName(tool.name),
      description: tool.description,
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries((tool.parameters ?? []).map((parameter) => [
          parameter.name,
          {
            type: parameter.type,
            description: parameter.description,
            enum: parameter.enum,
          },
        ])),
        required: (tool.parameters ?? []).filter((parameter) => parameter.required).map((parameter) => parameter.name),
      },
      group: tool.group,
      layer: 'rdc',
      readOnly: !tool.name.includes('edit') && !tool.name.includes('write') && !tool.name.includes('remove'),
    }));

    skillRegistry.loadDescriptors(agentRuntimeConfigService.listSkills());
    const skillTools: RuntimeToolDefinition[] = skillRegistry.list().map((skill) => ({
      name: `skill.${skill.name}`,
      modelName: toModelToolName(`skill.${skill.name}`),
      description: skill.description,
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries(skill.parameters.map((parameter) => [
          parameter.name,
          {
            type: parameter.type,
            description: parameter.description,
          },
        ])),
        required: skill.parameters.filter((parameter) => parameter.required).map((parameter) => parameter.name),
      },
      group: 'skill',
      layer: 'skill',
      readOnly: true,
    }));

    const mcpTools: RuntimeToolDefinition[] = mcpClient.getAllConnections().flatMap((connection) =>
      connection.tools.map((tool) => ({
        name: `mcp.${connection.serverId}.${tool.name}`,
        modelName: toModelToolName(`mcp.${connection.serverId}.${tool.name}`),
        description: tool.description,
        inputSchema: normalizeMcpInputSchema(tool.inputSchema),
        group: 'mcp',
        layer: 'mcp',
        readOnly: true,
      })),
    );

    return [...primitiveTools, ...rdcTools, ...skillTools, ...mcpTools];
  }

  async listAllowedLlmTools(agentId: AgentRole, allowlist: string[]): Promise<{
    tools: LlmToolDefinition[];
    nameMap: Map<string, string>;
  }> {
    const runtimeTools = (await this.listTools())
      .filter((tool) => isRuntimeToolAllowed(tool.name, agentId, allowlist));
    const nameMap = new Map<string, string>();
    const tools = runtimeTools.map((tool) => {
      nameMap.set(tool.modelName, tool.name);
      return {
        name: tool.modelName,
        description: `${tool.description}\n\nRuntime tool: ${tool.name}`,
        input_schema: tool.inputSchema,
      };
    });
    return { tools, nameMap };
  }

  async execute(request: RuntimeToolExecutionRequest): Promise<ToolCallResult> {
    const start = nowMs();
    if (!isRuntimeToolAllowed(request.originalToolName, request.agentId, request.allowlist)) {
      return {
        ok: false,
        data: {},
        artifacts: [],
        error: {
          code: 'AGENT_RUNTIME_TOOL_DENIED',
          message: `Tool ${request.originalToolName} is not allowed for ${request.agentId}.`,
          category: 'policy',
        },
        duration_ms: nowMs() - start,
        trace_id: generateEventId('tool'),
      };
    }

    if (request.originalToolName.startsWith('rd.')) {
      return toolBridge.call({
        toolName: request.originalToolName,
        args: request.toolCall.arguments,
        turnId: request.turnId,
        contextId: request.sessionId ?? undefined,
        runId: request.runId,
        runtimeOwner: request.agentId,
        abortSignal: request.signal,
      });
    }

    if (request.originalToolName.startsWith('skill.')) {
      return this.executeSkill(request, start);
    }

    if (request.originalToolName.startsWith('mcp.')) {
      return this.executeMcpTool(request, start);
    }

    return this.executePrimitiveTool(request, start);
  }

  private async executePrimitiveTool(request: RuntimeToolExecutionRequest, start: number): Promise<ToolCallResult> {
    const workspaceRoot = appPathService.getWorkspaceRoot();
    const args = request.toolCall.arguments;
    try {
      if (request.originalToolName === 'primitive.read') {
        const target = resolveWorkspacePath(workspaceRoot, String(args.path ?? ''));
        return okResult({ path: target, content: fs.readFileSync(target, 'utf8') }, start);
      }
      if (request.originalToolName === 'primitive.glob') {
        const pattern = String(args.pattern ?? '');
        return okResult({ files: listWorkspaceFiles(workspaceRoot, pattern).slice(0, 200) }, start);
      }
      if (request.originalToolName === 'primitive.grep') {
        const pattern = String(args.pattern ?? '');
        return okResult({ matches: grepWorkspace(workspaceRoot, pattern).slice(0, 200) }, start);
      }
      if (request.originalToolName === 'primitive.webFetch') {
        const url = String(args.url ?? '');
        const response = await fetch(url, { signal: request.signal });
        return okResult({ url, status: response.status, text: (await response.text()).slice(0, 20000) }, start);
      }
      if (request.originalToolName === 'primitive.webSearch') {
        return errorResult('WEB_SEARCH_PROVIDER_MISSING', 'No web search provider is configured for the local AgentRuntime.', 'configuration', start);
      }
      if (request.originalToolName === 'primitive.askUser') {
        return errorResult('ASK_USER_REQUIRES_APPROVAL_EVENT', 'Ask-user requests are represented as approval.requested events in this runtime build.', 'approval', start);
      }
      if (request.originalToolName === 'primitive.task.list') {
        return okResult({ tasks: [] }, start);
      }
      if (request.originalToolName === 'primitive.bash') {
        return errorResult('BASH_REQUIRES_APPROVAL_EXECUTOR', 'Bash requires an explicit approval/sandbox executor and is disabled by default.', 'approval', start);
      }
      if (request.originalToolName === 'primitive.write') {
        const target = resolveWorkspacePath(workspaceRoot, String(args.path ?? ''));
        const content = String(args.content ?? '');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, 'utf8');
        return okResult({ path: target, bytes: Buffer.byteLength(content, 'utf8') }, start);
      }
      if (request.originalToolName === 'primitive.edit') {
        const target = resolveWorkspacePath(workspaceRoot, String(args.path ?? ''));
        const search = String(args.search ?? '');
        const replace = String(args.replace ?? '');
        if (!search) {
          return errorResult('EDIT_SEARCH_REQUIRED', 'Edit requires a non-empty search string.', 'schema', start);
        }
        const before = fs.readFileSync(target, 'utf8');
        if (!before.includes(search)) {
          return errorResult('EDIT_SEARCH_NOT_FOUND', 'Edit search string was not found.', 'execution', start);
        }
        const after = args.replaceAll === true
          ? before.split(search).join(replace)
          : before.replace(search, replace);
        fs.writeFileSync(target, after, 'utf8');
        return okResult({ path: target, changed: before !== after }, start);
      }
      if (request.originalToolName === 'primitive.remove') {
        const target = resolveWorkspacePath(workspaceRoot, String(args.path ?? ''));
        if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
          return errorResult('REMOVE_DIRECTORY_NOT_SUPPORTED', 'Primitive remove only deletes workspace files, not directories.', 'policy', start);
        }
        fs.rmSync(target, { force: true });
        return okResult({ path: target, removed: true }, start);
      }
      return errorResult('PRIMITIVE_TOOL_NOT_IMPLEMENTED', `Primitive tool is not implemented: ${request.originalToolName}`, 'implementation', start);
    } catch (error) {
      return errorResult('PRIMITIVE_TOOL_FAILED', error instanceof Error ? error.message : String(error), 'execution', start);
    }
  }

  private async executeSkill(request: RuntimeToolExecutionRequest, start: number): Promise<ToolCallResult> {
    const skillName = request.originalToolName.replace(/^skill\./, '');
    const skill = skillRegistry.get(skillName);
    if (!skill) {
      return errorResult('SKILL_NOT_FOUND', `Skill not found: ${skillName}`, 'configuration', start);
    }
    const result = await skill.execute(request.toolCall.arguments, {
      caseId: request.runId ?? '',
      runId: request.runId ?? '',
      sessionId: request.sessionId ?? '',
      agentId: request.agentId,
      workspacePath: appPathService.getWorkspaceRoot(),
    });
    return result.success
      ? okResult({ output: result.output, artifacts: result.artifacts ?? [] }, start)
      : errorResult('SKILL_FAILED', result.error ?? result.output, 'execution', start);
  }

  private async executeMcpTool(request: RuntimeToolExecutionRequest, start: number): Promise<ToolCallResult> {
    const [, serverId, ...toolNameParts] = request.originalToolName.split('.');
    const toolName = toolNameParts.join('.');
    if (!serverId || !toolName) {
      return errorResult('MCP_TOOL_NAME_INVALID', `Invalid MCP tool name: ${request.originalToolName}`, 'configuration', start);
    }
    try {
      const result = await mcpClient.callTool(serverId, toolName, request.toolCall.arguments);
      return okResult({ content: result.content, isError: result.isError ?? false }, start);
    } catch (error) {
      return errorResult('MCP_TOOL_FAILED', error instanceof Error ? error.message : String(error), 'execution', start);
    }
  }
}

function normalizeMcpInputSchema(inputSchema: Record<string, unknown>): LlmToolDefinition['input_schema'] {
  if (inputSchema.type === 'object' && inputSchema.properties && typeof inputSchema.properties === 'object') {
    return inputSchema as LlmToolDefinition['input_schema'];
  }
  return {
    type: 'object',
    properties: {},
  };
}

function okResult(data: Record<string, unknown>, start: number): ToolCallResult {
  return {
    ok: true,
    data,
    artifacts: [],
    duration_ms: nowMs() - start,
    trace_id: generateEventId('tool'),
  };
}

function errorResult(code: string, message: string, category: string, start: number): ToolCallResult {
  return {
    ok: false,
    data: {},
    artifacts: [],
    error: {
      code,
      message,
      category,
    },
    duration_ms: nowMs() - start,
    trace_id: generateEventId('tool'),
  };
}

function resolveWorkspacePath(workspaceRoot: string, inputPath: string): string {
  const target = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(workspaceRoot, inputPath);
  const root = path.resolve(workspaceRoot);
  const rootCompare = process.platform === 'win32' ? root.toLowerCase() : root;
  const targetCompare = process.platform === 'win32' ? target.toLowerCase() : target;
  if (!targetCompare.startsWith(rootCompare)) {
    throw new Error(`Path is outside workspace: ${inputPath}`);
  }
  return target;
}

function listWorkspaceFiles(workspaceRoot: string, pattern: string): string[] {
  const suffix = pattern.replace(/^\*\*\//, '').replace(/^\*/, '');
  const results: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(workspaceRoot, fullPath);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', 'out', 'release'].includes(entry.name)) {
          walk(fullPath);
        }
        continue;
      }
      if (!suffix || relativePath.endsWith(suffix) || entry.name.includes(pattern.replace(/\*/g, ''))) {
        results.push(relativePath);
      }
    }
  };
  walk(workspaceRoot);
  return results;
}

function grepWorkspace(workspaceRoot: string, pattern: string): Array<{ path: string; line: number; text: string }> {
  if (!pattern) {
    return [];
  }
  const matches: Array<{ path: string; line: number; text: string }> = [];
  for (const relativePath of listWorkspaceFiles(workspaceRoot, '*')) {
    const fullPath = path.join(workspaceRoot, relativePath);
    if (!/\.(ts|tsx|js|jsx|json|md|txt|css|html)$/i.test(relativePath)) {
      continue;
    }
    const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/);
    lines.forEach((lineText, index) => {
      if (lineText.includes(pattern)) {
        matches.push({ path: relativePath, line: index + 1, text: lineText.slice(0, 500) });
      }
    });
  }
  return matches;
}

export const toolRegistry = new ToolRegistry();
