/**
 * MCP (Model Context Protocol) 相关类型定义
 */

/** MCP 传输类型 */
export type MCPTransport = 'stdio' | 'sse' | 'streamable-http';

/** MCP 连接状态 */
export type MCPConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** MCP Server 配置 */
export interface MCPServerConfig {
  id: string;
  name: string;
  transport: MCPTransport;
  /** stdio 模式的命令 */
  command?: string;
  args?: string[];
  /** SSE/HTTP 模式的 URL */
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
