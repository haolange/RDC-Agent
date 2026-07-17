import { createHash } from 'node:crypto';
import {
  ProviderIdentityManifestSchema,
  ProviderProfileManifestSchema,
  ProviderSurfaceManifestSchema,
  type ProviderIdentityManifest,
  type ProviderProfileManifest,
  type ProviderSurfaceManifest,
} from './catalogManifestSchema';
import {
  PROVIDER_ADAPTER_IDS,
  PROVIDER_AUTH_SCHEMA_IDS,
  PROVIDER_DISCOVERY_POLICY_IDS,
  providerAdapterSupportsProtocol,
} from './implementationRegistry';
import type { ExecutionBinding, ModelManifest } from './modelManifestSchema';
import { isMaxContextTier } from '../utils/contextTiers';

export const PROVIDER_CATALOG_SCHEMA_VERSION = 1 as const;
export const MODELS_DEV_IDENTITY_COUNT = 166 as const;
export const MODELS_DEV_SNAPSHOT_SHA256 = 'd4f2aad138021cdd9052d910e326e7c1b40a627adfb5ecdc085764ab372d4733';

export interface ProviderCatalogCompileInput {
  identities: unknown[];
  profiles: unknown[];
  surfaces: unknown[];
}

export interface ProviderModelSummary {
  modelId: string;
  label: string;
  aliases: string[];
  availability: ModelManifest['availability'];
  unavailableReason?: string;
  selection: ModelManifest['selection'];
  presencePolicy: ModelManifest['presencePolicy'];
}

export type ProviderSurfaceSummary = Omit<ProviderSurfaceManifest,
  | 'identityIds'
  | 'profileId'
  | 'adapterIds'
  | 'authSchemaId'
  | 'discoveryPolicyId'
  | 'defaultFactSourceId'
  | 'discovery'
  | 'factConflicts'
  | 'discoveredModelProjection'
  | 'models'
  | 'protocolOverrides'
> & {
  discoveryAuthority: ProviderSurfaceManifest['discovery']['authority'];
  modelCount: number;
  models: ProviderModelSummary[];
};

export interface CompiledProviderCatalogIndex {
  schemaVersion: typeof PROVIDER_CATALOG_SCHEMA_VERSION;
  catalogRevision: string;
  identityCount: number;
  surfaceCount: number;
  modelCount: number;
  surfaces: ProviderSurfaceSummary[];
}

export interface CompiledProviderSurface {
  schemaVersion: typeof PROVIDER_CATALOG_SCHEMA_VERSION;
  catalogRevision: string;
  surface: ProviderSurfaceManifest;
}

export interface CompiledProviderCatalog {
  index: CompiledProviderCatalogIndex;
  identities: ProviderIdentityManifest[];
  profiles: ProviderProfileManifest[];
  surfaces: Map<string, CompiledProviderSurface>;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function uniqueById<T extends { id: string }>(values: T[], label: string, errors: string[]): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    if (result.has(value.id)) errors.push(`Duplicate ${label} id: ${value.id}`);
    result.set(value.id, value);
  }
  return result;
}

function uniqueModels(values: ModelManifest[], label: string, errors: string[]): Map<string, ModelManifest> {
  const result = new Map<string, ModelManifest>();
  for (const value of values) {
    if (result.has(value.modelId)) errors.push(`Duplicate ${label} id: ${value.modelId}`);
    result.set(value.modelId, value);
  }
  return result;
}

function selectorKey(binding: ExecutionBinding): string {
  return stableJson(binding.when);
}

function bindingSpecificity(binding: ExecutionBinding): number {
  return Number(binding.when.fast !== undefined)
    + Number(binding.when.context1m !== undefined)
    + Number(Boolean(binding.when.reasoning));
}

