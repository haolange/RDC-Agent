/**
 * MCP (Model Context Protocol) 模块入口。
 *
 * @deprecated 旧 MCPClient 仅供历史代码兼容；新 Agent Runtime 一律使用
 * `agent-runtime/agent/MCPManager`，它内置 stdio/sse/http 三种传输、
 * 工具枚举、健康检查与 ToolPermission 集成。
 *
 * 推荐：
 *   import { MCPManager } from '@/main/agent-runtime/agent/MCPManager';
 */

export { MCPClient, MCPConnection } from './MCPClient';
export { mcpClient } from './MCPClientInstance';

// 新一代 MCP 管理器 re-export（推荐使用）。
export { MCPManager } from '../agent-runtime/agent/MCPManager';
