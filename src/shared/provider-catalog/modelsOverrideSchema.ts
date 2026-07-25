import { z } from 'zod';

/**
 * Fields that are ALLOWED to be overridden by users.
 *
 * SECURITY BOUNDARY — the following fields are FORBIDDEN to override
 * (enforced by `.strict()` rejecting unknown keys):
 *   route.protocol, authSchemaId, adapterId, endpointClass,
 *   catalogOwnership, compatibilityGroup, artifactFormat, carrier
 */
export const ModelOverrideSchema = z.object({
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  reasoning: z.boolean().optional(),
  input: z.array(z.enum(['text', 'image'])).optional(),
  cost: z.object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cacheRead: z.number().nonnegative().optional(),
    cacheWrite: z.number().nonnegative().optional(),
  }).optional(),
  status: z.enum(['active', 'deprecated']).optional(),
}).strict();

/** Custom model definition — must explicitly declare protocol and adapter. */
export const CustomModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  api: z.string().min(1),
  baseUrl: z.string().url(),
  contextWindow: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
  reasoning: z.boolean().optional().default(false),
  input: z.array(z.enum(['text', 'image'])).optional().default(['text']),
  cost: z.object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cacheRead: z.number().nonnegative().optional(),
    cacheWrite: z.number().nonnegative().optional(),
  }).optional(),
}).strict();

export const ProviderOverrideSchema = z.object({
  baseUrl: z.string().url().optional(),
  modelOverrides: z.record(z.string(), ModelOverrideSchema).optional(),
  models: z.array(CustomModelSchema).optional(),
}).strict();

export const ModelsOverrideSchema = z.object({
  schemaVersion: z.literal(1),
  providers: z.record(z.string(), ProviderOverrideSchema),
}).strict();

export type ModelsOverride = z.infer<typeof ModelsOverrideSchema>;
export type ModelOverride = z.infer<typeof ModelOverrideSchema>;
export type CustomModel = z.infer<typeof CustomModelSchema>;
export type ProviderOverride = z.infer<typeof ProviderOverrideSchema>;
