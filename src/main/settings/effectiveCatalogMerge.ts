import { createHash } from 'crypto';
import type {
  CapabilityEvidence,
  ContextTier,
  EffectiveModel,
  ModelRoute,
  JsonValue,
} from '@shared/types/providerCapability';
import type { LlmProviderCatalogOwnership } from '@shared/types/settings';
import type { ReasoningControl } from '@shared/types/modelCapability';
import { isAdmittedDiscoveredModel, normalizeDiscoveredModelMatchKey } from './DiscoveryAdmission';
import { resolveExecutionBinding, resolveModelControls } from '@shared/utils/modelControls';
import type {
  CatalogLayerContribution,
  EffectiveCatalogRequest,
  PartialContextTier,
} from './effectiveCatalogTypes';

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

export function revisionFor(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function routeRevision(route: ModelRoute, optionId?: string): string {
  return revisionFor({ optionId: optionId ?? null, route });
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createUnknownReasoning(): ReasoningControl {
  return {
    kind: 'unknown',
    supportsOff: false,
    levels: [],
    defaultSelection: 'off',
    wireProfile: { kind: 'none' },
  };
}

function createConservativeModel(
  providerId: string,
  modelId: string,
  fallbackRoute: ModelRoute,
  observedAt: string,
): EffectiveModel {
  const evidence = (field: string): CapabilityEvidence => ({
    field,
    source: 'catalog',
    observedAt,
    detail: 'Conservative effective-catalog baseline',
  });
  return {
    providerId,
    modelId,
    label: modelId,
    aliases: [],
    enabled: true,
    route: cloneJson(fallbackRoute),
    routeRevision: routeRevision(fallbackRoute),
    routeOptions: [{
      id: fallbackRoute.protocol,
      route: cloneJson(fallbackRoute),
      routeRevision: routeRevision(fallbackRoute, fallbackRoute.protocol),
      availability: 'available',
    }],
    selection: { pickerVisibility: 'primary' },
    presencePolicy: 'discovered',
    availability: 'unknown',
    contextTiers: [{
      id: 'default',
      label: 'Default',
      activation: { kind: 'implicit' },
      entitlement: 'unknown',
    }],
    defaultBudgetTokens: 0,
    controls: {
      fast: { state: 'unknown', defaultValue: false },
      context1m: { state: 'unsupported', fixedValue: false },
      reasoning: createUnknownReasoning(),
    },
    toolCalling: { state: 'unknown' },
    visionInput: { state: 'unknown' },
    structuredOutput: { state: 'unknown' },
    provenance: [
      evidence('providerId'),
      evidence('modelId'),
      evidence('label'),
      evidence('aliases'),
      evidence('enabled'),
      evidence('route.protocol'),
      evidence('route.source'),
      evidence('availability'),
      evidence('contextTiers.default.id'),
      evidence('contextTiers.default.label'),
      evidence('contextTiers.default.activation.kind'),
      evidence('contextTiers.default.entitlement'),
      evidence('defaultBudgetTokens'),
      evidence('controls.fast.state'),
      evidence('controls.context1m.state'),
      evidence('controls.reasoning.kind'),
      evidence('controls.reasoning.supportsOff'),
      evidence('controls.reasoning.levels'),
      evidence('controls.reasoning.defaultSelection'),
      evidence('controls.reasoning.wireProfile.kind'),
      evidence('toolCalling.state'),
      evidence('visionInput.state'),
      evidence('structuredOutput.state'),
    ],
  };
}

function evidenceFor(
  layer: CatalogLayerContribution,
  field: string,
  value?: unknown,
  previous?: unknown,
  previousEvidence?: CapabilityEvidence,
): CapabilityEvidence {
  const evidence: CapabilityEvidence = {
    field,
    source: layer.source,
    sourceKind: layer.sourceKind,
    observedAt: layer.observedAt,
    refreshedAt: layer.refreshedAt,
    sourceRevision: layer.sourceRevision,
    sourceHash: layer.sourceHash,
    surface: layer.surface,
    accountScope: layer.accountScope,
    surfaceBuild: layer.surfaceBuild,
    plan: layer.plan,
    expiresAt: layer.expiresAt,
    protocol: layer.protocol,
    detail: layer.detail,
  };
  if (value !== undefined) evidence.value = cloneJson(value as JsonValue);
  if (previous !== undefined && stableJson(previous) !== stableJson(value)) {
    const previousSource = previousEvidence
      ? `${previousEvidence.source}${previousEvidence.sourceRevision ? `@${previousEvidence.sourceRevision}` : ''}`
      : 'earlier value';
    evidence.conflict = `${previousSource} ${stableJson(previous)} -> ${layer.source} ${stableJson(value)}`;
  }
  return evidence;
}

function layerForField(
  defaultLayer: CatalogLayerContribution,
  fieldLayers: Record<string, CatalogLayerContribution> | undefined,
  field: string,
): CatalogLayerContribution {
  const matchedPath = Object.keys(fieldLayers ?? {})
    .filter((candidate) => field === candidate || field.startsWith(`${candidate}.`))
    .sort((left, right) => right.length - left.length)[0];
  return matchedPath ? fieldLayers?.[matchedPath] ?? defaultLayer : defaultLayer;
}

function mergeObjectLeaves(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
  prefix: string,
  layer: CatalogLayerContribution,
  provenance: CapabilityEvidence[],
  fieldLayers?: Record<string, CatalogLayerContribution>,
): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    const field = prefix ? `${prefix}.${key}` : key;
    const evidenceLayer = layerForField(layer, fieldLayers, field);
    const previous = target[key];
    if (isObject(value)) {
      if (typeof value.kind === 'string' || typeof value.state === 'string') {
        target[key] = cloneJson(value);
        recordObjectLeafEvidence(
          value,
          isObject(previous) ? previous : undefined,
          field,
          layer,
          provenance,
          fieldLayers,
        );
        continue;
      }
      const nextTarget = isObject(target[key]) ? target[key] as Record<string, unknown> : {};
      target[key] = nextTarget;
      mergeObjectLeaves(nextTarget, value, field, layer, provenance, fieldLayers);
      continue;
    }
    target[key] = cloneJson(value);
    provenance.push(evidenceFor(
      evidenceLayer,
      field,
      value,
      previous,
      provenance.filter((entry) => entry.field === field).at(-1),
    ));
  }
}

