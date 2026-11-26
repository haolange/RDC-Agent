/** A tool call the model requested: the one call shape main's loop and the shared runtime events use. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
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

type ToolRuntimeSource = 'configured' | 'unconfigured';

export interface ToolRuntimeMetadata {
  source: ToolRuntimeSource;
  command: string;
  workingDirectory: string;
  intermediateRoot: string;
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
