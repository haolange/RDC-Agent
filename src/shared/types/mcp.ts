/**
 * MCP (Model Context Protocol) 相关类型定义
 */

/** MCP 传输类型 */
export const MCP_TRANSPORTS = ['stdio', 'streamable-http'] as const;
export type MCPTransport = (typeof MCP_TRANSPORTS)[number];

/**
 * MCP 连接状态。
 * `unknown`：已配置但运行时尚未尝试连接（仪表盘 / mcp 目录工具用）。
 */
export type MCPConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'unknown';

/** MCP Server 配置 */
export interface MCPServerConfig {
  id: string;
  name: string;
  transport: MCPTransport;
  /** stdio 模式的命令 */
  command?: string;
  args?: string[];
  /** HTTP 模式的 URL */
  url?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 自动连接 */
  autoConnect?: boolean;
}

/** MCP 工具定义（远程） */
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
  serverName: string;
}

/** MCP 工具调用结果 */
export interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

/** MCP 连接信息 */
export interface MCPConnectionInfo {
  serverId: string;
  serverName: string;
  status: MCPConnectionStatus;
  tools: MCPToolDefinition[];
  connectedAt?: string;
  error?: string;
}

/**
 * MCP 服务器运行时状态摘要。
 * 供 mcp 目录工具与前端 MCP 仪表盘共用（Phase 2 IPC 复用）。
 */
export interface MCPServerStatusSummary {
  id: string;
  name: string;
  connectionStatus: MCPConnectionStatus;
  toolCount: number;
  lastError?: string;
  /** 工具短名称列表（不含 mcp__ 前缀） */
  tools?: string[];
}
