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
  turnId?: string;
  contextId?: string;
  runtimeOwner?: string;
  ownerLeaseId?: string;
  captureRef?: string;
  runId?: string;
  abortSignal?: AbortSignal;
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
  source_path?: string;
  tool_count?: number;
  generated_at?: string;
  tools: ToolDefinition[];
  namespaces: Record<ToolNamespace, {
    description: string;
    groups: string[];
  }>;
  runtime?: ToolRuntimeMetadata;
}

export type ToolRuntimeSource = 'configured' | 'unconfigured';

export interface ToolRuntimeMetadata {
  source: ToolRuntimeSource;
  command: string;
  workingDirectory: string;
  version: string | null;
  catalog: {
    path: string;
    exists: boolean;
    schemaVersion: string | null;
    generatedAt: string | null;
    toolCount: number | null;
  };
}

// CLI执行结果
export interface ToolRuntimeSummary {
  runtime: ToolRuntimeMetadata;
  cli: {
    available: boolean;
    unavailableReason?: string;
  };
  namespaces: Array<{
    namespace: string;
    toolCount: number;
    available: boolean;
  }>;
}

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

// ============================================
// Tool 分层架构类型
// ============================================

/** 工具层级 */
export type ToolLayer = 'primitive' | 'rdc' | 'system' | 'skill' | 'mcp' | 'ui';

/** 系统工具名称 */
export type SystemToolName =
  | 'fs.read' | 'fs.glob' | 'fs.grep'
  | 'web.fetch' | 'web.search'
  | 'task.create' | 'task.update' | 'task.list';

/** 分层工具定义 */
export interface LayeredToolDefinition extends ToolDefinition {
  layer: ToolLayer;
  /** MCP 来源（仅 layer='mcp' 时有值） */
  mcpServer?: string;
  /** Skill 名称（仅 layer='skill' 时有值） */
  skillName?: string;
}

/** 工具注册表条目 */
export interface ToolRegistryEntry {
  name: string;
  layer: ToolLayer;
  group: string;
  description: string;
  available: boolean;
}

// ============================================
// Tool 追踪类型
// ============================================

/** 工具追踪条目 */
export interface ToolTraceEntry {
  traceId: string;
  turnId?: string;
  toolName: string;
  args: Record<string, unknown>;
  result: ToolCallResult;
  timestamp: number;
  contextId: string;
  runtimeOwner: string;
  ownerLeaseId?: string;
}
