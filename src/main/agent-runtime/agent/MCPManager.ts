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

import { spawn, type ChildProcess } from 'child_process';

import type {
  ImageContent,
  JsonSchema,
  TextContent,
  ToolDefinition,
} from '../core/types';
import { AgentTool, type AgentToolResult } from './AgentTool';

// =====================================================================
// 类型定义
// =====================================================================

/** MCP 服务器配置。 */
export interface MCPServerConfig {
  /** 服务器名称标识。 */
  name: string;
  /** 连接类型。 */
  type: 'stdio' | 'http';
  /** stdio: 命令。 */
  command?: string;
  /** stdio: 命令参数。 */
  args?: string[];
  /** http: 端点 URL。 */
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
  /** stdio 模式下的 RPC 客户端。 */
  rpc?: StdioRpcClient;
}

// =====================================================================
// JSON-RPC 客户端（stdio）
// =====================================================================

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  method?: string;
  params?: unknown;
}

class StdioRpcClient {
  private nextId = 1;
  private buffer = '';
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private closed = false;

  constructor(private readonly proc: ChildProcess) {
    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => this.onData(chunk));
    proc.on('exit', () => this.onClose(new Error('MCP process exited')));
    proc.on('error', (err) => this.onClose(err));
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(line) as JsonRpcResponse;
      } catch {
        // 非 JSON 行（一些 server 可能输出诊断日志），跳过
        continue;
      }
      if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
        const entry = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) {
          entry.reject(
            new Error(`MCP error ${msg.error.code}: ${msg.error.message}`),
          );
        } else {
          entry.resolve(msg.result);
        }
      }
      // notifications/服务器主动事件：当前忽略
    }
  }

  private onClose(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) {
      entry.reject(err);
    }
    this.pending.clear();
  }

  /** 发送 JSON-RPC 请求并等待响应。 */
  request(
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error('MCP connection is closed'));
    }
    const id = this.nextId++;
    const payload =
      JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request "${method}" timed out`));
        }
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });

      try {
        this.proc.stdin?.write(payload);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** 发送 JSON-RPC 通知（无响应）。 */
  notify(method: string, params: unknown): void {
    if (this.closed) return;
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    try {
      this.proc.stdin?.write(payload);
    } catch {
      // 通知失败忽略
    }
  }

  close(): void {
    this.onClose(new Error('MCP client closed'));
  }
}

// =====================================================================
// AgentTool 适配
// =====================================================================

class MCPAgentTool implements AgentTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;

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

  /** 连接到 MCP 服务器，返回该服务器发现的 prefixedName 列表。 */
  async connect(config: MCPServerConfig): Promise<string[]> {
    if (this.connections.has(config.name)) {
      throw new Error(`MCP server "${config.name}" already connected`);
    }
    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (config.type === 'stdio') {
      if (!config.command) {
        throw new Error(
          `MCP stdio server "${config.name}" missing command`,
        );
      }
      const proc = spawn(config.command, config.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
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
        try {
          proc.kill();
        } catch {
          // ignore
        }
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

    throw new Error(`Unsupported MCP transport type: ${String(config.type)}`);
  }

  /** 断开 MCP 服务器。 */
  async disconnect(serverName: string): Promise<void> {
    const conn = this.connections.get(serverName);
    if (!conn) return;
    this.connections.delete(serverName);
    for (const t of conn.tools) {
      this.discoveredTools.delete(t.prefixedName);
    }
    if (conn.rpc) {
      conn.rpc.close();
    }
    if (conn.process) {
      try {
        conn.process.kill();
      } catch {
        // ignore
      }
    }
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
      } else {
        if (!conn.config.url) {
          throw new Error('http server url missing');
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
      const body = (await res.json()) as JsonRpcResponse;
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
}
