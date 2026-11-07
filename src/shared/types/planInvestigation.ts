import { z } from 'zod';
import { PLAN_TASK_REQUIREMENTS_HEADING } from './taskExecution';

const id = z.string().trim().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/);

/** Main-generated facts included in the plan the user reviews and approves. */
export const InvestigationPlanContractSchema = z.object({
  schemaVersion: z.literal(1),
  mission: z.enum(['debugger', 'analyzer', 'optimizer']),
  captureScope: z.object({
    projectId: id,
    deviceId: id,
    comparisonGoal: z.string().trim().min(1).max(4000),
    inputs: z.array(z.object({ inputId: id, fileName: z.string().min(1), contentSha256: hash }).strict()).min(1).max(32),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  const inputs = value.captureScope?.inputs ?? [];
  if (new Set(inputs.map(input => input.inputId)).size !== inputs.length) {
    context.addIssue({ code: 'custom', message: 'Capture input IDs must be unique.' });
  }
});
export type InvestigationPlanContract = z.infer<typeof InvestigationPlanContractSchema>;

export const PLAN_INVESTIGATION_HEADING = '## Investigation execution contract';

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
    throw new Error('PLAN_INVESTIGATION_INVALID: malformed or duplicate contract section.');
  }
  const tail = markdown.slice(index + marker.length);
  const end = tail.indexOf('\n```');
  const remaining = end < 0 ? '' : tail.slice(end + 4).trim();
  if (end < 0 || (remaining && !remaining.startsWith(`${PLAN_TASK_REQUIREMENTS_HEADING}\n`))) {
    throw new Error('PLAN_INVESTIGATION_INVALID: contract must precede the Task section or terminate the plan.');
  }
  return InvestigationPlanContractSchema.parse(JSON.parse(tail.slice(0, end)));
}
