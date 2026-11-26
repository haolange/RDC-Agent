import { z } from 'zod';
import { REASONING_SELECTIONS } from './modelCapability';

/** Read-only dependency explanation, never a lifecycle state or execution grant. */
export interface TaskDependencyWait {
  taskId: string;
  title?: string;
  reason: 'unfinished' | 'unverified' | 'missing';
}

/** Lifecycle of one Task execution instance; distinct from the logical Task status. */
export const TASK_EXECUTION_STATUSES = [
  'queued',
  'running',
  'waiting',
  'cancelling',
  'completed',
  'partial',
  'blocked',
  'failed',
  'cancelled',
  'interrupted',
] as const;
export type TaskExecutionStatus = (typeof TASK_EXECUTION_STATUSES)[number];

/** How a subagent execution was dispatched: the parent waited for it, or it runs in the background. */
export type TaskExecutionDispatch = 'wait' | 'background';

const id = z.string().trim().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/);

/** Main-owned facts captured from the actually prepared execution. */
export const TaskExecutionPreparationSchema = z
  .object({
    sessionId: id,
    turnId: id,
    // EffectiveRuntimePlan uses a 24-character SHA-256 prefix, not a content hash.
    runtimeFingerprint: z.string().regex(/^[a-f0-9]{24}$/),
    profileId: id.optional(),
    profileSourceHash: hash.optional(),
    /** Absent on historical records that cannot prove their original source. */
    profileSource: z
      .object({
        scope: z.enum(['builtin', 'user', 'project']),
        path: z.string().min(1),
      })
      .strict()
      .optional(),
    providerId: id.optional(),
    modelId: id.optional(),
    reasoningLevel: z.enum([...REASONING_SELECTIONS, 'unknown']).optional(),
    skills: z.array(z.object({ id, hash }).strict()),
    inputArtifacts: z.array(z.object({ uri: z.string().min(1).max(2048), hash }).strict()),
    selectedTurnCount: z.number().int().nonnegative().nullable(),
    capsuleHash: hash.optional(),
    requestsDomainCapability: z.boolean(),
  })
  .strict();
export type TaskExecutionPreparation = z.infer<typeof TaskExecutionPreparationSchema>;

export const PLAN_TASK_REQUIREMENTS_HEADING = '## Task execution requirements';
