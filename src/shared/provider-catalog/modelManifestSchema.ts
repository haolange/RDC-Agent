import { z } from 'zod';

export type CatalogJsonPrimitive = string | number | boolean | null;
export type CatalogJsonValue = CatalogJsonPrimitive | CatalogJsonValue[] | { [key: string]: CatalogJsonValue };
export type CatalogJsonObject = { [key: string]: CatalogJsonValue };

export const JsonPrimitiveSchema: z.ZodType<CatalogJsonPrimitive> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const JsonValueSchema: z.ZodType<CatalogJsonValue> = z.lazy(() => z.union([
  JsonPrimitiveSchema,
  z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]));

export const JsonObjectSchema: z.ZodType<CatalogJsonObject> = z.record(z.string(), JsonValueSchema);

export const EntitlementStateSchema = z.enum(['granted', 'denied', 'unknown']);
export const EffectiveAvailabilitySchema = z.enum(['available', 'unavailable', 'unknown']);
export const ReasoningSelectionSchema = z.enum([
  'off',
  'on',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);
export const NamedReasoningLevelSchema = z.enum([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

export const ProviderProtocolSchema = z.enum([
  'OpenAICompatibleChatCompletions',
  'OpenAIResponses',
  'AnthropicMessages',
  'OpenRouterChatCompletions',
  'AzureOpenAIChatCompletions',
  'GoogleGemini',
  'GoogleVertexGemini',
  'GoogleVertexAnthropic',
  'GitLabDuo',
  'SapAiCoreOrchestration',
  'SapAiCoreFoundationModels',
  'OllamaOpenAICompatibleChatCompletions',
]);

const OpenAiEffortSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const AnthropicEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
const GeminiThinkingLevelSchema = z.enum(['minimal', 'low', 'medium', 'high']);

export const ReasoningWireProfileSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({
    kind: z.literal('openai-responses'),
    on: NamedReasoningLevelSchema,
    levels: z.partialRecord(NamedReasoningLevelSchema, OpenAiEffortSchema),
  }).strict(),
  z.object({
    kind: z.literal('openai-compatible'),
    on: NamedReasoningLevelSchema,
    levels: z.partialRecord(NamedReasoningLevelSchema, z.string()).optional(),
    onMode: z.enum(['enable-thinking-true', 'thinking-enabled', 'enabled']).optional(),
    offMode: z.enum(['reasoning-none', 'enable-thinking-false', 'thinking-disabled', 'disabled']).optional(),
  }).strict(),
  z.object({
    kind: z.literal('anthropic'),
    on: NamedReasoningLevelSchema,
    levels: z.partialRecord(NamedReasoningLevelSchema, AnthropicEffortSchema).optional(),
    onMode: z.enum(['adaptive', 'enabled']).optional(),
    onBudgetTokens: z.number().int().positive().optional(),
    offMode: z.literal('disabled').optional(),
  }).strict(),
  z.object({
    kind: z.literal('gemini-thinking-level'),
    on: NamedReasoningLevelSchema,
    levels: z.partialRecord(NamedReasoningLevelSchema, GeminiThinkingLevelSchema),
  }).strict(),
  z.object({
    kind: z.literal('gemini-thinking-budget'),
    on: NamedReasoningLevelSchema,
    levels: z.partialRecord(NamedReasoningLevelSchema, z.number().int().nonnegative()),
    offBudget: z.literal(0).optional(),
  }).strict(),
  z.object({
    kind: z.literal('moonshot-thinking'),
    onMode: z.literal('enabled').optional(),
    offMode: z.literal('disabled').optional(),
  }).strict(),
]);

export const ReasoningControlSchema = z.object({
  kind: z.enum(['unknown', 'none', 'toggle', 'levels', 'always-on']),
  supportsOff: z.boolean(),
  levels: z.array(NamedReasoningLevelSchema),
  defaultSelection: ReasoningSelectionSchema.optional(),
  defaultState: z.enum(['known', 'provider-managed', 'unknown']).optional(),
  lockedSelection: ReasoningSelectionSchema.optional(),
  wireProfile: ReasoningWireProfileSchema,
}).strict();

export const CapabilityStateSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('supported') }).strict(),
  z.object({ state: z.literal('unsupported'), reason: z.string().optional() }).strict(),
  z.object({ state: z.literal('unknown') }).strict(),
]);

export const TierActivationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('implicit') }).strict(),
  z.object({ kind: z.literal('header'), headers: z.record(z.string(), z.string()) }).strict(),
  z.object({ kind: z.literal('body'), patch: JsonObjectSchema }).strict(),
]);

export const ContextTierSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  maxPromptTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  maxTotalTokens: z.number().int().positive().optional(),
  activation: TierActivationSchema,
  costMultiplier: z.number().positive().optional(),
  entitlement: EntitlementStateSchema,
}).strict();

export const ModelRouteSchema = z.object({
  protocol: ProviderProtocolSchema,
  baseUrl: z.string().min(1).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  source: z.enum(['model', 'user', 'catalog']),
}).strict();

export const ModelRouteOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  route: ModelRouteSchema,
  routeRevision: z.string().optional(),
  availability: EffectiveAvailabilitySchema,
  unavailableReason: z.string().optional(),
  protocolOwner: z.string().min(1),
  endpointOwner: z.string().min(1),
  authMode: z.enum(['api-key', 'local', 'account', 'environment']).optional(),
  requiredConnectionFieldIds: z.array(z.string()).optional(),
}).strict();