function bindingsCanOverlap(left: ExecutionBinding, right: ExecutionBinding): boolean {
  if (left.when.fast !== undefined && right.when.fast !== undefined && left.when.fast !== right.when.fast) return false;
  if (left.when.context1m !== undefined
    && right.when.context1m !== undefined
    && left.when.context1m !== right.when.context1m) return false;
  if (left.when.reasoning && right.when.reasoning
    && !left.when.reasoning.some((selection) => right.when.reasoning?.includes(selection))) return false;
  if (left.routeOptionIds && right.routeOptionIds
    && !left.routeOptionIds.some((routeId) => right.routeOptionIds?.includes(routeId))) return false;
  return true;
}

function modelProtocols(model: ModelManifest): Set<string> {
  return new Set((model.routeOptions?.length
    ? model.routeOptions.map((option) => option.route.protocol)
    : [model.route.protocol]));
}

const SENSITIVE_MANIFEST_KEY = /^(?:authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|api[-_]?key|x[-_]?api[-_]?key|access[-_]?token|refresh[-_]?token|bearer[-_]?token|security[-_]?token|client[-_]?secret|password|credential|credentials)$/iu;

function validatePublicPatch(
  value: unknown,
  location: string,
  errors: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validatePublicPatch(entry, `${location}[${index}]`, errors));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const childLocation = `${location}.${key}`;
    if (SENSITIVE_MANIFEST_KEY.test(key)) {
      errors.push(`${childLocation} attempts to embed credential material in the Provider Catalog`);
    }
    validatePublicPatch(entry, childLocation, errors);
  }
}

function validateBindingTargets(
  surface: ProviderSurfaceManifest,
  model: ModelManifest,
  models: Map<string, ModelManifest>,
  errors: string[],
): void {
  const bindingIds = new Set<string>();
  const selectorActions = new Map<string, string>();
  for (const binding of model.executionBindings ?? []) {
    if (bindingIds.has(binding.id)) {
      errors.push(`${surface.id}/${model.modelId} has duplicate binding id ${binding.id}`);
    }
    bindingIds.add(binding.id);
    const key = selectorKey(binding);
    const actions = stableJson(binding.actions);
    const previous = selectorActions.get(key);
    if (previous && previous !== actions) {
      errors.push(`${surface.id}/${model.modelId} has conflicting bindings for selector ${key}`);
    }
    selectorActions.set(key, actions);
    for (const routeOptionId of binding.routeOptionIds ?? []) {
      if (!model.routeOptions?.some((option) => option.id === routeOptionId)) {
        errors.push(`${surface.id}/${model.modelId} binding ${binding.id} references missing source route ${routeOptionId}`);
      }
    }
    for (const action of binding.actions) {
      if (action.kind === 'client-tier'
        && !model.contextTiers.some((tier) => tier.id === action.tierId)) {
        errors.push(`${surface.id}/${model.modelId} binding ${binding.id} references missing context tier ${action.tierId}`);
      }
      if (action.kind !== 'model-switch') continue;
      const target = models.get(action.targetModelId);
      if (!target) {
        errors.push(`${surface.id}/${model.modelId} binding ${binding.id} targets missing model ${action.targetModelId}`);
        continue;
      }
      const sourceProtocols = modelProtocols(model);
      const targetProtocols = modelProtocols(target);
      if (![...sourceProtocols].some((protocol) => targetProtocols.has(protocol))) {
        errors.push(`${surface.id}/${model.modelId} binding ${binding.id} has no protocol-compatible target route`);
      }
      if (action.routeOptionId
        && !target.routeOptions?.some((option) => option.id === action.routeOptionId)) {
        errors.push(`${surface.id}/${model.modelId} binding ${binding.id} references missing target route ${action.routeOptionId}`);
      }
    }
  }
  const bindings = model.executionBindings ?? [];
  for (let leftIndex = 0; leftIndex < bindings.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < bindings.length; rightIndex += 1) {
      const left = bindings[leftIndex];
      const right = bindings[rightIndex];
      if (bindingSpecificity(left) !== bindingSpecificity(right)
        || !bindingsCanOverlap(left, right)
        || stableJson(left.actions) === stableJson(right.actions)) continue;
      errors.push(`${surface.id}/${model.modelId} has conflicting equal-specificity bindings ${left.id} and ${right.id}`);
    }
  }
  if (model.controls.fast.state === 'selectable') {
    const hasFastBinding = (model.executionBindings ?? []).some((binding) => binding.when.fast === true);
    if (!hasFastBinding) errors.push(`${surface.id}/${model.modelId} exposes selectable Fast without an execution binding`);
  }
}

