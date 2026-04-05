/**
 * Evidence Types - 证据链相关类型定义
 */

// 事件类型
export type EventType = string;

// 事件状态
export type EventStatus =
  | 'ok'
  | 'error'
  | 'sent'
  | 'pass'
  | 'fail'
  | 'blocked'
  | 'entered'
  | 'warning'
  | 'timeout'
  | 'completed';

// Action事件
export interface ActionEvent {
  schema_version: string;
  event_id: string;
  ts_ms: number;
  run_id: string;
  session_id: string;
  agent_id: string;
  event_type: EventType;
  status: EventStatus;
  duration_ms: number;
  refs: string[];
  payload: Record<string, unknown>;
}

// 证据链间隙
export interface EvidenceGap {
  expectedEventType: EventType;
  afterEventId: string;
  description: string;
}

// 证据链状态
export interface EvidenceChain {
  sessionId: string;
  runId: string;
  events: ActionEvent[];
  isValid: boolean;
  gaps: EvidenceGap[];
  toolExecutionCount: number;
  dispatchCount: number;
  lastUpdated: string;
}

// 运行时字段
export interface RuntimeFields {
  entry_mode: string;
  backend: string;
  context_id: string;
  runtime_owner: string;
  baton_ref: string;
  context_binding_id: string;
  capture_ref: string;
  canonical_anchor_ref: string;
}

// 工具执行记录
export interface ToolExecution {
  toolName: string;
  args: Record<string, unknown>;
  result: ToolResult;
  contextId: string;
  runtimeOwner: string;
  captureRef: string;
  durationMs: number;
  timestamp: number;
}

// 工具结果
export interface ToolResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    category: string;
  };
  artifacts?: Artifact[];
}

// Artifact
export interface Artifact {
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
