import { z } from 'zod';
import { AppError } from '@shared/errors/appError';
import { PLAN_TASK_REQUIREMENTS_HEADING } from '@shared/types/taskExecution';

const id = z.string().trim().min(1).max(256);

const hash = z.string().regex(/^[a-f0-9]{64}$/);

/** Caller-declared constraints, never an execution proof or permission grant. */
export const TaskExecutionRequirementsSchema = z
  .object({
    mode: z.enum(['direct', 'subagent']),
    profileId: id.optional(),
    requiredSkillIds: z.array(id).max(32).default([]),
    independentOfTaskIds: z.array(id).max(32).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.independentOfTaskIds.length && value.mode !== 'subagent') {
      context.addIssue({ code: 'custom', message: 'Independent work requires subagent execution.' });
    }
  });

export const PlanTaskRequirementSchema = z
  .object({
    taskId: id,
    revision: z.number().int().positive(),
    subject: z.string().min(1),
    description: z.string(),
    blockedBy: z.array(id),
    completionRequirements: z.array(z.string().min(1)),
    executionRequirements: TaskExecutionRequirementsSchema.optional(),
    replacesRevision: z.number().int().positive().optional(),
    previousRequirementHash: hash.optional(),
  })
  .strict();

export type PlanTaskRequirement = z.infer<typeof PlanTaskRequirementSchema>;

export const PlanTaskRequirementsSchema = z
  .object({
    tasks: z.array(PlanTaskRequirementSchema).min(1).max(128),
  })
  .strict()
  .superRefine((snapshot, context) => {
    for (const task of snapshot.tasks) {
      if (
        (task.replacesRevision !== undefined) !== (task.previousRequirementHash !== undefined) ||
        (task.replacesRevision !== undefined && task.revision !== task.replacesRevision + 1)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'A proposed Task revision must carry its prior revision/hash and advance exactly once.',
        });
      }
    }
  });

export function renderPlanTaskRequirements(tasks: PlanTaskRequirement[]): string {
  const snapshot = PlanTaskRequirementsSchema.parse({ tasks });
  return `${PLAN_TASK_REQUIREMENTS_HEADING}\n\n\`\`\`json\n${JSON.stringify(snapshot, null, 2)}\n\`\`\`\n`;
}

/** Read only the main-generated terminal section; prose is never interpreted as constraints. */
export function parsePlanTaskRequirements(markdown: string): PlanTaskRequirement[] {
  const marker = `${PLAN_TASK_REQUIREMENTS_HEADING}\n\n\`\`\`json\n`;
  const headings = [...markdown.matchAll(/^## Task execution requirements[^\n]*$/gm)];
  if (!headings.length) return [];
  const heading = headings[0];
  if (!heading || typeof heading.index !== 'number') return [];
  const index = heading.index;
  if (!markdown.startsWith(marker, index) || headings.length !== 1) {
    throw new AppError('PLAN_TASK_REQUIREMENTS_INVALID', 'malformed or duplicate task contract section.');
  }
  const tail = markdown.slice(index + marker.length);
  const end = tail.lastIndexOf('\n```');
  if (end < 0 || tail.slice(end + 4).trim())
    throw new AppError('PLAN_TASK_REQUIREMENTS_INVALID', 'task contract must terminate the plan.');
  const parsed = PlanTaskRequirementsSchema.parse(JSON.parse(tail.slice(0, end)));
  if (new Set(parsed.tasks.map((task) => task.taskId)).size !== parsed.tasks.length) {
    throw new AppError('PLAN_TASK_REQUIREMENTS_INVALID', 'duplicate Task ids.');
  }
  return parsed.tasks;
}
