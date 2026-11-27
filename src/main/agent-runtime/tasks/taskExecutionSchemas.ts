import { z } from 'zod';
import type { TaskExecutionRequirementsSchema } from '../../sessions/run/planTaskRequirements';

const id = z.string().trim().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/);

export type TaskExecutionRequirements = z.infer<typeof TaskExecutionRequirementsSchema>;

/** Main-signed transition within one Task execution; preparation remains immutable. */
export const TaskRuntimeEpochSchema = z
  .object({
    previousFingerprint: z.string().regex(/^[a-f0-9]{24}$/),
    runtimeFingerprint: z.string().regex(/^[a-f0-9]{24}$/),
    receipt: z
      .object({ uri: z.string().min(1).max(2048), expectedHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) })
      .strict(),
    recordedAt: z.number().int().nonnegative(),
  })
  .strict();

export type TaskRuntimeEpoch = z.infer<typeof TaskRuntimeEpochSchema>;

export const TaskIndependentSourceSchema = z
  .object({
    taskId: id,
    executionId: id,
    generation: z.number().int().positive(),
    taskRevision: z.number().int().positive(),
    // Historical executions remain readable, but absent provenance cannot satisfy a new review.
    resultRef: z.string().min(1).max(2048).optional(),
    resultHash: hash.optional(),
  })
  .strict();

export type TaskIndependentSource = z.infer<typeof TaskIndependentSourceSchema>;

export const TASK_EXECUTION_REQUIREMENTS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['mode'],
  properties: {
    mode: { type: 'string', enum: ['direct', 'subagent'] },
    profileId: { type: 'string', minLength: 1, maxLength: 256 },
    requiredSkillIds: { type: 'array', maxItems: 32, items: { type: 'string', minLength: 1, maxLength: 256 } },
    independentOfTaskIds: { type: 'array', maxItems: 32, items: { type: 'string', minLength: 1, maxLength: 256 } },
  },
  description:
    'Explicit execution constraints only. requiredSkillIds means methods that must actually be preloaded and frozen before this execution; explain why preparation is necessary in the Task description. Ordinary method guidance belongs in the description and is discovered/read with skill_read before use, not automatically a preload requirement. An empty list is valid. Independent work must use subagent with source Task ids, an isolated Capsule and no shared live domain capability. Each source must first settle with a resultRef; grant that exact resultRef in the Capsule inputArtifactRefs. Constraints never grant permissions.',
};
