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
  'GoogleInteractions',
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

export const ProviderThinkingProjectionSourceSchema = z.enum([
  'openai-responses-summary',
  'openai-responses-encrypted',
  'xai-responses-summary',
  'xai-responses-encrypted',
  'anthropic-thinking',
  'anthropic-redacted-thinking',
  'openai-compatible-raw',
  'openrouter-raw',
  'deepseek-raw',
  'kimi-raw',
  'glm-raw',
  'qwen-raw',
  'gemini-summary',
  'gemini-thought-signature',
  'gemini-interactions-summary',
  'gemini-interactions-thought-signature',
  'ollama-raw',
  'unknown',
]);

const ProviderThinkingProjectionSourcesSchema = z.object({
  summary: ProviderThinkingProjectionSourceSchema.optional(),
  raw: ProviderThinkingProjectionSourceSchema.optional(),
  opaque: ProviderThinkingProjectionSourceSchema.optional(),
}).strict();

export const ProviderReasoningContractSchema = z.object({
  semantic: z.enum(['raw', 'summary', 'opaque', 'none', 'unknown']),
  source: z.string().min(1),
  evidence: z.string().min(1).optional(),
  displayLabel: z.enum([
    'Raw reasoning',
    'Reasoning summary',
    'Provider reasoning',
    'Reasoning metadata',
    'None',
  ]),
  carrier: z.enum([
    'none',
    'assistant-text',
    'reasoning-content',
    'reasoning-item',
    'signed-content-block',
    'thought-signature',
    'opaque-provider-state',
    'unknown',
  ]),
  artifactFormat: z.string().min(1),
  artifactVersion: z.string().min(1),
  compatibilityGroup: z.string().min(1),
  continuation: z.enum([
    'none',
    'exact-execution',
    'same-provider-model',
    'same-compatibility-group',
    'provider-managed',
    'unknown',
  ]),
  projectionSources: ProviderThinkingProjectionSourcesSchema.optional(),
  continuationModelIds: z.array(z.string().min(1)).min(1).optional(),
}).strict();

export const ProviderStateContractSchema = z.object({
  supportedModes: z.array(z.enum(['local-stateless', 'provider-managed'])).min(1),
  defaultMode: z.enum(['local-stateless', 'provider-managed']),
  carrier: z.enum([
    'none',
    'previous-response-id',
    'conversation-id',
    'previous-interaction-id',
    'opaque-provider-state',
    'unknown',
  ]),
  retention: z.enum(['request', 'session', 'provider', 'unknown']),
  crossModel: z.enum(['never', 'same-compatibility-group', 'provider-managed', 'unknown']),
  evidence: z.string().min(1).optional(),
}).strict();

export const ProviderCacheContractSchema = z.object({
  mode: z.enum([
    'none',
    'implicit-prefix',
    'automatic-breakpoint',
    'automatic-and-explicit-breakpoints',
    'explicit-breakpoints',
    'provider-managed',
    'unknown',
  ]),
  keyCarrier: z.enum([
    'none',
    'prompt-cache-key',
    'provider-managed',
    'unknown',
  ]),
  breakpointCarrier: z.enum([
    'none',
    'openai-prompt-cache',
    'anthropic-cache-control',
    'provider-managed',
    'unknown',
  ]),
  telemetry: z.array(z.enum([
    'cached-input-tokens',
    'cache-read-input-tokens',
    'cache-write-input-tokens',
    'provider-reported',
  ])),
  ttl: z.enum([
    'none',
    'five-minutes',
    'thirty-minutes',
    'one-hour',
    'twenty-four-hours',
    'provider-managed',
    'unknown',
  ]),
  evidence: z.string().min(1).optional(),
}).strict();

export const ProviderToolLoopContractSchema = z.object({
  artifactPolicy: z.enum([
    'discard',
    'preserve-exact',
    'preserve-reasoning-content',
    'preserve-thought-signature',
    'provider-managed',
    'unknown',
  ]),
  artifactScope: z.enum([
    'none',
    'tool-call-turn',
    'all-assistant-turns',
    'provider-managed',
    'unknown',
  ]),
  ordering: z.enum([
    'assistant-tool-result',
    'provider-native',
    'strict-block-order',
    'unknown',
  ]),
  modelSwitch: z.literal('pin-until-terminal'),
  evidence: z.string().min(1).optional(),
  requestPatch: JsonObjectSchema.optional(),
}).strict();