function recordObjectLeafEvidence(
  value: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
  prefix: string,
  layer: CatalogLayerContribution,
  provenance: CapabilityEvidence[],
  fieldLayers?: Record<string, CatalogLayerContribution>,
): void {
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) continue;
    const field = `${prefix}.${key}`;
    if (isObject(child)) {
      recordObjectLeafEvidence(
        child,
        isObject(previous?.[key]) ? previous?.[key] as Record<string, unknown> : undefined,
        field,
        layer,
        provenance,
        fieldLayers,
      );
    } else {
      provenance.push(evidenceFor(
        layerForField(layer, fieldLayers, field),
        field,
        child,
        previous?.[key],
        provenance.filter((entry) => entry.field === field).at(-1),
      ));
    }
  }
}

function mergeContextTiers(
  target: EffectiveModel,
  tiers: PartialContextTier[],
  layer: CatalogLayerContribution,
  fieldLayers?: Record<string, CatalogLayerContribution>,
): void {
  const byId = new Map(target.contextTiers.map((tier) => [tier.id, tier]));
  for (const patch of tiers) {
    const current = byId.get(patch.id) ?? {
      id: patch.id,
      label: patch.label ?? patch.id,
      activation: { kind: 'implicit' } as const,
      entitlement: 'unknown' as const,
    };
    const contextControl = target.controls.context1m;
    const protectsCatalogMaxTier = layer.source === 'entitlement'
      && (contextControl.state === 'fixed' || contextControl.state === 'selectable')
      && contextControl.tierId === patch.id;
    const effectivePatch: PartialContextTier = protectsCatalogMaxTier
      ? {
          id: patch.id,
          ...(patch.entitlement !== undefined ? { entitlement: patch.entitlement } : {}),
        }
      : patch;
    mergeObjectLeaves(
      current as unknown as Record<string, unknown>,
      effectivePatch as unknown as Record<string, unknown>,
      `contextTiers.${patch.id}`,
      layer,
      target.provenance,
      fieldLayers,
    );
    byId.set(patch.id, current as ContextTier);
  }
  target.contextTiers = [...byId.values()];
}

function sanitizeUserContribution(
  layer: CatalogLayerContribution | undefined,
  ownership: LlmProviderCatalogOwnership,
): CatalogLayerContribution | undefined {
  if (!layer || ownership === 'user-managed') {
    return layer;
  }
  return {
    ...layer,
    models: layer.models.map((model) => ({
      modelId: model.modelId,
      enabled: model.enabled,
      preferredRouteOptionId: model.preferredRouteOptionId,
      defaultBudgetTokens: model.defaultBudgetTokens,
      controls: model.controls?.reasoning?.defaultSelection
        ? { reasoning: { defaultSelection: model.controls.reasoning.defaultSelection } }
        : undefined,
    })),
  };
}