function validateModel(
  surface: ProviderSurfaceManifest,
  model: ModelManifest,
  models: Map<string, ModelManifest>,
  factSourceIds: Set<string>,
  errors: string[],
): void {
  if (!factSourceIds.has(model.factSourceId)) {
    errors.push(`${surface.id}/${model.modelId} references unknown fact source ${model.factSourceId}`);
  }
  const modelFieldRoots = new Set(Object.keys(model).filter((key) => (
    key !== 'factSourceId' && key !== 'fieldFactSourceIds'
  )));
  for (const [fieldPath, sourceId] of Object.entries(model.fieldFactSourceIds ?? {})) {
    if (!modelFieldRoots.has(fieldPath.split('.')[0])) {
      errors.push(`${surface.id}/${model.modelId} maps an unknown fact field ${fieldPath}`);
    }
    if (!factSourceIds.has(sourceId)) {
      errors.push(`${surface.id}/${model.modelId}/${fieldPath} references unknown fact source ${sourceId}`);
    }
  }
  const tierIds = new Set(model.contextTiers.map((tier) => tier.id));
  if (tierIds.size !== model.contextTiers.length) {
    errors.push(`${surface.id}/${model.modelId} has duplicate context tier ids`);
  }
  const contextControl = model.controls.context1m;
  if (contextControl.state === 'selectable' || contextControl.state === 'fixed') {
    const contextTier = model.contextTiers.find((tier) => tier.id === contextControl.tierId);
    if (!contextTier) {
      errors.push(`${surface.id}/${model.modelId} Max mode control references a missing context tier`);
    } else if (!isMaxContextTier(contextTier)) {
      errors.push(`${surface.id}/${model.modelId} Max mode control references a sub-one-million context tier`);
    }
  }
  validatePublicPatch(model.route.headers, `${surface.id}/${model.modelId}.route.headers`, errors);
  for (const tier of model.contextTiers) {
    if (tier.activation.kind === 'header') {
      validatePublicPatch(tier.activation.headers, `${surface.id}/${model.modelId}.contextTiers.${tier.id}.headers`, errors);
    } else if (tier.activation.kind === 'body') {
      validatePublicPatch(tier.activation.patch, `${surface.id}/${model.modelId}.contextTiers.${tier.id}.patch`, errors);
    }
  }
  for (const binding of model.executionBindings ?? []) {
    for (const action of binding.actions) {
      if (action.kind === 'request-patch') {
        validatePublicPatch(action.patch, `${surface.id}/${model.modelId}.executionBindings.${binding.id}.patch`, errors);
      }
    }
  }
  if (model.selection.pickerVisibility === 'internal'
    && !model.selection.relatedPrimaryModelIds?.length) {
    errors.push(`${surface.id}/${model.modelId} is internal without a related primary model`);
  }
  for (const relatedId of model.selection.relatedPrimaryModelIds ?? []) {
    if (!models.has(relatedId)) {
      errors.push(`${surface.id}/${model.modelId} references missing primary model ${relatedId}`);
    }
  }
  const surfaceRouteProtocols = new Set(surface.routes.map((route) => route.protocol));
  const routeOptions = model.routeOptions ?? [];
  const routeMatrixIsLive = model.presencePolicy === 'account-entitled'
    && (surface.discovery.authority === 'authoritative-list'
      || surface.discovery.authority === 'entitlement-overlay');
  if (surface.routes.length > 1
    && routeOptions.length === 0
    && model.route.source !== 'model'
    && !routeMatrixIsLive
    && surface.discovery.authority !== 'additive') {
    errors.push(`${surface.id}/${model.modelId} must declare its model-level route matrix`);
  }
  const routeOptionIds = new Set<string>();
  for (const option of routeOptions) {
    if (routeOptionIds.has(option.id)) errors.push(`${surface.id}/${model.modelId} has duplicate route option ${option.id}`);
    routeOptionIds.add(option.id);
    validatePublicPatch(option.route.headers, `${surface.id}/${model.modelId}/${option.id}.route.headers`, errors);
    if (!surfaceRouteProtocols.has(option.route.protocol)) {
      errors.push(`${surface.id}/${model.modelId}/${option.id} references a protocol outside the surface route registry`);
    }
    const surfaceRoute = surface.routes.find((route) => route.protocol === option.route.protocol);
    if (!option.protocolOwner || option.protocolOwner !== surfaceRoute?.protocolOwner) {
      errors.push(`${surface.id}/${model.modelId}/${option.id} does not declare the exact surface protocol owner`);
    }
    for (const fieldId of option.requiredConnectionFieldIds ?? []) {
      if (!surface.connectionSchema?.fields.some((field) => field.id === fieldId)) {
        errors.push(`${surface.id}/${model.modelId}/${option.id} requires missing connection field ${fieldId}`);
      }
    }
  }
  if (routeOptions.length > 0
    && !routeOptions.some((option) => (
      option.route.protocol === model.route.protocol && option.route.baseUrl === model.route.baseUrl
    ))) {
    errors.push(`${surface.id}/${model.modelId} default route is absent from its model-level route matrix`);
  }
  validateBindingTargets(surface, model, models, errors);
}

