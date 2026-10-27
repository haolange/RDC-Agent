import { z } from 'zod';

/** Read-only dependency explanation, never a lifecycle state or execution grant. */
export interface TaskDependencyWait {
  taskId: string;
  title?: string;
  reason: 'unfinished' | 'unverified' | 'missing';
}

const id = z.string().trim().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/);

/** Caller-declared constraints, never an execution proof or permission grant. */
export const TaskExecutionRequirementsSchema = z.object({
  mode: z.enum(['direct', 'subagent']),
  requiredSkillIds: z.array(id).max(32).default([]),
  independentOfTaskIds: z.array(id).max(32).default([]),
}).strict().superRefine((value, context) => {
  if (value.independentOfTaskIds.length && value.mode !== 'subagent') {
    context.addIssue({ code: 'custom', message: 'Independent work requires subagent execution.' });
  }
});
export type TaskExecutionRequirements = z.infer<typeof TaskExecutionRequirementsSchema>;

/** Main-owned facts captured from the actually prepared execution. */
export const TaskExecutionPreparationSchema = z.object({
  sessionId: id,
  turnId: id,
  // EffectiveRuntimePlan uses a 24-character SHA-256 prefix, not a content hash.
  runtimeFingerprint: z.string().regex(/^[a-f0-9]{24}$/),
  skills: z.array(z.object({ id, hash }).strict()),
  inputArtifacts: z.array(z.object({ uri: z.string().min(1).max(2048), hash }).strict()),
  selectedTurnCount: z.number().int().nonnegative().nullable(),
  capsuleHash: hash.optional(),
  requestsDomainCapability: z.boolean(),
}).strict();
export type TaskExecutionPreparation = z.infer<typeof TaskExecutionPreparationSchema>;

export const TaskIndependentSourceSchema = z.object({
  taskId: id, executionId: id, generation: z.number().int().positive(), taskRevision: z.number().int().positive(),
}).strict();
export type TaskIndependentSource = z.infer<typeof TaskIndependentSourceSchema>;

export const TASK_EXECUTION_REQUIREMENTS_JSON_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['mode'],
  properties: {
    mode: { type: 'string', enum: ['direct', 'subagent'] },
    requiredSkillIds: { type: 'array', maxItems: 32, items: { type: 'string', minLength: 1, maxLength: 256 } },
    independentOfTaskIds: { type: 'array', maxItems: 32, items: { type: 'string', minLength: 1, maxLength: 256 } },
  },
  description: 'Explicit execution constraints only. requiredSkillIds means methods that must actually be preloaded and frozen before this execution; explain why preparation is necessary in the Task description. Ordinary method guidance belongs in the description and is discovered/read with skill_read before use, not automatically a preload requirement. An empty list is valid. Independent work must use subagent with source Task ids, an isolated Capsule and no shared live domain capability. Constraints never grant permissions.',
};

export const PlanTaskRequirementSchema = z.object({
  taskId: id,
  revision: z.number().int().positive(),
  subject: z.string().min(1),
  description: z.string(),
  blockedBy: z.array(id),
  completionRequirements: z.array(z.string().min(1)),
  executionRequirements: TaskExecutionRequirementsSchema.optional(),
  replacesRevision: z.number().int().positive().optional(),
  previousRequirementHash: hash.optional(),
}).strict();
export type PlanTaskRequirement = z.infer<typeof PlanTaskRequirementSchema>;

export const PlanTaskRevisionSchema = z.object({
  taskId: id, expectedRevision: z.number().int().positive(),
  subject: z.string().trim().min(1).optional(), description: z.string().optional(),
  completionRequirements: z.array(z.string().min(1)).max(64).optional(),
  executionRequirements: TaskExecutionRequirementsSchema.optional(),
}).strict();
export type PlanTaskRevision = z.infer<typeof PlanTaskRevisionSchema>;

export const PlanTaskRequirementsSchema = z.object({
  schemaVersion: z.literal(1),
  tasks: z.array(PlanTaskRequirementSchema).min(1).max(128),
}).strict().superRefine((snapshot, context) => {
  for (const task of snapshot.tasks) {
    if ((task.replacesRevision !== undefined) !== (task.previousRequirementHash !== undefined)
      || (task.replacesRevision !== undefined && task.revision !== task.replacesRevision + 1)) {
      context.addIssue({ code: 'custom', message: 'A proposed Task revision must carry its prior revision/hash and advance exactly once.' });
    }
  }
});

export const PLAN_TASK_REQUIREMENTS_HEADING = '## Task execution requirements';

export function renderPlanTaskRequirements(tasks: PlanTaskRequirement[]): string {
  const snapshot = PlanTaskRequirementsSchema.parse({ schemaVersion: 1, tasks });
  return `${PLAN_TASK_REQUIREMENTS_HEADING}\n\n\`\`\`json\n${JSON.stringify(snapshot, null, 2)}\n\`\`\`\n`;
}

/** Read only the main-generated terminal section; prose is never interpreted as constraints. */
export function parsePlanTaskRequirements(markdown: string): PlanTaskRequirement[] {
  const marker = `${PLAN_TASK_REQUIREMENTS_HEADING}\n\n\`\`\`json\n`;
  const headings = [...markdown.matchAll(/^## Task execution requirements[^\n]*$/gm)];
  if (!headings.length) return [];
  const index = headings[0].index!;
  if (!markdown.startsWith(marker, index) || headings.length !== 1) {
    throw new Error('PLAN_TASK_REQUIREMENTS_INVALID: malformed or duplicate task contract section.');
  }
  const tail = markdown.slice(index + marker.length);
  const end = tail.lastIndexOf('\n```');
  if (end < 0 || tail.slice(end + 4).trim()) throw new Error('PLAN_TASK_REQUIREMENTS_INVALID: task contract must terminate the plan.');
  const parsed = PlanTaskRequirementsSchema.parse(JSON.parse(tail.slice(0, end)));
  if (new Set(parsed.tasks.map(task => task.taskId)).size !== parsed.tasks.length) {
    throw new Error('PLAN_TASK_REQUIREMENTS_INVALID: duplicate Task ids.');
  }
  return parsed.tasks;
}