export const ProviderStreamingContractSchema = z.object({
  transport: z.enum(['sse', 'json-lines', 'websocket', 'sdk-events', 'unknown']),
  outputIdentity: z.enum([
    'provider-output-ref',
    'provider-event-id',
    'event-index',
    'unknown',
  ]),
  usage: z.enum(['terminal', 'incremental', 'none', 'unknown']),
  errors: z.enum(['http-status', 'provider-event', 'sdk-error', 'unknown']),
  evidence: z.string().min(1).optional(),
}).strict();

export const SemanticContextContractSchema = z.object({
  version: z.literal('semantic-context-v1'),
  history: z.literal('canonical-messages'),
  toolPairs: z.literal('strict'),
  attachments: z.literal('fail-closed'),
  overflow: z.literal('structured-handoff'),
}).strict();

export const ProviderContractBundleSchema = z.object({
  protocolDialect: z.string().min(1),
  protocolVersion: z.string().min(1),
  compatibilityGroup: z.string().min(1),
  reasoning: ProviderReasoningContractSchema,
  state: ProviderStateContractSchema,
  cache: ProviderCacheContractSchema,
  toolLoop: ProviderToolLoopContractSchema,
  streaming: ProviderStreamingContractSchema,
  semanticContext: SemanticContextContractSchema,
}).strict();

export const ProviderContractBundlePatchSchema = z.object({
  protocolDialect: z.string().min(1).optional(),
  protocolVersion: z.string().min(1).optional(),
  compatibilityGroup: z.string().min(1).optional(),
  reasoning: ProviderReasoningContractSchema.partial().strict().optional(),
  state: ProviderStateContractSchema.partial().strict().optional(),
  cache: ProviderCacheContractSchema.partial().strict().optional(),
  toolLoop: ProviderToolLoopContractSchema.partial().strict().optional(),
  streaming: ProviderStreamingContractSchema.partial().strict().optional(),
  semanticContext: SemanticContextContractSchema.partial().strict().optional(),
}).strict();

export const ModelRouteSchema = z.object({
  protocol: ProviderProtocolSchema,
  baseUrl: z.string().min(1).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  contracts: ProviderContractBundleSchema.optional(),
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

const LiveContextProjectionSchema = z.object({
  observedTierId: z.string().min(1),
  maxTierId: z.string().min(1).optional(),
  entitlementAuthority: z.enum(['manifest', 'catalog-observation', 'execution-evidence']),
}).strict();

const LiveReasoningProjectionSchema = z.object({
  offPolicy: z.enum(['forbidden', 'from-live', 'allowed']),
  wireProfiles: z.partialRecord(ProviderProtocolSchema, ReasoningWireProfileSchema),
}).strict();

const EntitlementDenialMatcherSchema = z.object({
  mode: z.enum(['fast', 'one-million-context']),
  statuses: z.array(z.number().int().min(400).max(599)).min(1),
  protocols: z.array(ProviderProtocolSchema).min(1).optional(),
  messageIncludes: z.string().min(1).optional(),
}).strict();

export const ModelLiveProjectionSchema = z.object({
  context: LiveContextProjectionSchema.optional(),
  reasoning: LiveReasoningProjectionSchema.optional(),
  capabilities: z.array(z.enum(['toolCalling', 'visionInput', 'structuredOutput'])).optional(),
  entitlementDenialMatchers: z.array(EntitlementDenialMatcherSchema).optional(),
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
  cacheContract: ProviderCacheContractSchema.optional(),
  controls: ModelControlsSchema,
  executionBindings: z.array(ExecutionBindingSchema).optional(),
  liveProjection: ModelLiveProjectionSchema.optional(),
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
  cacheContract: ProviderCacheContractSchema.optional(),
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
export type ProviderReasoningContract = z.infer<typeof ProviderReasoningContractSchema>;
export type ProviderThinkingProjectionSource = z.infer<typeof ProviderThinkingProjectionSourceSchema>;
export type ProviderStateContract = z.infer<typeof ProviderStateContractSchema>;
export type ProviderCacheContract = z.infer<typeof ProviderCacheContractSchema>;
export type ProviderToolLoopContract = z.infer<typeof ProviderToolLoopContractSchema>;
export type ProviderStreamingContract = z.infer<typeof ProviderStreamingContractSchema>;
export type SemanticContextContract = z.infer<typeof SemanticContextContractSchema>;
export type ProviderContractBundle = z.infer<typeof ProviderContractBundleSchema>;
export type ProviderContractBundlePatch = z.infer<typeof ProviderContractBundlePatchSchema>;
export type ModelPresencePolicy = ModelManifest['presencePolicy'];
export type ModelManifest = z.infer<typeof ModelManifestSchema>;
export type ModelLiveProjection = z.infer<typeof ModelLiveProjectionSchema>;