function applyLayer(
  models: Map<string, EffectiveModel>,
  request: EffectiveCatalogRequest,
  layer: CatalogLayerContribution | undefined,
): void {
  if (!layer) {
    return;
  }
  const protocolDiffersFromCatalog = Boolean(layer.protocol && layer.protocol !== request.protocol);
  if (protocolDiffersFromCatalog && layer.source !== 'observed') {
    return;
  }
  for (const patch of layer.models) {
    const direct = models.get(patch.modelId);
    const matched = direct ? [patch.modelId, direct] as const : [...models.entries()].find(([, candidate]) => (
      candidate.aliases.includes(patch.modelId)
      || (patch.aliases ?? []).includes(candidate.modelId)
      || (
        layer.source === 'discovery'
        && normalizeDiscoveredModelMatchKey(candidate.modelId) === normalizeDiscoveredModelMatchKey(patch.modelId)
      )
    ));
    const matchedKey = matched?.[0];
    if (!matched && layer.source === 'user' && request.catalogOwnership !== 'user-managed') {
      // Persisted app-managed rows are preferences only. They may update a model
      // admitted by the compiled Catalog or discovery, but must never manufacture members.
      continue;
    }
    if (
      protocolDiffersFromCatalog
      && layer.protocol
      && matched?.[1].route.protocol !== layer.protocol
    ) {
      continue;
    }
    const model = matched?.[1]
      ?? createConservativeModel(request.providerId, patch.modelId, request.fallbackRoute, layer.observedAt);
    const rekeyFromDiscovery = layer.source === 'discovery'
      && matchedKey !== undefined
      && matchedKey !== patch.modelId;
    const {
      aliases,
      contextTiers,
      factSource,
      fieldFactSources,
      modelId: _modelId,
      availability,
      unavailableReason,
      ...ordinaryFields
    } = patch;
    const patchLayer: CatalogLayerContribution = factSource
      ? {
          ...layer,
          ...factSource,
          observedAt: factSource.observedAt ?? layer.observedAt,
        }
      : layer;
    const patchFieldLayers = fieldFactSources
      ? Object.fromEntries(Object.entries(fieldFactSources).map(([fieldPath, metadata]) => [
          fieldPath,
          {
            ...patchLayer,
            ...metadata,
            observedAt: metadata.observedAt ?? patchLayer.observedAt,
          },
        ]))
      : undefined;
    const catalogExplicitlyUnavailable = layer.source !== 'catalog'
      && request.catalog.models.some((catalogModel) => (
        catalogModel.availability === 'unavailable'
        && [catalogModel.modelId, ...(catalogModel.aliases ?? [])]
          .some((id) => normalizeDiscoveredModelMatchKey(id) === normalizeDiscoveredModelMatchKey(model.modelId))
      ));
    const availabilityPatch = catalogExplicitlyUnavailable && availability !== 'unavailable'
      ? {}
      : {
          ...(availability !== undefined ? { availability } : {}),
          ...(unavailableReason !== undefined ? { unavailableReason } : {}),
        };
    const ordinaryPatch = rekeyFromDiscovery
      ? { ...ordinaryFields, ...availabilityPatch }
      : { ...ordinaryFields, ...availabilityPatch, ...(aliases !== undefined ? { aliases } : {}) };
    if (rekeyFromDiscovery) {
      const previousId = model.modelId;
      model.modelId = patch.modelId;
      model.aliases = [...new Set([
        previousId,
        ...model.aliases,
        ...(aliases ?? []),
      ])].filter((alias) => alias !== patch.modelId);
      model.provenance.push(
        evidenceFor(layerForField(patchLayer, patchFieldLayers, 'modelId'), 'modelId', patch.modelId, previousId),
        evidenceFor(layerForField(patchLayer, patchFieldLayers, 'aliases'), 'aliases', model.aliases),
      );
      models.delete(matchedKey);
    }
    mergeObjectLeaves(
      model as unknown as Record<string, unknown>,
      ordinaryPatch as unknown as Record<string, unknown>,
      '',
      patchLayer,
      model.provenance,
      patchFieldLayers,
    );
    if (contextTiers) {
      mergeContextTiers(model, contextTiers, patchLayer, patchFieldLayers);
    }
    if (availability === 'available' && !catalogExplicitlyUnavailable) {
      delete model.unavailableReason;
    }
    models.set(rekeyFromDiscovery || !matchedKey ? patch.modelId : matchedKey, model);
  }
}

export function enforceDiscoveryAdmission(
  layer: CatalogLayerContribution | undefined,
): CatalogLayerContribution | undefined {
  if (!layer) return undefined;
  return {
    ...layer,
    models: layer.models.filter((model) => isAdmittedDiscoveredModel({ id: model.modelId })),
  };
}

