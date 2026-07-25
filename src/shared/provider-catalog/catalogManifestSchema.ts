import { z } from 'zod';
import {
  BooleanControlDefinitionSchema,
  EffectiveAvailabilitySchema,
  ExecutionBindingSchema,
  JsonPrimitiveSchema,
  ModelManifestPatchSchema,
  ModelManifestSchema,
  ProviderContractBundleSchema,
  ProviderProtocolSchema,
} from './modelManifestSchema';
import {
  getProviderAdapterImplementation,
  PROVIDER_AUTH_SCHEMA_IDS,
  PROVIDER_DISCOVERY_POLICY_IDS,
  type ProviderAdapterId,
} from './implementationRegistry';

const ProviderAdapterIdSchema = z.custom<ProviderAdapterId>(
  (value) => typeof value === 'string' && Boolean(getProviderAdapterImplementation(value)),
  'no registered adapter implementation',
);

const AvailabilitySchema = z.object({
  state: EffectiveAvailabilitySchema,
  reason: z.string().optional(),
}).strict();

const ConnectionFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(['secret', 'text', 'url', 'region', 'path']),
  required: z.boolean(),
  environmentVariable: z.string().optional(),
  placeholder: z.string().optional(),
}).strict();

const CredentialAlternativeSchema = z.object({
  id: z.string().min(1),
  fieldIds: z.array(z.string()),
  label: z.string().optional(),
  description: z.string().optional(),
  ambient: z.boolean().optional(),
}).strict();

const ConnectionSchema = z.object({
  fields: z.array(ConnectionFieldSchema),
  primarySecretFieldId: z.string().optional(),
  credentialAlternatives: z.array(CredentialAlternativeSchema).optional(),
  headerMappings: z.array(z.object({
    fieldId: z.string().min(1),
    header: z.string().min(1),
    prefix: z.string().optional(),
  }).strict()).optional(),
  endpointTemplate: z.string().optional(),
}).strict();

const DiscoveryCapabilityMappingSchema = z.object({
  path: z.string().min(1),
  equals: JsonPrimitiveSchema.optional(),
  includes: JsonPrimitiveSchema.optional(),
}).strict();

const DiscoveryFieldMappingSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  aliases: z.string().optional(),
  contextWindow: z.string().optional(),
  contextWindowKind: z.enum(['prompt', 'total']).optional(),
  contextWindowAuthority: z.enum(['account-effective', 'model-catalog']).optional(),
  maxOutputTokens: z.string().optional(),
  protocol: z.string().optional(),
  modality: z.string().optional(),
  toolCalling: DiscoveryCapabilityMappingSchema.optional(),
  visionInput: DiscoveryCapabilityMappingSchema.optional(),
  structuredOutput: DiscoveryCapabilityMappingSchema.optional(),
}).strict();

const DiscoveryAdmissionSchema = z.object({
  allowPatterns: z.array(z.string()).optional(),
  denyPatterns: z.array(z.string()).optional(),
  allowedModalities: z.array(z.string()).optional(),
  requireContextWindow: z.boolean().optional(),
  predicates: z.array(z.object({
    path: z.string().min(1),
    equals: JsonPrimitiveSchema.optional(),
    includes: JsonPrimitiveSchema.optional(),
  }).strict()).optional(),
}).strict();

const DiscoveryRouteRuleSchema = z.object({
  allowPatterns: z.array(z.string()),
  protocol: ProviderProtocolSchema,
  baseUrl: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
}).strict();

export const DiscoveryStrategySchema = z.union([
  z.object({
    kind: z.literal('json-catalog'),
    method: z.enum(['GET', 'POST']).optional(),
    url: z.string().optional(),
    path: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    collectionPath: z.string(),
    mapping: DiscoveryFieldMappingSchema,
    admission: DiscoveryAdmissionSchema.optional(),
    routeRules: z.array(DiscoveryRouteRuleSchema).optional(),
  }).strict(),
  z.object({ kind: z.literal('custom-parser'), parserId: z.string().min(1) }).strict(),
  z.null(),
]);

export const CatalogFactSourceSchema = z.object({
  id: z.string().min(1),
  sourceKind: z.enum([
    'user-control-panel',
    'live-catalog',
    'runtime-observation',
    'provider-control-plane',
    'provider-docs',
    'upstream-implementation',
    'models.dev',
    'opencode',
    'hermes',
    'rdc-agent',
  ]),
  sourceRevision: z.string().min(1),
  observedAt: z.string().min(1).optional(),
  refreshedAt: z.string().min(1),
  identityId: z.string().optional(),
  surface: z.string().min(1),
  accountScope: z.string().min(1).optional(),
  surfaceBuild: z.string().min(1).optional(),
  plan: z.string().min(1).optional(),
}).strict();

