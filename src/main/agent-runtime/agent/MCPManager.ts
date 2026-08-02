/**
 * MCPManager — Model Context Protocol 连接与工具管理。
 *
 * 该模块负责：
 *  - 通过 stdio（子进程）或 http 连接 MCP 服务器；
 *  - 调用 `tools/list` 发现工具，统一加 `mcp__{server}__{tool}` 前缀；
 *  - 把发现的工具暴露为 ToolDefinition / AgentTool 供 agent 使用；
 *  - 通过 `tools/call` 执行工具调用并把结果归一化为 AgentToolResult。
 *
 * 通信使用 JSON-RPC 2.0：
 *  - stdio 模式采用 NDJSON（逐行 JSON）框架；
 *  - http 模式采用单次 POST 提交并读取响应体。
 *
 * 本模块只提供基础框架，未实现 LSP 风格的 Content-Length 框架；
 * 上层若接入特定 MCP 服务器有特殊框架需求，可以在此基础上扩展。
 */

import type { ChildProcess } from 'child_process';

import type { MCPConnectionStatus, MCPServerStatusSummary } from '@shared/types/mcp';
import type {
  ImageContent,
  JsonSchema,
  TextContent,
  ToolDefinition,
} from '../core/types';
import { AgentTool, type AgentToolResult } from './AgentTool';
import {
  processSupervisor,
  type SupervisedProcess,
} from '../../runtime/ProcessSupervisor';
import {
  MAX_MCP_BUFFER_BYTES,
  parseJsonRpcResponse,
  readBoundedResponseBody,
  SseRpcClient,
  StdioRpcClient,
} from './mcpRpcTransport';

const MCP_ENV_ALLOWLIST = [
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'COMSPEC',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
] as const;

function buildSparseMcpEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of MCP_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (key.trim()) {
      env[key] = value;
    }
  }
  return env;
}

// =====================================================================
// 类型定义
// =====================================================================

/** MCP 服务器配置。 */
export interface MCPServerConfig {
  /** 服务器名称标识。 */
  name: string;
  /** 连接类型。 */
  type: 'stdio' | 'http' | 'sse' | 'streamable-http';
  /** stdio: 命令。 */
  command?: string;
  /** stdio: 命令参数。 */
  args?: string[];
  env?: Record<string, string>;
  /** http/sse/streamable-http: 端点 URL。 */
  url?: string;
  /** 调用超时（毫秒），默认 30s。 */
  timeoutMs?: number;
}

/** MCP 发现的工具描述。 */
export interface MCPDiscoveredTool {
  serverName: string;
  originalName: string;
  /** 带前缀的名称：mcp__{server}__{tool}。 */
  prefixedName: string;
  description: string;
  inputSchema: JsonSchema;
}

/** 内部连接对象。 */
interface MCPConnection {
  config: MCPServerConfig;
  tools: MCPDiscoveredTool[];
  /** stdio 模式下的子进程。 */
  process?: ChildProcess;
  /** ProcessSupervisor 句柄（stdio）。 */
  supervised?: SupervisedProcess;
  /** stdio 模式下的 RPC 客户端。 */
  rpc?: StdioRpcClient;
  /** sse 模式下的 RPC 客户端。 */
  rpcSse?: SseRpcClient;
}

// =====================================================================
// AgentTool 适配
// =====================================================================

class MCPAgentTool implements AgentTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly permissionHint = 'mutation' as const;

  constructor(
    private readonly manager: MCPManager,
    tool: MCPDiscoveredTool,
  ) {
    this.name = tool.prefixedName;
    this.description = tool.description;
    this.parameters = tool.inputSchema;
  }

  async execute(_toolCallId: string, args: Record<string, unknown>): Promise<AgentToolResult> {
    return this.manager.executeTool(this.name, args);
  }
}

// =====================================================================
// MCPManager
// =====================================================================

const DEFAULT_TIMEOUT_MS = 30_000;

/** 把任意名称规范化为可作为 LLM 工具名的形式：仅保留 a-zA-Z0-9_-。 */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** 构造前缀工具名：mcp__{server}__{tool}。 */
function buildPrefixedName(serverName: string, toolName: string): string {
  return `mcp__${sanitizeName(serverName)}__${sanitizeName(toolName)}`;
}

