/**
 * MCP (Model Context Protocol) 模块
 * 提供 MCP 客户端能力；SDK tool 暴露统一走 DebuggerRuntime 的 ToolBridge adapter。
 */

export { MCPClient, MCPConnection } from './MCPClient';
export { mcpClient } from './MCPClientInstance';