function validateSurface(
  surface: ProviderSurfaceManifest,
  identities: Map<string, ProviderIdentityManifest>,
  profiles: Map<string, ProviderProfileManifest>,
  errors: string[],
): void {
  const adapters = new Set<string>(PROVIDER_ADAPTER_IDS);
  const authSchemas = new Set<string>(PROVIDER_AUTH_SCHEMA_IDS);
  const discoveryPolicies = new Set<string>(PROVIDER_DISCOVERY_POLICY_IDS);
  const profile = profiles.get(surface.profileId);
  const categoryShapes = {
    'login-authorization': ['account', 'account-surface', 'service-operator'],
    'official-direct': ['native-api', 'first-party', 'service-operator'],
    'cloud-platform': ['cloud', 'cloud-hosted', 'cloud-platform'],
    'coding-token-plan': ['plan', 'coding-plan', 'service-operator'],
    local: ['local', 'local-service', 'local'],
    image: ['media', 'first-party', 'service-operator'],
  } as const;
  const categoryShape = surface.category === 'compatible-access'
    ? undefined
    : categoryShapes[surface.category];
  if (categoryShape) {
    const [surfaceKind, endpointClass, endpointOwnership] = categoryShape;
    if (surface.surfaceKind !== surfaceKind
      || surface.endpointClass !== endpointClass
      || surface.endpointOwnership !== endpointOwnership) {
      errors.push(`${surface.id} has an invalid explicit shape for category ${surface.category}`);
    }
  } else if (surface.surfaceKind !== 'compatible-api'
    || !(new Set<string>([
      'third-party-gateway:third-party',
      'first-party:service-operator',
      'user-endpoint:user',
    ])).has(`${surface.endpointClass}:${surface.endpointOwnership}`)) {
    errors.push(`${surface.id} has an invalid explicit compatible-access ownership shape`);
  }
  if (surface.category === 'image'
    && !surface.capabilities?.some((capability) => capability === 'image-generation' || capability === 'video-generation')) {
    errors.push(`${surface.id} is categorized as image without a media capability`);
  }
  if (!profile) errors.push(`${surface.id} references unknown profile ${surface.profileId}`);
  if (!authSchemas.has(surface.authSchemaId)) errors.push(`${surface.id} references unknown auth schema ${surface.authSchemaId}`);
  if (!discoveryPolicies.has(surface.discoveryPolicyId)) {
    errors.push(`${surface.id} references unknown discovery policy ${surface.discoveryPolicyId}`);
  }
  const connectionFieldIds = new Set<string>();
  for (const field of surface.connectionSchema?.fields ?? []) {
    if (connectionFieldIds.has(field.id)) errors.push(`${surface.id} has duplicate connection field ${field.id}`);
    connectionFieldIds.add(field.id);
  }
  if (surface.status === 'stable' && surface.authModes.includes('api-key') && !surface.connectionSchema) {
    errors.push(`${surface.id} is stable and requires an explicit API-key connection schema`);
  }
  const primarySecretFieldId = surface.connectionSchema?.primarySecretFieldId;
  if (primarySecretFieldId && !connectionFieldIds.has(primarySecretFieldId)) {
    errors.push(`${surface.id} primary secret field ${primarySecretFieldId} is missing`);
  }
  for (const alternative of surface.connectionSchema?.credentialAlternatives ?? []) {
    for (const fieldId of alternative.fieldIds) {
      if (!connectionFieldIds.has(fieldId)) errors.push(`${surface.id}/${alternative.id} references missing connection field ${fieldId}`);
    }
  }
  for (const mapping of surface.connectionSchema?.headerMappings ?? []) {
    if (!connectionFieldIds.has(mapping.fieldId)) errors.push(`${surface.id} header mapping references missing connection field ${mapping.fieldId}`);
  }
  for (const identityId of surface.identityIds) {
    if (!identities.has(identityId)) errors.push(`${surface.id} references unknown identity ${identityId}`);
  }
  const factSourceIds = new Set(surface.factSources.map((source) => source.id));
  if (factSourceIds.size !== surface.factSources.length) errors.push(`${surface.id} has duplicate fact source ids`);
  if (!factSourceIds.has(surface.defaultFactSourceId)) {
    errors.push(`${surface.id} default fact source is missing`);
  }
  const discoveredProjection = surface.discoveredModelProjection;
  if (discoveredProjection) {
    if (!factSourceIds.has(discoveredProjection.factSourceId)) {
      errors.push(`${surface.id} discovered model projection references unknown fact source ${discoveredProjection.factSourceId}`);
    }
    if (surface.discovery.strategy === null) {
      errors.push(`${surface.id} declares a discovered model projection without discovery`);
    }
    if (discoveredProjection.fast?.state === 'selectable'
      && !discoveredProjection.executionBindings?.some((binding) => binding.when.fast === true)) {
      errors.push(`${surface.id} projects selectable Fast without an execution binding`);
    }
    for (const binding of discoveredProjection.executionBindings ?? []) {
      for (const action of binding.actions) {
        if (action.kind === 'model-switch') {
          errors.push(`${surface.id} discovered model projection cannot guess a model-switch target`);
        }
        if (action.kind === 'request-patch') {
          validatePublicPatch(action.patch, `${surface.id}.discoveredModelProjection.${binding.id}.patch`, errors);
        }
      }
    }
  }
  for (const conflict of surface.factConflicts ?? []) {
    for (const sourceId of conflict.sourceIds) {
      if (!factSourceIds.has(sourceId)) {
        errors.push(`${surface.id}/${conflict.fieldPath} conflict references unknown fact source ${sourceId}`);
      }
    }
    if (conflict.status === 'resolved') {
      if (!conflict.resolutionSourceId || !conflict.sourceIds.includes(conflict.resolutionSourceId)) {
        errors.push(`${surface.id}/${conflict.fieldPath} resolved conflict must select one of its fact sources`);
      }
    } else if (conflict.resolutionSourceId) {
      errors.push(`${surface.id}/${conflict.fieldPath} unresolved conflict cannot select a resolution source`);
    }
  }
  const routeIds = new Set<string>();
  const routeAdapters = new Set<string>();
  const defaultRoutes = surface.routes.filter((route) => route.default);
  if (defaultRoutes.length > 1) errors.push(`${surface.id} has more than one default route`);
  for (const route of surface.routes) {
    if (routeIds.has(route.id)) errors.push(`${surface.id} has duplicate route id ${route.id}`);
    routeIds.add(route.id);
    routeAdapters.add(route.adapterId);
    if (!adapters.has(route.adapterId)) errors.push(`${surface.id}/${route.id} has no registered adapter ${route.adapterId}`);
    if (!providerAdapterSupportsProtocol(route.adapterId, route.protocol)) {
      errors.push(`${surface.id}/${route.id} adapter ${route.adapterId} does not implement ${route.protocol}`);
    }
    if (!route.baseUrl.trim()) errors.push(`${surface.id}/${route.id} has an empty endpoint`);
    if (surface.category === 'official-direct' && route.protocolOwner !== surface.serviceOperator) {
      errors.push(`${surface.id}/${route.id} is first-party direct but its protocol owner is ${route.protocolOwner}`);
    }
    const admitted = profile?.routeMechanics.some((mechanic) => (
      mechanic.protocol === route.protocol && mechanic.adapter === route.adapterId
    ));
    if (profile && !admitted) errors.push(`${surface.id}/${route.id} is not admitted by profile ${profile.id}`);
  }
  if (stableJson([...routeAdapters].sort()) !== stableJson([...surface.adapterIds].sort())) {
    errors.push(`${surface.id} adapterIds do not match its routes`);
  }
  const strategy = surface.discovery.strategy;
  const expectedDiscoveryPolicy = strategy === null
    ? 'none'
    : strategy.kind === 'custom-parser'
      ? strategy.parserId
      : 'json-catalog';
  if (surface.discoveryPolicyId !== expectedDiscoveryPolicy) {
    errors.push(`${surface.id} discoveryPolicyId does not match its strategy`);
  }
  const models = uniqueModels(surface.models, `${surface.id} model`, errors);
  if (surface.status === 'stable' && surface.discovery.strategy === null && models.size === 0) {
    errors.push(`${surface.id} is stable but has neither a model catalog nor discovery implementation`);
  }
  const modelKeys = new Set(surface.models.flatMap((model) => [model.modelId, ...model.aliases]));
  for (const model of surface.models) validateModel(surface, model, models, factSourceIds, errors);
  for (const override of surface.protocolOverrides) {
    if (!modelKeys.has(override.modelId) && surface.discovery.strategy === null) {
      errors.push(`${surface.id} override targets missing model ${override.modelId}`);
    }
    if (override.protocol && !surface.routes.some((route) => route.protocol === override.protocol)) {
      errors.push(`${surface.id} override for ${override.modelId} references a protocol outside the surface route registry`);
    }
    if (!factSourceIds.has(override.factSourceId)) errors.push(`${surface.id} override has unknown fact source ${override.factSourceId}`);
  }
  for (const modelId of surface.recommendedModels) {
    if (surface.models.length > 0 && !modelKeys.has(modelId) && surface.discovery.strategy === null) {
      errors.push(`${surface.id} recommends missing model ${modelId}`);
    }
  }
}