function gateOverlayToExactAdmittedModels(
  overlay: CatalogLayerContribution | undefined,
  discovery: CatalogLayerContribution | undefined,
  catalog: CatalogLayerContribution,
): CatalogLayerContribution | undefined {
  if (!overlay) return undefined;
  const admittedModelIds = new Set(discovery?.models
    .filter((model) => model.availability !== 'unavailable')
    .map((model) => model.modelId) ?? []);
  for (const model of catalog.models) {
    admittedModelIds.add(model.modelId);
  }
  const models = overlay.models.filter((model) => admittedModelIds.has(model.modelId));
  return models.length > 0 ? { ...overlay, models } : undefined;
}

export function mergeEffectiveCatalog(request: EffectiveCatalogRequest): EffectiveModel[] {
  const models = new Map<string, EffectiveModel>();
  const user = sanitizeUserContribution(request.user, request.catalogOwnership);
  const discovery = enforceDiscoveryAdmission(request.discovery);
  const overlay = gateOverlayToExactAdmittedModels(
    request.overlay,
    discovery,
    request.catalog,
  );
  const observedLayers = Array.isArray(request.observed)
    ? request.observed
    : request.observed
      ? [request.observed]
      : [];
  for (const layer of [
    request.catalog,
    discovery,
    overlay,
    request.entitlement,
    ...observedLayers,
    request.maintainedSurface,
    user,
  ]) {
    applyLayer(models, request, layer);
  }
  const projectedModels = [...models.values()].map((model): EffectiveModel => {
    const hasExplicitRouteOptions = model.provenance.some((evidence) => (
      evidence.field === 'routeOptions' || evidence.field.startsWith('routeOptions.')
    ));
    const routeOptions = hasExplicitRouteOptions && model.routeOptions
      ? model.routeOptions.map((option) => ({
          ...cloneJson(option),
          routeRevision: option.routeRevision || routeRevision(option.route, option.id),
        }))
      : [{
          id: model.route.protocol,
          route: cloneJson(model.route),
          routeRevision: routeRevision(model.route, model.route.protocol),
          availability: model.availability,
          ...(model.unavailableReason ? { unavailableReason: model.unavailableReason } : {}),
        }];
    const preferredRouteOption = model.preferredRouteOptionId
      ? routeOptions.find((option) => option.id === model.preferredRouteOptionId
        && option.availability !== 'unavailable')
      : undefined;
    const preferredRouteOptionId = preferredRouteOption ? model.preferredRouteOptionId : undefined;
    const projectedRoute = preferredRouteOption?.route ?? model.route;
    const projected = {
      ...model,
      aliases: [...model.aliases],
      selection: model.selection ? cloneJson(model.selection) : { pickerVisibility: 'primary' as const },
      presencePolicy: model.presencePolicy ?? 'discovered',
      route: cloneJson(projectedRoute),
      routeRevision: preferredRouteOption?.routeRevision
        ?? routeRevision(model.route),
      routeOptions,
      ...(preferredRouteOptionId
        ? { preferredRouteOptionId }
        : { preferredRouteOptionId: undefined }),
      contextTiers: model.contextTiers.map((tier) => cloneJson(tier)),
      controls: cloneJson(model.controls),
      executionBindings: model.executionBindings?.map((binding) => cloneJson(binding)),
      provenance: model.provenance.map((evidence) => ({ ...evidence })),
    };
    if (model.preferredRouteOptionId && !preferredRouteOptionId) {
      projected.provenance.push({
        field: 'preferredRouteOptionId',
        source: 'catalog',
        observedAt: new Date().toISOString(),
        detail: `Cleared unavailable preferred route ${model.preferredRouteOptionId}`,
      });
    }
    if (request.providerAvailability?.state === 'unavailable') {
      projected.availability = 'unavailable';
      projected.unavailableReason = request.providerAvailability.reason ?? 'Provider runtime is unavailable.';
      projected.provenance.push({
        field: 'availability',
        source: 'catalog',
        observedAt: request.providerAvailability.observedAt,
        detail: 'Provider runtime availability gate',
      }, {
        field: 'unavailableReason',
        source: 'catalog',
        observedAt: request.providerAvailability.observedAt,
        detail: 'Provider runtime availability gate',
      });
    }
    return projected;
  });
  return projectedModels.map((model) => {
    const bindingResolutions = Object.fromEntries((model.executionBindings ?? []).map((binding) => [
      binding.id,
      resolveExecutionBinding(model, binding, projectedModels),
    ]));
    const revisioned = { ...model, bindingResolutions };
    return {
      ...revisioned,
      resolvedControls: resolveModelControls(revisioned, {
        reasoningLevel: revisioned.controls.reasoning.defaultSelection,
      }, projectedModels).resolved,
    };
  });
}

