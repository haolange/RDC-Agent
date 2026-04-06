/**
 * Runtime Log Types - 运行期日志相关类型定义
 */

export type RuntimeLogScope = 'app' | 'session';

export type RuntimeLogNamespace = 'system' | 'agent' | 'tool' | 'device' | 'capture' | 'context' | 'llm';

export type RuntimeLogSeverity = 'info' | 'success' | 'warning' | 'error';

export type RuntimeLogDetailLevel = 'summary' | 'verbose' | 'raw';

export interface RuntimeLogEntry {
  id: string;
  timestamp: number;
  scope: RuntimeLogScope;
  namespace: RuntimeLogNamespace;
  severity: RuntimeLogSeverity;
  title: string;
  summary: string;
  detail?: string;
  sessionId?: string | null;
  projectId?: string | null;
  runId?: string | null;
  raw?: unknown;
}
