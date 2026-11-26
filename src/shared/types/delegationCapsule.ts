const stringSchema = { type: 'string', minLength: 1, maxLength: 4000 };
const arraySchema = { type: 'array', maxItems: 32, items: stringSchema };
const refsSchema = {
  ...arraySchema,
  description: 'Existing session:// artifact URIs only; not prose, IDs or hashes. Use [] when none exist.',
};
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
export const DELEGATION_CAPSULE_JSON_SCHEMA = {
  ...object({
    goal: stringSchema,
    task: stringSchema,
    scope: stringSchema,
    acceptedFacts: {
      type: 'array',
      maxItems: 32,
      items: object({ statement: stringSchema, sourceRefs: refsSchema, qualification: stringSchema }),
    },
    hypotheses: arraySchema,
    challengeRefs: refsSchema,
    negativePaths: {
      type: 'array',
      maxItems: 32,
      items: object({
        path: stringSchema,
        reason: stringSchema,
        applicableWhen: stringSchema,
        recheckWhen: stringSchema,
      }),
    },
    inputArtifactRefs: {
      ...refsSchema,
      description:
        'Exact existing session:// contentUri values the child must read. Copy them from the parent read/list result, including Investigation records. Artifact IDs mentioned in scope are not read grants. Grant only the needed records.',
    },
    outputRequirements: stringSchema,
    stopConditions: arraySchema,
    requiredSkillIds: arraySchema,
    budget: {
      type: 'object',
      additionalProperties: false,
      properties: {
        maxToolCalls: { type: 'integer', minimum: 1 },
        maxWallTimeMs: { type: 'integer', minimum: 1 },
        maxSubagents: { type: 'integer', minimum: 0 },
      },
    },
    domainExtensions: { type: 'object', description: 'Domain capability requests; no authorization is granted.' },
    profile: {
      ...stringSchema,
      description:
        'Agent identity ID, e.g. general; omit to use the calling identity. Model and reasoning come from that Agent configuration.',
    },
  }),
  required: [
    'goal',
    'task',
    'scope',
    'acceptedFacts',
    'hypotheses',
    'challengeRefs',
    'negativePaths',
    'inputArtifactRefs',
    'outputRequirements',
    'stopConditions',
    'requiredSkillIds',
  ],
};
