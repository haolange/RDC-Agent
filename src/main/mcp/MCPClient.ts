/**
 * MCP (Model Context Protocol) 客户端实现
 * 支持 stdio 和 SSE 传输，使用 JSON-RPC 2.0 协议
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import type {
  MCPServerConfig,
  MCPToolDefinition,
  MCPToolResult,
  MCPConnectionInfo,
  MCPConnectionStatus,
} from '../../shared/types/mcp';

// JSON-RPC 2.0 消息类型
interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

// MCP 初始化参数
interface MCPInitializeParams {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  clientInfo: {
    name: string;
    version: string;
  };
}

// MCP 连接类 - 管理单个 Server 连接
export class MCPConnection extends EventEmitter {
  private config: MCPServerConfig;
  private status: MCPConnectionStatus = 'disconnected';
  private childProcess?: ChildProcess;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private tools: MCPToolDefinition[] = [];
  private connectedAt?: string;
  private error?: string;
  private buffer = '';
  private eventSource?: EventSource;
  private sseEndpoint?: string;

  constructor(config: MCPServerConfig) {
    super();
    this.config = config;
  }

  get serverId(): string {
    return this.config.id;
  }

  get serverName(): string {
    return this.config.name;
  }

  get connectionInfo(): MCPConnectionInfo {
    return {
      serverId: this.config.id,
      serverName: this.config.name,
      status: this.status,
      tools: this.tools,
      connectedAt: this.connectedAt,
      error: this.error,
    };
  }

  /**
   * 建立连接
   */
  async connect(): Promise<MCPConnectionInfo> {
    if (this.status === 'connected' || this.status === 'connecting') {
      return this.connectionInfo;
    }

    this.status = 'connecting';
    this.error = undefined;

    try {
      if (this.config.transport === 'stdio') {
        await this.connectStdio();
      } else if (this.config.transport === 'sse' || this.config.transport === 'streamable-http') {
        await this.connectSSE();
      } else {
        throw new Error(`不支持的传输类型: ${this.config.transport}`);
      }

      // 执行 MCP 握手
      await this.initialize();

      // 获取工具列表
      await this.fetchTools();

      this.status = 'connected';
      this.connectedAt = new Date().toISOString();

      return this.connectionInfo;
    } catch (err) {
      this.status = 'error';
      this.error = err instanceof Error ? err.message : String(err);
      this.cleanup();
      throw err;
    }
  }

  /**
   * stdio 传输连接
   */
  private async connectStdio(): Promise<void> {
    const { command, args = [], env = {} } = this.config;

    if (!command) {
      throw new Error('stdio 传输模式需要指定 command');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('连接超时'));
      }, 30000);

      try {
        this.childProcess = spawn(command, args, {
          env: { ...process.env, ...env },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        if (!this.childProcess.stdin || !this.childProcess.stdout) {
          clearTimeout(timeout);
          reject(new Error('无法创建子进程管道'));
          return;
        }

        // 监听 stdout 数据
        this.childProcess.stdout.on('data', (data: Buffer) => {
          this.handleStdioData(data.toString());
        });

        // 监听 stderr (用于调试)
        this.childProcess.stderr?.on('data', (data: Buffer) => {
          console.error(`[MCP ${this.config.name}] stderr:`, data.toString());
        });

        // 监听进程退出
        this.childProcess.on('exit', (code) => {
          if (code !== 0 && code !== null) {
            this.handleDisconnect(new Error(`进程退出，代码: ${code}`));
          }
        });

        this.childProcess.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        // 等待进程启动
        setTimeout(() => {
          clearTimeout(timeout);
          resolve();
        }, 500);
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  /**
   * SSE 传输连接
   */
  private async connectSSE(): Promise<void> {
    const { url } = this.config;

    if (!url) {
      throw new Error('SSE 传输模式需要指定 url');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('SSE 连接超时'));
      }, 30000);

      try {
        // 首先获取 SSE 端点
        fetch(`${url}/sse`)
          .then((response) => {
            if (!response.ok) {
              throw new Error(`HTTP 错误: ${response.status}`);
            }
            return response.text();
          })
          .then((endpoint) => {
            this.sseEndpoint = endpoint.trim();

            // 创建 EventSource
            this.eventSource = new EventSource(`${url}${this.sseEndpoint}`);

            this.eventSource!.onopen = () => {
              clearTimeout(timeout);
              resolve();
            };

            this.eventSource!.onmessage = (event) => {
              try {
                const message = JSON.parse(event.data) as JSONRPCMessage;
                this.handleMessage(message);
              } catch (err) {
                console.error('[MCP SSE] 解析消息失败:', err);
              }
            };

            this.eventSource!.onerror = () => {
              this.handleDisconnect(new Error('SSE 连接错误'));
            };
          })
          .catch((err) => {
            clearTimeout(timeout);
            reject(err);
          });
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  /**
   * 处理 stdio 数据
   */
  private handleStdioData(data: string): void {
    this.buffer += data;

    // 按行分割处理
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // 保留未完成的行

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed) as JSONRPCMessage;
        this.handleMessage(message);
      } catch (err) {
        console.error('[MCP stdio] 解析消息失败:', trimmed);
      }
    }
  }

  /**
   * 处理 JSON-RPC 消息
   */
  private handleMessage(message: JSONRPCMessage): void {
    // 检查是否是响应消息
    if ('id' in message && message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        if ('error' in message && message.error) {
          pending.reject(new Error(message.error.message));
        } else if ('result' in message) {
          pending.resolve(message.result);
        }
      }
    }

    // 处理通知
    if (!('id' in message)) {
      this.emit('notification', message);
    }
  }

  /**
   * MCP 初始化握手
   */
  private async initialize(): Promise<void> {
    const params: MCPInitializeParams = {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'RDC-Agent',
        version: '1.0.0',
      },
    };

    await this.sendRequest('initialize', params);
    // 发送 initialized 通知
    await this.sendNotification('initialized', {});
  }

  /**
   * 获取工具列表
   */
  private async fetchTools(): Promise<void> {
    const result = await this.sendRequest('tools/list', {}) as { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> };

    if (result && Array.isArray(result.tools)) {
      this.tools = result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        serverId: this.config.id,
        serverName: this.config.name,
      }));
    }
  }

  /**
   * 发送 JSON-RPC 请求
   */
  private async sendRequest(method: string, params: unknown): Promise<unknown> {
    const id = ++this.requestId;
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`请求超时: ${method}`));
      }, 60000);

      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      this.sendMessage(request).catch((err) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(err);
      });
    });
  }

  /**
   * 发送 JSON-RPC 通知
   */
  private async sendNotification(method: string, params: unknown): Promise<void> {
    const notification: JSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    await this.sendMessage(notification);
  }

  /**
   * 发送消息
   */
  private async sendMessage(message: JSONRPCMessage): Promise<void> {
    const data = JSON.stringify(message);

    if (this.config.transport === 'stdio') {
      if (!this.childProcess?.stdin) {
        throw new Error('stdio 连接未建立');
      }
      this.childProcess.stdin.write(data + '\n');
    } else if (this.config.transport === 'sse' || this.config.transport === 'streamable-http') {
      if (!this.config.url) {
        throw new Error('SSE URL 未配置');
      }

      const response = await fetch(`${this.config.url}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: data,
      });

      if (!response.ok) {
        throw new Error(`HTTP 错误: ${response.status}`);
      }
    }
  }

  /**
   * 列出工具
   */
  async listTools(): Promise<MCPToolDefinition[]> {
    if (this.status !== 'connected') {
      throw new Error('未连接到 MCP Server');
    }
    return [...this.tools];
  }

  /**
   * 调用工具
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    if (this.status !== 'connected') {
      throw new Error('未连接到 MCP Server');
    }

    const result = await this.sendRequest('tools/call', {
      name: toolName,
      arguments: args,
    }) as MCPToolResult;

    return result;
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this.cleanup();
    this.status = 'disconnected';
    this.connectedAt = undefined;
    this.error = undefined;
    this.tools = [];
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    // 清理 stdio
    if (this.childProcess) {
      this.childProcess.kill();
      this.childProcess = undefined;
    }

    // 清理 SSE
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = undefined;
    }

    // 拒绝所有待处理的请求
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('连接已断开'));
    }
    this.pendingRequests.clear();

    this.buffer = '';
  }

  /**
   * 处理断开连接
   */
  private handleDisconnect(error: Error): void {
    if (this.status === 'connected' || this.status === 'connecting') {
      this.status = 'error';
      this.error = error.message;
      this.cleanup();
      this.emit('disconnect', error);
    }
  }
}

/**
 * MCP 客户端 - 管理多个 Server 连接
 */
export class MCPClient {
  private connections = new Map<string, MCPConnection>();

  /**
   * 连接到 MCP Server
   */
  async connect(config: MCPServerConfig): Promise<MCPConnectionInfo> {
    // 如果已存在连接，先断开
    const existing = this.connections.get(config.id);
    if (existing) {
      await existing.disconnect();
    }

    const connection = new MCPConnection(config);
    this.connections.set(config.id, connection);

    // 监听断开事件
    connection.on('disconnect', () => {
      this.connections.delete(config.id);
    });

    return await connection.connect();
  }

  /**
   * 断开指定 Server 连接
   */
  async disconnect(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (connection) {
      await connection.disconnect();
      this.connections.delete(serverId);
    }
  }

  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.connections.values()).map((conn) =>
      conn.disconnect()
    );
    await Promise.all(disconnectPromises);
    this.connections.clear();
  }

  /**
   * 列出指定 Server 的工具
   */
  async listTools(serverId: string): Promise<MCPToolDefinition[]> {
    const connection = this.connections.get(serverId);
    if (!connection) {
      throw new Error(`未找到 MCP Server: ${serverId}`);
    }
    return await connection.listTools();
  }

  /**
   * 调用指定 Server 的工具
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<MCPToolResult> {
    const connection = this.connections.get(serverId);
    if (!connection) {
      throw new Error(`未找到 MCP Server: ${serverId}`);
    }
    return await connection.callTool(toolName, args);
  }

  /**
   * 获取连接信息
   */
  getConnectionInfo(serverId: string): MCPConnectionInfo | undefined {
    const connection = this.connections.get(serverId);
    return connection?.connectionInfo;
  }

  /**
   * 获取所有连接信息
   */
  getAllConnections(): MCPConnectionInfo[] {
    return Array.from(this.connections.values()).map((conn) => conn.connectionInfo);
  }
}
