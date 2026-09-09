import { z } from 'zod';

export const HandoffArtifactRefSchema = z.object({
  uri: z.string().min(1), hash: z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/),
}).strict();
export const HandoffContractSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('route') }).strict(),
  z.object({
    intent: z.literal('execute'),
    plan: HandoffArtifactRefSchema,
    requiredSkillIds: z.array(z.string().trim().min(1)).min(1),
    returnTo: z.string().trim().min(1),
    deliveryRequirements: z.string().trim().min(1),
  }).strict(),
  z.object({
    intent: z.literal('return'),
    executionHandoffId: z.string().trim().min(1),
    artifacts: z.array(HandoffArtifactRefSchema).min(1),
  }).strict(),
]);
export type HandoffContract = z.infer<typeof HandoffContractSchema>;
export type HandoffArtifactRef = z.infer<typeof HandoffArtifactRefSchema>;

export const HANDOFF_CONTRACT_JSON_SCHEMA = {
  type: 'object', required: ['intent'], additionalProperties: false,
  properties: {
    intent: { type: 'string', enum: ['route', 'execute', 'return'] },
    plan: { type: 'object', required: ['uri', 'hash'], properties: { uri: { type: 'string' }, hash: { type: 'string' } } },
    requiredSkillIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
    returnTo: { type: 'string' }, deliveryRequirements: { type: 'string' },
    executionHandoffId: { type: 'string' },
    artifacts: { type: 'array', minItems: 1, items: { type: 'object', required: ['uri', 'hash'], properties: { uri: { type: 'string' }, hash: { type: 'string' } } } },
  },
};
