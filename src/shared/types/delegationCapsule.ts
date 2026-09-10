/** Caller-authored delegation data. Capability requests never grant authority. */
import { z } from 'zod';
import { parseSessionArtifactUri } from './sessionArtifact';
import { REASONING_SELECTIONS } from './modelCapability';
export const DELEGATION_CAPSULE_ERROR = 'DELEGATION_CAPSULE_INVALID';
export const DELEGATION_CAPSULE_MAX_CHARS = 24_000;
const text = z.string().trim().min(1).max(4_000);
const texts = z.array(text).max(32);
const ref = text.refine(value => { try { parseSessionArtifactUri(value); return true; } catch { return false; } }, 'invalid session artifact URI');
const refs = z.array(ref).max(32);
export const DelegationCapsuleSchema = z.object({
  goal: text, task: text, scope: text,
  acceptedFacts: z.array(z.object({ statement: text, sourceRefs: refs, qualification: text }).strict()).max(32),
  hypotheses: texts, challengeRefs: refs,
  negativePaths: z.array(z.object({ path: text, reason: text, applicableWhen: text, recheckWhen: text }).strict()).max(32),
  inputArtifactRefs: refs, outputRequirements: text, stopConditions: texts,
  requiredSkillIds: texts,
  budget: z.object({ maxToolCalls: z.number().int().positive(), maxWallTimeMs: z.number().int().positive(), maxSubagents: z.number().int().nonnegative().optional() }).strict(),
  domainExtensions: z.record(z.string(), z.record(z.string(), z.boolean())).optional(),
  profile: text.optional(), model: text.optional(), reasoningLevel: z.enum(REASONING_SELECTIONS).optional(),
}).strict();
export type DelegationCapsule = z.infer<typeof DelegationCapsuleSchema>;
export type DelegationCapsuleBudget = DelegationCapsule['budget'];
export function parseDelegationCapsule(input: unknown): DelegationCapsule {
  const parsed = DelegationCapsuleSchema.safeParse(input);
  if (!parsed.success) throw new Error(`${DELEGATION_CAPSULE_ERROR}: ${parsed.error.message}`);
  if (JSON.stringify(parsed.data).length > DELEGATION_CAPSULE_MAX_CHARS) {
    throw new Error(`${DELEGATION_CAPSULE_ERROR}: capsule exceeds ${DELEGATION_CAPSULE_MAX_CHARS} characters; externalize raw material and pass artifact refs.`);
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
const stringSchema = { type: 'string', minLength: 1, maxLength: 4000 };
const arraySchema = { type: 'array', maxItems: 32, items: stringSchema };
const refsSchema = { ...arraySchema, description: 'Existing session:// artifact URIs only; not prose, IDs or hashes. Use [] when none exist.' };
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const DELEGATION_CAPSULE_JSON_SCHEMA = {
  ...object({
    goal: stringSchema, task: stringSchema, scope: stringSchema,
    acceptedFacts: { type: 'array', maxItems: 32, items: object({ statement: stringSchema, sourceRefs: refsSchema, qualification: stringSchema }) },
    hypotheses: arraySchema, challengeRefs: refsSchema,
    negativePaths: { type: 'array', maxItems: 32, items: object({ path: stringSchema, reason: stringSchema, applicableWhen: stringSchema, recheckWhen: stringSchema }) },
    inputArtifactRefs: refsSchema, outputRequirements: stringSchema, stopConditions: arraySchema, requiredSkillIds: arraySchema,
    budget: { type: 'object', required: ['maxToolCalls', 'maxWallTimeMs'], additionalProperties: false, properties: {
      maxToolCalls: { type: 'integer', minimum: 1 }, maxWallTimeMs: { type: 'integer', minimum: 1 }, maxSubagents: { type: 'integer', minimum: 0 },
    } },
    domainExtensions: { type: 'object', description: 'Domain capability requests; no authorization is granted.' },
    reasoningLevel: { type: 'string', enum: REASONING_SELECTIONS, description: 'Optional reasoning selection such as low; validated by the selected Provider route. Never an agent identity.' },
    profile: { ...stringSchema, description: 'Agent identity ID, e.g. general; omit to use the calling identity. This is not reasoning effort or model name.' }, model: { ...stringSchema, description: 'Optional canonical providerId:modelId. Use reasoningLevel for effort; do not put effort in profile.' },
  }),
  required: ['goal', 'task', 'scope', 'acceptedFacts', 'hypotheses', 'challengeRefs', 'negativePaths', 'inputArtifactRefs', 'outputRequirements', 'stopConditions', 'requiredSkillIds', 'budget'],
};