export const ProviderSurfaceRouteSchema = z.object({
  id: z.string().min(1),
  protocol: ProviderProtocolSchema,
  protocolOwner: z.string().min(1),
  adapterId: ProviderAdapterIdSchema,
  baseUrl: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  default: z.boolean().optional(),
  contracts: ProviderContractBundleSchema,
}).strict();

export const ProviderSurfaceManifestSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().min(1),
  identityIds: z.array(z.string().min(1)),
  profileId: z.string().min(1),
  adapterIds: z.array(ProviderAdapterIdSchema).min(1),
  authSchemaId: z.enum(PROVIDER_AUTH_SCHEMA_IDS),
  discoveryPolicyId: z.enum(PROVIDER_DISCOVERY_POLICY_IDS),
  vendorId: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(['stable', 'beta', 'deprecated', 'sunset']),
  sunsetAt: z.string().optional(),
  availability: AvailabilitySchema,
  category: z.enum([
    'login-authorization',
    'official-direct',
    'cloud-platform',
    'coding-token-plan',
    'compatible-access',
    'local',
  ]),
  surfaceKind: z.enum(['account', 'native-api', 'cloud', 'plan', 'compatible-api', 'local']),
  serviceOperator: z.string().min(1),
  endpointClass: z.enum([
    'first-party',
    'third-party-gateway',
    'cloud-hosted',
    'coding-plan',
    'account-surface',
    'local-service',
    'user-endpoint',
  ]),
  endpointOwnership: z.enum(['service-operator', 'cloud-platform', 'third-party', 'local', 'user']),
  catalogOwnership: z.enum(['app-managed', 'provider-managed', 'user-managed']),
  factSources: z.array(CatalogFactSourceSchema).min(1),
  defaultFactSourceId: z.string().min(1),
  factConflicts: z.array(z.object({
    fieldPath: z.string().min(1),
    sourceIds: z.array(z.string().min(1)).min(2),
    status: z.enum(['unresolved', 'resolved']),
    resolutionSourceId: z.string().min(1).optional(),
    detail: z.string().min(1),
  }).strict()).optional(),
  connectionSchema: ConnectionSchema.optional(),
  authModes: z.array(z.enum(['none', 'api-key', 'oauth', 'device', 'environment', 'local'])).min(1),
  authModeAvailability: z.partialRecord(
    z.enum(['none', 'api-key', 'oauth', 'device', 'environment', 'local']),
    AvailabilitySchema,
  ).optional(),
  baseUrlEditable: z.boolean().optional(),
  accountLoginConfigured: z.boolean().optional(),
  capabilities: z.array(z.enum([
    'chat',
    'tool-calling',
    'structured-output',
    'reasoning',
    'prompt-cache',
    'vision-input',
    'model-discovery',
  ])).optional(),
  routes: z.array(ProviderSurfaceRouteSchema).min(1),
  discovery: z.object({
    authority: z.enum(['authoritative-list', 'candidate-validation', 'additive', 'entitlement-overlay']),
    strategy: DiscoveryStrategySchema,
    admission: z.object({
      allowProviders: z.array(z.string().min(1)).optional(),
      denyPatterns: z.array(z.string().min(1)).optional(),
      requireCapabilities: z.array(z.string().min(1)).optional(),
      requireContextWindow: z.boolean().optional(),
      excludeDeprecated: z.boolean().optional(),
      excludeExperimental: z.boolean().optional(),
    }).strict().optional(),
  }).strict(),
  discoveredModelProjection: z.object({
    fast: BooleanControlDefinitionSchema.optional(),
    executionBindings: z.array(ExecutionBindingSchema).optional(),
    factSourceId: z.string().min(1),
  }).strict().optional(),
  models: z.array(ModelManifestSchema),
  protocolOverrides: z.array(z.object({
    modelId: z.string().min(1),
    protocol: ProviderProtocolSchema.optional(),
    patch: ModelManifestPatchSchema,
    factSourceId: z.string().min(1),
  }).strict()),
  recommendedModels: z.array(z.string()),
  docsUrl: z.string().min(1),
}).strict();

export const ProviderIdentityManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  npm: z.string().min(1),
  env: z.array(z.string()),
  api: z.string().min(1).optional(),
  docsUrl: z.string().min(1),
  provenance: z.object({
    sourceKind: z.literal('models.dev'),
    sourceRevision: z.string().min(1),
    refreshedAt: z.string().min(1),
    openCodeCommit: z.string().min(1),
    hermesCommit: z.string().min(1),
  }).strict(),
}).strict();

export const ProviderProfileManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  routeMechanics: z.array(z.object({
    protocol: ProviderProtocolSchema,
    adapter: ProviderAdapterIdSchema,
    contracts: ProviderContractBundleSchema,
  }).strict()).min(1),
}).strict();

export type ProviderSurfaceManifest = z.infer<typeof ProviderSurfaceManifestSchema>;
export type ProviderIdentityManifest = z.infer<typeof ProviderIdentityManifestSchema>;
export type ProviderProfileManifest = z.infer<typeof ProviderProfileManifestSchema>;
