import { z, type ZodType } from 'zod';
import { UNRESOLVED_BLOCKERS, type UnresolvedItem } from '@shared/types/unresolvedWork';
import { TASK_EXECUTION_STATUSES, TaskExecutionPreparationSchema } from '@shared/types/taskExecution';
import { TaskExecutionRequirementsSchema } from '../../sessions/run/planTaskRequirements';
import { TaskIndependentSourceSchema, TaskRuntimeEpochSchema } from './taskExecutionSchemas';
import type { ConversationTaskStatus } from '@shared/types/conversation';
import type { TaskExecutionDispatch, TaskExecutionPreparation, TaskExecutionStatus } from '@shared/types/taskExecution';
import type { TaskExecutionRequirements, TaskIndependentSource, TaskRuntimeEpoch } from './taskExecutionSchemas';

export type { TaskExecutionStatus } from '@shared/types/taskExecution';

export const TASK_SCHEMA_VERSION = 2 as const;

export type TaskStatus = ConversationTaskStatus;
export type TaskDisposition = 'completed' | 'partial' | 'blocked' | 'cancelled';
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
  /** Structured items; plain strings only appear in results recorded before items were structured. */
  unresolved?: Array<UnresolvedItem | string>;
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
  executionRequirements?: TaskExecutionRequirements;
  executionRequired: boolean;
  executionIds: string[];
  currentExecutionId?: string;
  revision: number;
  metadata?: Record<string, unknown>;
  /** Runtime-owned identity of the turn that created this logical Task, when known. */
  creationTurnRef?: string;
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
  /** Subagent executions only; absent on records written before dispatch was recorded. */
  dispatch?: TaskExecutionDispatch;
  status: TaskExecutionStatus;
  budget: TaskBudgetState;
  frozenPlanRef?: string;
  preparation?: TaskExecutionPreparation;
  runtimeEpochs?: TaskRuntimeEpoch[];
  independentSources?: TaskIndependentSource[];
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
  dispatch?: TaskExecutionDispatch;
  /** Explicit new-turn continuation of the same goal after cancellation joined. */
  resumeCancelled?: boolean;
  parentExecutionId?: string;
  rootBudgetId?: string;
  budget?: Partial<Omit<TaskBudgetState, 'startedAt'>>;
  frozenPlanRef?: string;
  /** Runtime facts; not exposed in Task tool parameters. */
  preparation?: TaskExecutionPreparation;
  /** Requested preload, checked before dispatch and again against actual preparation. */
  requiredSkillIds?: readonly string[];
  /** Target profile selected for this child execution. */
  requestedProfileId?: string;
  /** Explicit artifact URIs requested by the new delegation; actual grants are checked separately. */
  requestedInputArtifactRefs?: readonly string[];
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

const TaskDispositionSchema = z.enum(['completed', 'partial', 'blocked', 'cancelled']);

const TaskCompletionResultSchema: ZodType<TaskCompletionResult> = z.object({
  disposition: TaskDispositionSchema,
  summary: z.string(),
  outputs: z.record(z.string(), z.string()),
  missingRequirements: z.array(z.string()).optional(),
  error: z.string().optional(),
  resultRef: z.string().optional(),
  resultHash: z.string().optional(),
  evidenceRefs: z.array(z.object({ uri: z.string(), hash: z.string() })).optional(),
  counterevidence: z.array(z.string()).optional(),
  unresolved: z.array(z.union([
    z.string(),
    z.object({ gap: z.string(), attempted: z.string(), blocker: z.enum(UNRESOLVED_BLOCKERS), resumeWhen: z.string() }),
  ])).optional(),
  scope: z.string().optional(),
  sideEffects: z.array(z.string()).optional(),
  recoveryState: z.array(z.string()).optional(),
});

/** Stored Task records as this store writes them; cross-record invariants are checked by the store. */
export const TaskRecordSchema: ZodType<TaskRecord> = z.object({
  schemaVersion: z.literal(TASK_SCHEMA_VERSION),
  id: z.string(),
  subject: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'in_progress', 'blocked', 'completed', 'cancelled']),
  statusReason: z.string().optional(),
  disposition: TaskDispositionSchema.optional(),
  owner: z.string().optional(),
  parentTaskId: z.string().optional(),
  blockedBy: z.array(z.string()),
  blocks: z.array(z.string()),
  completionRequirements: z.array(z.string()),
  executionRequirements: TaskExecutionRequirementsSchema.optional(),
  executionRequired: z.boolean(),
  executionIds: z.array(z.string()),
  currentExecutionId: z.string().optional(),
  revision: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  creationTurnRef: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const TaskExecutionRecordSchema: ZodType<TaskExecutionRecord> = z.object({
  schemaVersion: z.literal(TASK_SCHEMA_VERSION),
  id: z.string(),
  taskId: z.string(),
  taskRevision: z.number(),
  generation: z.number(),
  runtimeInstanceId: z.string(),
  parentExecutionId: z.string().optional(),
  rootBudgetId: z.string().optional(),
  mode: z.enum(['direct', 'subagent', 'handoff']),
  dispatch: z.enum(['wait', 'background']).optional(),
  status: z.enum(TASK_EXECUTION_STATUSES),
  budget: z.object({
    maxToolCalls: z.number().optional(),
    toolCalls: z.number(),
    maxSubagents: z.number().optional(),
    subagents: z.number(),
    maxChildDepth: z.number().optional(),
    childDepth: z.number(),
    deadlineAt: z.number().optional(),
    startedAt: z.number(),
  }),
  frozenPlanRef: z.string().optional(),
  preparation: TaskExecutionPreparationSchema.optional(),
  runtimeEpochs: z.array(TaskRuntimeEpochSchema).optional(),
  independentSources: z.array(TaskIndependentSourceSchema).optional(),
  childMessageAckSequence: z.number(),
  parentMessageAckSequence: z.number(),
  result: TaskCompletionResultSchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  settledAt: z.number().optional(),
});

export const TaskExecutionMessageSchema: ZodType<TaskExecutionMessage> = z.object({
  schemaVersion: z.literal(TASK_SCHEMA_VERSION),
  id: z.string(),
  taskId: z.string(),
  executionId: z.string(),
  generation: z.number(),
  sequence: z.number(),
  kind: z.enum(['progress', 'blocked', 'decision_required', 'result']),
  direction: z.enum(['to_parent', 'to_child']),
  body: z.string(),
  createdAt: z.number(),
});

export const TaskRootBudgetRecordSchema: ZodType<TaskRootBudgetRecord> = z.object({
  id: z.string(),
  toolCalls: z.number(),
  subagents: z.number(),
  maxToolCalls: z.number(),
  maxSubagents: z.number(),
  maxChildDepth: z.number(),
  deadlineAt: z.number(),
  startedAt: z.number(),
  updatedAt: z.number(),
});
