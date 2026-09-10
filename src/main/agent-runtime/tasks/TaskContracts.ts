export const TASK_SCHEMA_VERSION = 2 as const;

export type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
export type TaskDisposition = 'completed' | 'partial' | 'blocked' | 'cancelled';
export type TaskExecutionStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'cancelling'
  | 'completed'
  | 'partial'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'interrupted';
export type TaskMessageKind = 'progress' | 'blocked' | 'decision_required' | 'result';

export interface TaskCompletionResult {
  disposition: TaskDisposition;
  summary: string;
  outputs: Record<string, string>;
  missingRequirements?: string[];
  error?: string;
  resultRef?: string;
  resultHash?: string;
  evidenceRefs?: Array<{ uri: string; hash: string }>;
  counterevidence?: string[];
  unresolved?: string[];
  scope?: string;
  sideEffects?: string[];
  recoveryState?: string[];
}

export interface TaskBudgetState {
  maxToolCalls?: number;
  toolCalls: number;
  maxSubagents?: number;
  subagents: number;
  maxChildDepth?: number;
  childDepth: number;
  deadlineAt?: number;
  startedAt: number;
}

export interface TaskRecord {
  schemaVersion: typeof TASK_SCHEMA_VERSION;
  id: string;
  subject: string;
  description: string;
  status: TaskStatus;
  statusReason?: string;
  disposition?: TaskDisposition;
  owner?: string;
  parentTaskId?: string;
  blockedBy: string[];
  blocks: string[];
  completionRequirements: string[];
  executionRequired: boolean;
  executionIds: string[];
  currentExecutionId?: string;
  revision: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface TaskExecutionRecord {
  schemaVersion: typeof TASK_SCHEMA_VERSION;
  id: string;
  taskId: string;
  taskRevision: number;
  generation: number;
  /** Process instance that owns this execution. A different value after restart is interrupted, never resumed implicitly. */
  runtimeInstanceId: string;
  parentExecutionId?: string;
  rootBudgetId?: string;
  mode: 'direct' | 'subagent' | 'handoff';
  status: TaskExecutionStatus;
  budget: TaskBudgetState;
  frozenPlanRef?: string;
  childMessageAckSequence: number;
  parentMessageAckSequence: number;
  result?: TaskCompletionResult;
  createdAt: number;
  updatedAt: number;
  settledAt?: number;
}

export interface TaskExecutionMessage {
  schemaVersion: typeof TASK_SCHEMA_VERSION;
  id: string;
  taskId: string;
  executionId: string;
  generation: number;
  sequence: number;
  kind: TaskMessageKind;
  direction: 'to_parent' | 'to_child';
  body: string;
  createdAt: number;
}

export interface StartTaskExecutionOptions {
  mode: TaskExecutionRecord['mode'];
  parentExecutionId?: string;
  rootBudgetId?: string;
  budget?: Partial<Omit<TaskBudgetState, 'startedAt'>>;
  frozenPlanRef?: string;
}

export interface TaskRootBudgetRecord {
  id: string;
  toolCalls: number;
  subagents: number;
  maxToolCalls: number;
  maxSubagents: number;
  maxChildDepth: number;
  deadlineAt: number;
  startedAt: number;
  updatedAt: number;
}

export interface SettleTaskExecutionOptions {
  status: Extract<TaskExecutionStatus, 'completed' | 'partial' | 'blocked' | 'failed' | 'cancelled' | 'interrupted'>;
  result: TaskCompletionResult;
  expectedGeneration: number;
}
