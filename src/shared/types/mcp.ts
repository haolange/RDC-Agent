/**
 * MCP (Model Context Protocol) 相关类型定义
 */

/** MCP 传输类型 */
export const MCP_TRANSPORTS = ['stdio', 'streamable-http'] as const;

/**
 * MCP 连接状态。
 * `unknown`：已配置但运行时尚未尝试连接（仪表盘 / mcp 目录工具用）。
 */
export type MCPConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'unknown';

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
  /** Tools the server declared whose input schema could not be compiled; they are not offered to the model. */
  unavailableTools?: Array<{ name: string; reason: string }>;
}
