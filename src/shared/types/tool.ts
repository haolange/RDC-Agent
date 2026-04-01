/**
 * Tool Types - 工具层相关类型定义
 */

// 工具命名空间
export type ToolNamespace =
  | 'capture'
  | 'session'
  | 'event'
  | 'replay'
  | 'pipeline'
  | 'shader'
  | 'texture'
  | 'resource'
  | 'export'
  | 'remote'
  | 'core'
  | 'macro'
  | 'vfs';

// 工具定义
export interface ToolDefinition {
  name: string;
  namespace: ToolNamespace;
  group: string;
  description: string;
  parameters: ToolParameter[];
  returns: ToolReturn;
  capabilities?: string[];
  prerequisites?: string[];
  live?: boolean;
}

// 工具参数
export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description: string;
  default?: unknown;
  enum?: string[];
}

// 工具返回
export interface ToolReturn {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean';
  description: string;
  schema?: Record<string, unknown>;
}

// 工具调用请求
export interface ToolCallRequest {
  toolName: string;
  args: Record<string, unknown>;
  contextId?: string;
  runtimeOwner?: string;
  captureRef?: string;
}

// 工具调用结果
export interface ToolCallResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    category: string;
    details?: Record<string, unknown>;
  };
  artifacts?: ToolArtifact[];
  duration_ms: number;
  trace_id?: string;
}

// 工具Artifact
export interface ToolArtifact {
  artifact_id: string;
  type: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  path: string;
  url?: string;
  storage_backend: string;
  metadata: Record<string, unknown>;
}

// 工具目录
export interface ToolCatalog {
  schema_version: string;
  tools: ToolDefinition[];
  namespaces: Record<ToolNamespace, {
    description: string;
    groups: string[];
  }>;
}

// CLI执行结果
export interface CLIResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
}

// MCP工具调用
export interface MCPToolCall {
  method: string;
  params: Record<string, unknown>;
}

// MCP响应
export interface MCPResponse {
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}