export function compileProviderCatalog(input: ProviderCatalogCompileInput): CompiledProviderCatalog {
  const identities = input.identities.map((value) => ProviderIdentityManifestSchema.parse(value));
  const profiles = input.profiles.map((value) => ProviderProfileManifestSchema.parse(value));
  const surfaces = input.surfaces.map((value) => ProviderSurfaceManifestSchema.parse(value));
  identities.sort((left, right) => left.id.localeCompare(right.id));
  profiles.sort((left, right) => left.id.localeCompare(right.id));
  surfaces.sort((left, right) => left.id.localeCompare(right.id));

  const errors: string[] = [];
  const identityById = uniqueById(identities, 'identity', errors);
  const profileById = uniqueById(profiles, 'profile', errors);
  uniqueById(surfaces, 'surface', errors);
  if (identities.length !== MODELS_DEV_IDENTITY_COUNT) {
    errors.push(`Expected ${MODELS_DEV_IDENTITY_COUNT} identities, received ${identities.length}`);
  }
  for (const identity of identities) {
    if (identity.provenance.sourceRevision !== MODELS_DEV_SNAPSHOT_SHA256) {
      errors.push(`${identity.id} does not use the pinned models.dev snapshot`);
    }
  }
  for (const surface of surfaces) validateSurface(surface, identityById, profileById, errors);
  const representedIdentities = surfaces.flatMap((surface) => surface.identityIds);
  const representedSet = new Set(representedIdentities);
  if (representedIdentities.length !== representedSet.size) errors.push('A models.dev identity is represented by more than one surface');
  for (const identity of identities) {
    if (!representedSet.has(identity.id)) errors.push(`Identity ${identity.id} has no explicit surface owner`);
  }
  if (errors.length > 0) {
    throw new Error(`Provider Catalog compilation failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  }

  const canonicalInput = { identities, profiles, surfaces };
  const catalogRevision = createHash('sha256').update(stableJson(canonicalInput), 'utf8').digest('hex');
  const compiledSurfaces = new Map(surfaces.map((surface) => [surface.id, {
    schemaVersion: PROVIDER_CATALOG_SCHEMA_VERSION,
    catalogRevision,
    surface,
  }]));
  const summaries = surfaces.map((surface) => ({
    schemaVersion: surface.schemaVersion,
    id: surface.id,
    vendorId: surface.vendorId,
    label: surface.label,
    status: surface.status,
    sunsetAt: surface.sunsetAt,
    availability: surface.availability,
    category: surface.category,
    surfaceKind: surface.surfaceKind,
    serviceOperator: surface.serviceOperator,
    endpointClass: surface.endpointClass,
    endpointOwnership: surface.endpointOwnership,
    catalogOwnership: surface.catalogOwnership,
    factSources: surface.factSources,
    connectionSchema: surface.connectionSchema,
    authModes: surface.authModes,
    authModeAvailability: surface.authModeAvailability,
    baseUrlEditable: surface.baseUrlEditable,
    accountLoginConfigured: surface.accountLoginConfigured,
    capabilities: surface.capabilities,
    routes: surface.routes,
    discoveryAuthority: surface.discovery.authority,
    recommendedModels: surface.recommendedModels.filter((modelId) => {
      const model = surface.models.find((entry) => entry.modelId === modelId);
      return !model || model.selection.pickerVisibility !== 'internal';
    }),
    docsUrl: surface.docsUrl,
    modelCount: surface.models.filter((model) => model.selection.pickerVisibility !== 'internal').length,
    models: surface.models.map((model) => ({
      modelId: model.modelId,
      label: model.label,
      aliases: [...model.aliases],
      availability: model.availability,
      ...(model.unavailableReason ? { unavailableReason: model.unavailableReason } : {}),
      selection: model.selection,
      presencePolicy: model.presencePolicy,
    })),
  }));
  return {
    index: {
      schemaVersion: PROVIDER_CATALOG_SCHEMA_VERSION,
      catalogRevision,
      identityCount: identities.length,
      surfaceCount: surfaces.length,
      modelCount: surfaces.reduce((count, surface) => count + surface.models.filter((model) => model.selection.pickerVisibility !== 'internal').length, 0),
      surfaces: summaries,
    },
    identities,
    profiles,
    surfaces: compiledSurfaces,
  };
}
