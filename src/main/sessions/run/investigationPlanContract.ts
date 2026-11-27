import { z } from 'zod';
import { AppError } from '@shared/errors/appError';
import {
  PLAN_AUTHORIZATION_MAX_INSTANCES,
  PLAN_AUTHORIZATION_REVERSIBILITY,
  PLAN_INVESTIGATION_HEADING,
  type PlanAuthorization,
} from '@shared/types/planInvestigation';
import { PLAN_TASK_REQUIREMENTS_HEADING } from '@shared/types/taskExecution';

const id = z.string().trim().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/);

/** One approved intervention, frozen with the plan the user reviewed (see `PlanAuthorization`). */
export const PlanAuthorizationSchema: z.ZodType<PlanAuthorization> = z
  .object({
    operation: z.string().regex(/^rd[.][a-z_]+[.][a-z0-9_]+$/),
    target: z
      .object({
        eventId: z.number().int().nonnegative().optional(),
        stage: z.string().trim().min(1).max(32).optional(),
        shaderId: z.string().trim().min(1).max(256).optional(),
      })
      .strict()
      .refine((target) => Object.keys(target).length > 0, 'An authorization names at least one target field.'),
    effect: z.string().regex(/^[a-z_]+$/),
    reversibility: z.enum(PLAN_AUTHORIZATION_REVERSIBILITY),
    maxInstances: z.number().int().min(1).max(PLAN_AUTHORIZATION_MAX_INSTANCES),
  })
  .strict();

/** Main-generated facts included in the plan the user reviews and approves. */
export const InvestigationPlanContractSchema = z
  .object({
    mission: z.enum(['debugger', 'analyzer', 'optimizer']),
    captureScope: z
      .object({
        projectId: id,
        deviceId: id,
        comparisonGoal: z.string().trim().min(1).max(4000),
        inputs: z
          .array(z.object({ inputId: id, fileName: z.string().min(1), contentSha256: hash }).strict())
          .min(1)
          .max(32),
      })
      .strict()
      .optional(),
    authorizations: z.array(PlanAuthorizationSchema).min(1).max(16).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const inputs = value.captureScope?.inputs ?? [];
    if (new Set(inputs.map((input) => input.inputId)).size !== inputs.length) {
      context.addIssue({ code: 'custom', message: 'Capture input IDs must be unique.' });
    }
    if (value.authorizations && !value.captureScope) {
      context.addIssue({ code: 'custom', message: 'Authorized interventions require a capture scope.' });
    }
  });

export type InvestigationPlanContract = z.infer<typeof InvestigationPlanContractSchema>;

export function renderInvestigationPlanContract(input: InvestigationPlanContract): string {
  const contract = InvestigationPlanContractSchema.parse(input);
  return `${PLAN_INVESTIGATION_HEADING}\n\n\`\`\`json\n${JSON.stringify(contract, null, 2)}\n\`\`\`\n`;
}

/** Read only the main-generated section immediately preceding Task obligations, if present. */
export function parseInvestigationPlanContract(markdown: string): InvestigationPlanContract | null {
  const marker = `${PLAN_INVESTIGATION_HEADING}\n\n\`\`\`json\n`;
  const headings = [...markdown.matchAll(/^## Investigation execution contract[^\n]*$/gm)];
  if (!headings.length) return null;
  const index = headings[0]?.index;
  if (index === undefined || headings.length !== 1 || !markdown.startsWith(marker, index)) {
    throw new AppError('PLAN_INVESTIGATION_INVALID', 'malformed or duplicate contract section.');
  }
  const tail = markdown.slice(index + marker.length);
  const end = tail.indexOf('\n```');
  const remaining = end < 0 ? '' : tail.slice(end + 4).trim();
  if (end < 0 || (remaining && !remaining.startsWith(`${PLAN_TASK_REQUIREMENTS_HEADING}\n`))) {
    throw new AppError('PLAN_INVESTIGATION_INVALID', 'contract must precede the Task section or terminate the plan.');
  }
  return InvestigationPlanContractSchema.parse(JSON.parse(tail.slice(0, end)));
}