export const ModelSelectionSchema = z.object({
  pickerVisibility: z.enum(['primary', 'internal']),
  relatedPrimaryModelIds: z.array(z.string().min(1)).optional(),
}).strict();

const SelectableControlSchema = z.object({
  state: z.literal('selectable'),
  defaultValue: z.boolean(),
  entitlement: EntitlementStateSchema,
  tierId: z.string().min(1).optional(),
  label: z.string().optional(),
}).strict();

const FixedControlSchema = z.object({
  state: z.literal('fixed'),
  fixedValue: z.boolean(),
  entitlement: EntitlementStateSchema.optional(),
  tierId: z.string().min(1).optional(),
  label: z.string().optional(),
}).strict();

const UnsupportedControlSchema = z.object({
  state: z.literal('unsupported'),
  fixedValue: z.boolean(),
  reason: z.string().optional(),
}).strict();

const UnknownControlSchema = z.object({
  state: z.literal('unknown'),
  defaultValue: z.boolean(),
  reason: z.string().optional(),
}).strict();

const ProviderManagedControlSchema = z.object({
  state: z.literal('provider-managed'),
  defaultValue: z.boolean().optional(),
  fixedValue: z.boolean().optional(),
  label: z.string().optional(),
  reason: z.string().optional(),
}).strict();

export const BooleanControlDefinitionSchema = z.discriminatedUnion('state', [
  SelectableControlSchema,
  FixedControlSchema,
  UnsupportedControlSchema,
  UnknownControlSchema,
  ProviderManagedControlSchema,
]);

export const ModelControlsSchema = z.object({
  fast: BooleanControlDefinitionSchema,
  context1m: BooleanControlDefinitionSchema,
  reasoning: ReasoningControlSchema,
}).strict();

export const ModelModeActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('request-patch'), patch: JsonObjectSchema }).strict(),
  z.object({
    kind: z.literal('model-switch'),
    targetModelId: z.string().min(1),
    routeOptionId: z.string().min(1).optional(),
    suppressReasoningWire: z.boolean().optional(),
  }).strict(),
  z.object({ kind: z.literal('client-tier'), tierId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('fixed') }).strict(),
  z.object({ kind: z.literal('unsupported'), reason: z.string().optional() }).strict(),
]);

export const ExecutionBindingSelectorSchema = z.object({
  fast: z.boolean().optional(),
  context1m: z.boolean().optional(),
  reasoning: z.array(ReasoningSelectionSchema).min(1).optional(),
}).strict();

export const ExecutionBindingSchema = z.object({
  id: z.string().min(1),
  when: ExecutionBindingSelectorSchema,
  actions: z.array(ModelModeActionSchema).min(1),
  entitlement: EntitlementStateSchema,
  routeOptionIds: z.array(z.string().min(1)).optional(),
  unavailableReason: z.string().optional(),
}).strict();

export const ModelManifestSchema = z.object({
  modelId: z.string().min(1),
  label: z.string().min(1),
  aliases: z.array(z.string()),
  enabled: z.boolean().optional(),
  route: ModelRouteSchema,
  routeOptions: z.array(ModelRouteOptionSchema).optional(),
  selection: ModelSelectionSchema,
  presencePolicy: z.enum(['maintained', 'discovered', 'account-entitled']),
  availability: EffectiveAvailabilitySchema,
  unavailableReason: z.string().optional(),
  contextTiers: z.array(ContextTierSchema).min(1),
  defaultBudgetTokens: z.number().int().nonnegative(),
  controls: ModelControlsSchema,
  executionBindings: z.array(ExecutionBindingSchema).optional(),
  toolCalling: CapabilityStateSchema,
  visionInput: CapabilityStateSchema,
  structuredOutput: CapabilityStateSchema,
  fixedTemperature: z.number().optional(),
  factSourceId: z.string().min(1),
  fieldFactSourceIds: z.record(z.string().min(1), z.string().min(1)).optional(),
}).strict();

const ModelControlsPatchSchema = z.object({
  fast: BooleanControlDefinitionSchema.optional(),
  context1m: BooleanControlDefinitionSchema.optional(),
  reasoning: ReasoningControlSchema.optional(),
}).strict();

export const ModelManifestPatchSchema = z.object({
  label: z.string().min(1).optional(),
  aliases: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  route: ModelRouteSchema.optional(),
  routeOptions: z.array(ModelRouteOptionSchema).optional(),
  selection: ModelSelectionSchema.optional(),
  presencePolicy: z.enum(['maintained', 'discovered', 'account-entitled']).optional(),
  availability: EffectiveAvailabilitySchema.optional(),
  unavailableReason: z.string().optional(),
  contextTiers: z.array(ContextTierSchema).optional(),
  defaultBudgetTokens: z.number().int().nonnegative().optional(),
  controls: ModelControlsPatchSchema.optional(),
  executionBindings: z.array(ExecutionBindingSchema).optional(),
  toolCalling: CapabilityStateSchema.optional(),
  visionInput: CapabilityStateSchema.optional(),
  structuredOutput: CapabilityStateSchema.optional(),
  fixedTemperature: z.number().optional(),
}).strict();

export type BooleanControlDefinition = z.infer<typeof BooleanControlDefinitionSchema>;
export type ExecutionBinding = z.infer<typeof ExecutionBindingSchema>;
export type ModelControls = z.infer<typeof ModelControlsSchema>;
export type ModelModeAction = z.infer<typeof ModelModeActionSchema>;
export type ModelPresencePolicy = ModelManifest['presencePolicy'];
export type ModelManifest = z.infer<typeof ModelManifestSchema>;
