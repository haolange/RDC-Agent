import { z } from 'zod';
import { parseSessionArtifactUri } from '../../sessions/artifacts/sessionArtifactContract';

/** Caller-authored delegation data. Capability requests never grant authority. */
const text = z.string().trim().min(1).max(4_000);

const texts = z.array(text).max(32);

const ref = text.refine((value) => {
  try {
    parseSessionArtifactUri(value);
    return true;
  } catch {
    return false;
  }
}, 'invalid session artifact URI');

const refs = z.array(ref).max(32);

export const DelegationCapsuleSchema = z
  .object({
    goal: text,
    task: text,
    scope: text,
    acceptedFacts: z.array(z.object({ statement: text, sourceRefs: refs, qualification: text }).strict()).max(32),
    hypotheses: texts,
    challengeRefs: refs,
    negativePaths: z
      .array(z.object({ path: text, reason: text, applicableWhen: text, recheckWhen: text }).strict())
      .max(32),
    inputArtifactRefs: refs,
    outputRequirements: text,
    stopConditions: texts,
    requiredSkillIds: texts,
    budget: z
      .object({
        maxToolCalls: z.number().int().positive().optional(),
        maxWallTimeMs: z.number().int().positive().optional(),
        maxSubagents: z.number().int().nonnegative().optional(),
      })
      .strict()
      .default({}),
    domainExtensions: z.record(z.string(), z.record(z.string(), z.boolean())).optional(),
    profile: text.optional(),
  })
  .strict();

export type DelegationCapsule = z.infer<typeof DelegationCapsuleSchema>;

export const DELEGATION_CAPSULE_ERROR = 'DELEGATION_CAPSULE_INVALID';

export const DELEGATION_CAPSULE_MAX_CHARS = 24_000;

export type DelegationCapsuleBudget = DelegationCapsule['budget'];

export function parseDelegationCapsule(input: unknown): DelegationCapsule {
  const parsed = DelegationCapsuleSchema.safeParse(input);
  if (!parsed.success) throw new Error(`${DELEGATION_CAPSULE_ERROR}: ${parsed.error.message}`);
  if (JSON.stringify(parsed.data).length > DELEGATION_CAPSULE_MAX_CHARS) {
    throw new Error(
      `${DELEGATION_CAPSULE_ERROR}: capsule exceeds ${DELEGATION_CAPSULE_MAX_CHARS} characters; externalize raw material and pass artifact refs.`,
    );
  }
  return freezeDelegationCapsule(parsed.data);
}

export function freezeDelegationCapsule(capsule: DelegationCapsule): DelegationCapsule {
  function freeze(value: unknown): void {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  const copy = structuredClone(capsule);
  freeze(copy);
  return copy;
}