/**
 * MCP 管理器。
 *
 * 同一个实例可以并发管理多个 server；所有发现的工具按 prefixedName 注册到全局表。
 */
export class MCPManager {
  private connections = new Map<string, MCPConnection>();
  private discoveredTools = new Map<string, MCPDiscoveredTool>();
  /** 连接生命周期状态（含失败/断开），供目录工具与仪表盘复用。 */
  private serverStatuses = new Map<string, {
    name: string;
    connectionStatus: MCPConnectionStatus;
    lastError?: string;
  }>();

  private recordServerStatus(
    id: string,
    name: string,
    connectionStatus: MCPConnectionStatus,
    lastError?: string,
  ): void {
    if (connectionStatus === 'error') {
      this.serverStatuses.set(id, { name, connectionStatus, lastError });
      return;
    }
    this.serverStatuses.set(id, {
      name,
      connectionStatus,
      ...(lastError ? { lastError } : {}),
    });
  }

  /**
   * 只读：返回当前已知 server 的连接/工具状态摘要。
   * 不触发连接；未出现在本表中的已配置 server 由调用方标为 unknown。
   */
  getServerStatusSummary(): MCPServerStatusSummary[] {
    const ids = new Set<string>([
      ...this.connections.keys(),
      ...this.serverStatuses.keys(),
    ]);
    return Array.from(ids).sort((a, b) => a.localeCompare(b)).map((id) => {
      const conn = this.connections.get(id);
      const status = this.serverStatuses.get(id);
      const name = conn?.config.name ?? status?.name ?? id;
      if (conn) {
        const summary: MCPServerStatusSummary = {
          id,
          name,
          connectionStatus: 'connected',
          toolCount: conn.tools.length,
          tools: conn.tools.map((tool) => tool.originalName),
        };
        if (status?.lastError) {
          summary.lastError = status.lastError;
        }
        return summary;
      }
      const summary: MCPServerStatusSummary = {
        id,
        name,
        connectionStatus: status?.connectionStatus ?? 'unknown',
        toolCount: 0,
        tools: [],
      };
      if (status?.lastError) {
        summary.lastError = status.lastError;
      }
      return summary;
    });
  }

  /** 连接到 MCP 服务器，返回该服务器发现的 prefixedName 列表。 */
  async connect(config: MCPServerConfig): Promise<string[]> {
    if (this.connections.has(config.name)) {
      throw new Error(`MCP server "${config.name}" already connected`);
    }
    this.recordServerStatus(config.name, config.name, 'connecting');
    try {
      const toolNames = await this.connectInternal(config);
      this.recordServerStatus(config.name, config.name, 'connected');
      return toolNames;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.recordServerStatus(config.name, config.name, 'error', message);
      throw err;
    }
  }

  private async connectInternal(config: MCPServerConfig): Promise<string[]> {
    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (config.type === 'stdio') {
      if (!config.command) {
        throw new Error(
          `MCP stdio server "${config.name}" missing command`,
        );
      }
      const supervised = processSupervisor.spawn(
        'mcp',
        config.command,
        config.args ?? [],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: buildSparseMcpEnv(config.env),
          // MCP JSON-RPC 依赖 stdin/stdout；不使用 detached pgid。
          isolateProcessGroup: true,
        },
      );
      const proc = supervised.child;
      if (!proc || !supervised.pid) {
        const exit = await supervised.exit;
        throw exit.error ?? new Error(`MCP stdio server "${config.name}" failed to spawn`);
      }
      proc.stderr?.setEncoding('utf8');
      proc.stderr?.on('data', (chunk: string) => {
        // 把 server 端 stderr 透出到主进程 console，便于排查
        console.warn(`[MCP:${config.name}] ${chunk.trimEnd()}`);
      });

      const rpc = new StdioRpcClient(proc);
      const conn: MCPConnection = {
        config,
        tools: [],
        process: proc,
        supervised,
        rpc,
      };

      try {
        await rpc.request(
          'initialize',
          {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'rdc-agent', version: '0.1.0' },
          },
          timeoutMs,
        );
        rpc.notify('notifications/initialized', {});

        const listResult = (await rpc.request(
          'tools/list',
          {},
          timeoutMs,
        )) as { tools?: Array<Record<string, unknown>> } | undefined;
        const rawTools = Array.isArray(listResult?.tools)
          ? listResult!.tools!
          : [];
        conn.tools = rawTools.map((t) =>
          this.toDiscoveredTool(config.name, t),
        );
      } catch (err) {
        rpc.close();
        supervised.abort('supervisor_kill');
        throw err;
      }

