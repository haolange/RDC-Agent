import { z } from 'zod';

/**
 * The part of a stored delegation task body that the task document shows. Main validated the capsule when it was
 * delegated; this checks only the shape the view reads, so a body that lacks a shown field reads as unavailable
 * instead of failing while rendering.
 */
const shownText = z.string();
const shownTexts = z.array(z.string());
const DelegationTaskViewSchema = z.object({
  capsule: z.object({
    goal: shownText,
    task: shownText,
    scope: shownText,
    outputRequirements: shownText,
    stopConditions: shownTexts,
    hypotheses: shownTexts,
    challengeRefs: shownTexts,
    inputArtifactRefs: shownTexts,
    requiredSkillIds: shownTexts,
    acceptedFacts: z.array(z.object({ statement: shownText, qualification: shownText, sourceRefs: shownTexts })),
    negativePaths: z.array(
      z.object({ path: shownText, reason: shownText, applicableWhen: shownText, recheckWhen: shownText }),
    ),
    budget: z
      .object({
        maxToolCalls: z.number().optional(),
        maxWallTimeMs: z.number().optional(),
        maxSubagents: z.number().optional(),
      })
      .default({}),
    profile: shownText.optional(),
    domainExtensions: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  }),
  completionRequirements: shownTexts,
});

export type DelegationTaskView = z.infer<typeof DelegationTaskViewSchema>;

/** The task body to show, or null when the text is not JSON or lacks a shown field. */
export function parseDelegationTaskView(text: string): DelegationTaskView | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = DelegationTaskViewSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