      this.connections.set(config.name, conn);
      this.registerTools(conn.tools);
      return conn.tools.map((t) => t.prefixedName);
    }

    if (config.type === 'http') {
      if (!config.url) {
        throw new Error(`MCP http server "${config.name}" missing url`);
      }
      const conn: MCPConnection = { config, tools: [] };
      await this.httpRpc(
        config.url,
        'initialize',
        {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'rdc-agent', version: '0.1.0' },
        },
        timeoutMs,
      );

      const listResult = (await this.httpRpc(
        config.url,
        'tools/list',
        {},
        timeoutMs,
      )) as { tools?: Array<Record<string, unknown>> } | undefined;
      const rawTools = Array.isArray(listResult?.tools)
        ? listResult!.tools!
        : [];
      conn.tools = rawTools.map((t) =>
        this.toDiscoveredTool(config.name, t),
      );

      this.connections.set(config.name, conn);
      this.registerTools(conn.tools);
      return conn.tools.map((t) => t.prefixedName);
    }

    if (config.type === 'sse') {
      if (!config.url) {
        throw new Error(`MCP sse server "${config.name}" missing url`);
      }
      const sseRpc = new SseRpcClient(config.url);
      const conn: MCPConnection = { config, tools: [], rpcSse: sseRpc };

      try {
        await sseRpc.connect(timeoutMs);
        // SSE 模式：initialization 也通过 POST 发送
        await sseRpc.request(
          'initialize',
          {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'rdc-agent', version: '0.1.0' },
          },
          timeoutMs,
        );
        sseRpc.notify('notifications/initialized', {});

        const listResult = (await sseRpc.request(
          'tools/list',
          {},
          timeoutMs,
        )) as { tools?: Array<Record<string, unknown>> } | undefined;
        const rawTools = Array.isArray(listResult?.tools)
          ? listResult!.tools!
          : [];
        conn.tools = rawTools.map((t) =>
          this.toDiscoveredTool(config.name, t),
        );
      } catch (err) {
        sseRpc.close();
        throw err;
      }

      this.connections.set(config.name, conn);
      this.registerTools(conn.tools);
      return conn.tools.map((t) => t.prefixedName);
    }

    if (config.type === 'streamable-http') {
      if (!config.url) {
        throw new Error(`MCP streamable-http server "${config.name}" missing url`);
      }
      // streamable-http: 使用 POST + streaming response (NDJSON)
      const conn: MCPConnection = { config, tools: [] };
      await this.streamableHttpRpc(
        config.url,
        'initialize',
        {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'rdc-agent', version: '0.1.0' },
        },
        timeoutMs,
      );

      const listResult = (await this.streamableHttpRpc(
        config.url,
        'tools/list',
        {},
        timeoutMs,
      )) as { tools?: Array<Record<string, unknown>> } | undefined;
      const rawTools = Array.isArray(listResult?.tools)
        ? listResult!.tools!
        : [];
      conn.tools = rawTools.map((t) =>
        this.toDiscoveredTool(config.name, t),
      );

      this.connections.set(config.name, conn);
      this.registerTools(conn.tools);
      return conn.tools.map((t) => t.prefixedName);
    }

    throw new Error(`Unsupported MCP transport type: ${String(config.type)}`);
  }

  /** 断开 MCP 服务器。 */
  async disconnect(serverName: string): Promise<void> {
    const conn = this.connections.get(serverName);
    if (!conn) {
      if (this.serverStatuses.has(serverName)) {
        this.recordServerStatus(
          serverName,
          this.serverStatuses.get(serverName)?.name ?? serverName,
          'disconnected',
        );
      }
      return;
    }
    this.connections.delete(serverName);
    for (const t of conn.tools) {
      this.discoveredTools.delete(t.prefixedName);
    }
    if (conn.rpc) {
      conn.rpc.close();
    }
    if (conn.rpcSse) {
      conn.rpcSse.close();
    }
    if (conn.supervised) {
      conn.supervised.abort('supervisor_kill');
    } else if (conn.process) {
      try {
        conn.process.kill();
      } catch {
        // ignore
      }
    }
    this.recordServerStatus(serverName, conn.config.name, 'disconnected');
  }

  /** 断开所有服务器。 */
  async disconnectAll(): Promise<void> {
    const names = Array.from(this.connections.keys());
    await Promise.all(names.map((n) => this.disconnect(n)));
  }

  /** 列出已连接的服务器。 */
  listServers(): string[] {
    return Array.from(this.connections.keys());
  }

  /** 获取所有发现的工具（带 mcp__ 前缀）。 */
  getDiscoveredTools(): MCPDiscoveredTool[] {
    return Array.from(this.discoveredTools.values());
  }

  /** 获取工具定义列表（用于发给 LLM）。 */
  getToolDefinitions(): ToolDefinition[] {
    return this.getDiscoveredTools().map((t) => ({
      name: t.prefixedName,
      description: t.description,
      parameters: t.inputSchema,
    }));
  }

  /** 将发现的工具转换为 AgentTool 实例。 */
  getAgentTools(): AgentTool[] {
    return this.getDiscoveredTools().map(
      (t) => new MCPAgentTool(this, t),
    );
  }

  /** 执行 MCP 工具。 */
  async executeTool(
    prefixedName: string,
    args: Record<string, unknown>,
  ): Promise<AgentToolResult> {
    const parsed = this.parsePrefixedName(prefixedName);
    if (!parsed) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid MCP tool name: ${prefixedName}`,
          },
        ],
        isError: true,
      };
    }
    const conn = this.findConnectionByServer(parsed.serverName);
    if (!conn) {
      return {
        content: [
          {
            type: 'text',
            text: `MCP server "${parsed.serverName}" not connected`,
          },
        ],
        isError: true,
      };
    }
    const tool = conn.tools.find((t) => t.prefixedName === prefixedName);
    if (!tool) {
      return {
        content: [
          {
            type: 'text',
            text: `MCP tool "${prefixedName}" not found on server "${parsed.serverName}"`,
          },
        ],
        isError: true,
      };
    }

    const timeoutMs = conn.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    try {
      let result: unknown;
      if (conn.config.type === 'stdio') {
        if (!conn.rpc) {
          throw new Error('stdio rpc client not initialized');
        }
        result = await conn.rpc.request(
          'tools/call',
          { name: tool.originalName, arguments: args },
          timeoutMs,
        );
      } else if (conn.config.type === 'sse') {
        if (!conn.rpcSse) {
          throw new Error('sse rpc client not initialized');
        }
        result = await conn.rpcSse.request(
          'tools/call',
          { name: tool.originalName, arguments: args },
          timeoutMs,
        );
      } else {
        if (!conn.config.url) {
          throw new Error('server url missing');
        }
        result = await this.httpRpc(
          conn.config.url,
          'tools/call',
          { name: tool.originalName, arguments: args },
          timeoutMs,
        );
      }
      return this.normalizeToolResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `MCP execute error: ${message}` }],
        isError: true,
      };
    }
  }

  /** 检查是否为 MCP 工具（按前缀判断）。 */
  isMCPTool(toolName: string): boolean {
    return toolName.startsWith('mcp__');
  }

  /** 从前缀名称解析服务器和工具名。 */
  parsePrefixedName(
    prefixedName: string,
  ): { serverName: string; toolName: string } | null {
    if (!prefixedName.startsWith('mcp__')) return null;
    const rest = prefixedName.slice('mcp__'.length);
    const sepIdx = rest.indexOf('__');
    if (sepIdx <= 0 || sepIdx === rest.length - 2) return null;
    const serverName = rest.slice(0, sepIdx);
    const toolName = rest.slice(sepIdx + 2);
    if (!serverName || !toolName) return null;
    return { serverName, toolName };
  }

  // -------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------

  private toDiscoveredTool(
    serverName: string,
    raw: Record<string, unknown>,
  ): MCPDiscoveredTool {
    const originalName =
      typeof raw.name === 'string' ? raw.name : 'unnamed_tool';
    const description =
      typeof raw.description === 'string' ? raw.description : '';
    const inputSchema =
      raw.inputSchema && typeof raw.inputSchema === 'object'
        ? (raw.inputSchema as JsonSchema)
        : ({ type: 'object', properties: {} } as JsonSchema);

    return {
      serverName,
      originalName,
      prefixedName: buildPrefixedName(serverName, originalName),
      description,
      inputSchema,
    };
  }

  private registerTools(tools: MCPDiscoveredTool[]): void {
    for (const t of tools) {
      this.discoveredTools.set(t.prefixedName, t);
    }
  }

  /** 从 sanitized server name 反查连接。 */
  private findConnectionByServer(
    sanitizedServerName: string,
  ): MCPConnection | undefined {
    for (const conn of this.connections.values()) {
      if (sanitizeName(conn.config.name) === sanitizedServerName) {
        return conn;
      }
    }
    return undefined;
  }

  /** 把 MCP tools/call 返回结果归一化为 AgentToolResult。 */
  private normalizeToolResult(raw: unknown): AgentToolResult {
    if (!raw || typeof raw !== 'object') {
      return {
        content: [{ type: 'text', text: String(raw ?? '') }],
        isError: false,
      };
    }
    const obj = raw as Record<string, unknown>;
    const isError = obj.isError === true;
    const content: (TextContent | ImageContent)[] = [];
    if (Array.isArray(obj.content)) {
      for (const block of obj.content) {
        if (!block || typeof block !== 'object') continue;
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string') {
          content.push({ type: 'text', text: b.text });
        } else if (
          b.type === 'image' &&
          typeof b.data === 'string' &&
          typeof b.mimeType === 'string'
        ) {
          content.push({
            type: 'image',
            data: b.data,
            mimeType: b.mimeType,
          });
        } else {
          // 未识别的内容块降级为 JSON 文本
          content.push({ type: 'text', text: JSON.stringify(b) });
        }
      }
    }
    if (content.length === 0) {
      content.push({ type: 'text', text: JSON.stringify(obj) });
    }
    return { content, isError };
  }

  /** http 模式下发送 JSON-RPC 请求。 */
  private async httpRpc(
    url: string,
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`MCP HTTP ${res.status} ${res.statusText}`);
      }
      const rawBody = await readBoundedResponseBody(res, MAX_MCP_BUFFER_BYTES);
      const body = parseJsonRpcResponse(rawBody);
      if (!body) {
        throw new Error('MCP HTTP returned invalid JSON-RPC');
      }
      if (body.error) {
        throw new Error(
          `MCP error ${body.error.code}: ${body.error.message}`,
        );
      }
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  }

  /** streamable-http 模式：POST + 流式 NDJSON 响应。 */
  private async streamableHttpRpc(
    url: string,
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`MCP streamable-http ${res.status} ${res.statusText}`);
      }

      // Read the response exactly once. The bounded reader accounts for the
      // cumulative stream size, so a sequence of small NDJSON frames cannot
      // bypass the response cap.
      const rawBody = await readBoundedResponseBody(res, MAX_MCP_BUFFER_BYTES);
      const lines = rawBody.split(/\r?\n/);
      let sawJsonRpcMessage = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const msg = parseJsonRpcResponse(trimmed);
        if (!msg) {
          throw new Error('MCP streamable-http returned invalid JSON-RPC');
        }
        if (msg.error) {
          throw new Error(`MCP error ${msg.error.code}: ${msg.error.message}`);
        }
        if (typeof msg.id === 'number' || typeof msg.id === 'string') {
          sawJsonRpcMessage = true;
          if (msg.id === id) return msg.result;
        }
      }
      if (!sawJsonRpcMessage) {
        throw new Error('MCP streamable-http returned no JSON-RPC response');
      }
      throw new Error('MCP streamable-http response id mismatch');
    } finally {
      clearTimeout(timer);
    }
  }

}
