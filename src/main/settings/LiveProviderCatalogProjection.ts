import type { CatalogModelContribution } from './EffectiveCatalogService';
import type { ModelManifest } from '@shared/provider-catalog/modelManifestSchema';
import type { CapabilityState, ModelRoute, ProviderSurfaceDefinition } from '@shared/types/providerCapability';
import type {
  NamedReasoningLevel,
  ReasoningControl,
  ReasoningWireProfile,
} from '@shared/types/modelCapability';
import type { LlmProviderProtocol } from '@shared/types/settings';
import { normalizeDiscoveredModelMatchKey } from './DiscoveryAdmission';

export interface LiveModelObservation {
  modelId: string;
  aliases?: string[];
  upstreamLabel?: string;
  availability?: 'available' | 'unavailable' | 'unknown';
  unavailableReason?: string;
  protocol?: LlmProviderProtocol;
  contextWindowTokens?: number;
  reasoning?: {
    supported?: boolean;
    efforts?: NamedReasoningLevel[];
    defaultEffort?: NamedReasoningLevel;
    thinkingType?: 'only' | 'optional' | 'both';
  };
  toolCalling?: CapabilityState;
  visionInput?: CapabilityState;
  structuredOutput?: CapabilityState;
}

function withRouteContracts(
  surface: ProviderSurfaceDefinition,
  route: ModelRoute,
): ModelRoute {
  const surfaceRoute = surface.routes.find((candidate) => candidate.protocol === route.protocol);
  return {
    ...route,
    contracts: surfaceRoute?.contracts,
  };
}

function definitionKeys(model: ModelManifest): string[] {
  return [model.modelId, ...model.aliases].map(normalizeDiscoveredModelMatchKey).filter(Boolean);
}

function findDefinition(surface: ProviderSurfaceDefinition, observation: LiveModelObservation): ModelManifest | undefined {
  const keys = new Set([observation.modelId, ...(observation.aliases ?? [])]
    .map(normalizeDiscoveredModelMatchKey)
    .filter(Boolean));
  return surface.models.find((model) => definitionKeys(model).some((key) => keys.has(key)));
}

function admittedDynamicModel(surface: ProviderSurfaceDefinition): boolean {
  return surface.catalogOwnership !== 'app-managed'
    && surface.discovery.authority !== 'candidate-validation'
    && surface.discovery.authority !== 'entitlement-overlay';
}

function filterWireProfile(
  template: ReasoningWireProfile,
  levels: NamedReasoningLevel[],
  fallback: NamedReasoningLevel,
): ReasoningWireProfile {
  if (template.kind === 'none' || template.kind === 'moonshot-thinking') return template;
  const on = levels.includes(template.on) ? template.on : fallback;
  if (template.kind === 'gemini-thinking-budget' || template.kind === 'gemini-thinking-level'
    || template.kind === 'openai-responses') {
    return {
      ...template,
      on,
      levels: Object.fromEntries(levels.flatMap((level) => (
        template.levels[level] === undefined ? [] : [[level, template.levels[level]]]
      ))),
    } as ReasoningWireProfile;
  }
  return {
    ...template,
    on,
    ...(template.levels ? {
      levels: Object.fromEntries(levels.flatMap((level) => (
        template.levels?.[level] === undefined ? [] : [[level, template.levels[level]]]
      ))),
    } : {}),
  } as ReasoningWireProfile;
}

function projectReasoning(
  model: ModelManifest,
  observation: LiveModelObservation,
): ReasoningControl | undefined {
  const policy = model.liveProjection?.reasoning;
  const observed = observation.reasoning;
  if (!policy || !observed) return undefined;
  if (observed.supported === false) {
    if (policy.offPolicy === 'forbidden') {
      return {
        kind: 'unknown', supportsOff: false, levels: [], defaultState: 'provider-managed',
        defaultSelection: 'on', wireProfile: { kind: 'none' },
      };
    }

    return {
      kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', lockedSelection: 'off',
      wireProfile: { kind: 'none' },
    };
  }
  const levels = [...new Set(observed.efforts ?? [])];
  const routeProtocols = new Set([
    model.route.protocol,
    ...(model.routeOptions ?? []).map((option) => option.route.protocol),
  ]);
  const protocol = observation.protocol && routeProtocols.has(observation.protocol)
    ? observation.protocol
    : model.route.protocol;
  const template = policy.wireProfiles[protocol];
  if (levels.length === 0) {
    if (observed.supported === true && observed.thinkingType === 'only' && template) {
      return {
        kind: 'always-on', supportsOff: false, levels: [], defaultState: 'provider-managed',
        defaultSelection: 'on', lockedSelection: 'on', wireProfile: template,
      };
    }
    return {
      kind: 'unknown', supportsOff: false, levels: [], defaultState: 'provider-managed',
      defaultSelection: 'on', wireProfile: { kind: 'none' },
    };
  }
  if (!template) {
    return {
      kind: 'unknown', supportsOff: false, levels: [], defaultState: 'provider-managed',
      defaultSelection: 'on', wireProfile: { kind: 'none' },
    };
  }
  const supportsOff = policy.offPolicy === 'allowed'
    || (policy.offPolicy === 'from-live'
      && (observed.thinkingType === 'optional' || observed.thinkingType === 'both'));
  const observedDefault = observed.defaultEffort && levels.includes(observed.defaultEffort)
    ? observed.defaultEffort
    : undefined;
  const fallback = observedDefault ?? (template.kind !== 'none' && template.kind !== 'moonshot-thinking'
    && levels.includes(template.on) ? template.on : levels[0]);
  const wireProfile = filterWireProfile(template, levels, fallback);
  if (levels.length === 1 && !supportsOff) {
    return {
      kind: 'always-on', supportsOff: false, levels,
      defaultState: observedDefault ? 'known' : 'provider-managed',
      defaultSelection: levels[0], lockedSelection: levels[0], wireProfile,
    };
  }
  return {
    kind: 'levels', supportsOff, levels,
    defaultState: observedDefault ? 'known' : 'provider-managed',
    defaultSelection: fallback,
    wireProfile,
  };
}

function projectContext(
  model: ModelManifest,
  observation: LiveModelObservation,
): Pick<CatalogModelContribution, 'contextTiers' | 'controls' | 'executionBindings'> {
  const policy = model.liveProjection?.context;
  const tokens = observation.contextWindowTokens;
  if (!policy || !tokens) return {};
  const observedTier = model.contextTiers.find((tier) => tier.id === policy.observedTierId);
  if (!observedTier) return {};
  const contextTiers: NonNullable<CatalogModelContribution['contextTiers']> = model.contextTiers.map((tier) => (
    tier.id === observedTier.id
      ? { ...tier, maxPromptTokens: tokens, entitlement: 'granted' as const }
      : tier
  ));
  if (!policy.maxTierId) return { contextTiers };
  const maxTier = model.contextTiers.find((tier) => tier.id === policy.maxTierId);
  if (!maxTier) return { contextTiers };
  const maxEntitlement = policy.entitlementAuthority === 'manifest'
    ? maxTier.entitlement
    : policy.entitlementAuthority === 'catalog-observation' && observedTier.id === maxTier.id
      ? tokens >= 1_000_000 ? 'granted' as const : 'denied' as const
      : 'unknown' as const;
  const maxTierIndex = contextTiers.findIndex((tier) => tier.id === maxTier.id);
  contextTiers[maxTierIndex] = { ...contextTiers[maxTierIndex], entitlement: maxEntitlement };
  const executionBindings = (model.executionBindings ?? []).map((binding) => (
    binding.when.context1m === true
      ? { ...binding, entitlement: maxEntitlement }
      : binding
  ));
  return {
    contextTiers,
    controls: {
      context1m: model.controls.context1m.state === 'selectable'
        ? { ...model.controls.context1m, entitlement: maxEntitlement }
        : model.controls.context1m,
    },
    executionBindings,
  };
}

function projectCompiledModel(
  surface: ProviderSurfaceDefinition,
  model: ModelManifest,
  observation: LiveModelObservation,
  availableModelIds: Set<string>,
): CatalogModelContribution {
  const context = projectContext(model, observation);
  const reasoning = projectReasoning(model, observation);
  const capabilities = new Set(model.liveProjection?.capabilities ?? []);
  const executionBindings = (context.executionBindings ?? model.executionBindings)?.map((binding) => {
    const target = binding.actions.find((action) => action.kind === 'model-switch');
    return target
      ? {
          ...binding,
          entitlement: availableModelIds.has(target.targetModelId)
            ? binding.entitlement
            : 'denied' as const,
        }
      : binding;
  });
  const fastBinding = executionBindings?.find((binding) => (
    binding.when.fast === true && binding.actions.some((action) => action.kind === 'model-switch')
  ));
  return {
    modelId: model.modelId,
    label: model.label,
    aliases: [...model.aliases],
    route: withRouteContracts(surface, model.route),
    routeOptions: model.routeOptions?.map((option) => ({
      ...option,
      route: withRouteContracts(surface, option.route),
    })),
    selection: model.selection,
    presencePolicy: model.presencePolicy,
    availability: observation.availability ?? 'available',
    unavailableReason: observation.unavailableReason,
    contextTiers: context.contextTiers ?? model.contextTiers,
    defaultBudgetTokens: model.defaultBudgetTokens,
    controls: {
      ...model.controls,
      ...context.controls,
      ...(fastBinding ? {
        fast: model.controls.fast.state === 'selectable'
          ? { ...model.controls.fast, entitlement: fastBinding.entitlement }
          : model.controls.fast,
      } : {}),
      ...(reasoning ? { reasoning } : {}),
    },
    ...(executionBindings ? { executionBindings } : {}),
    toolCalling: capabilities.has('toolCalling') && observation.toolCalling
      ? observation.toolCalling : model.toolCalling,
    visionInput: capabilities.has('visionInput') && observation.visionInput
      ? observation.visionInput : model.visionInput,
    structuredOutput: capabilities.has('structuredOutput') && observation.structuredOutput
      ? observation.structuredOutput : model.structuredOutput,
    ...(model.fixedTemperature !== undefined ? { fixedTemperature: model.fixedTemperature } : {}),
    factSource: {
      sourceKind: 'live-catalog',
      surface: surface.id,
      detail: 'Credential-scoped live model observation projected through the compiled manifest.',
    },
  };
}

function projectDynamicModel(
  surface: ProviderSurfaceDefinition,
  observation: LiveModelObservation,
): CatalogModelContribution {
  const defaultRoute = surface.routes.find((route) => route.default) ?? surface.routes[0];
  const route = observation.protocol && surface.routes.some((candidate) => candidate.protocol === observation.protocol)
    ? surface.routes.find((candidate) => candidate.protocol === observation.protocol)!
    : defaultRoute;
  return {
    modelId: observation.modelId,
    aliases: observation.aliases,
    label: observation.upstreamLabel ?? observation.modelId,
    availability: observation.availability ?? 'available',
    unavailableReason: observation.unavailableReason,
    route: {
      protocol: route.protocol,
      baseUrl: route.baseUrl,
      contracts: route.contracts,
      source: 'catalog',
    },
    ...(observation.contextWindowTokens ? {
      contextTiers: [{
        id: 'default', label: 'Provider catalog limit', maxPromptTokens: observation.contextWindowTokens,
        activation: { kind: 'implicit' }, entitlement: 'granted',
      }],
      defaultBudgetTokens: observation.contextWindowTokens,
    } : {}),
    ...(observation.toolCalling ? { toolCalling: observation.toolCalling } : {}),
    ...(observation.visionInput ? { visionInput: observation.visionInput } : {}),
    ...(observation.structuredOutput ? { structuredOutput: observation.structuredOutput } : {}),
  };
}

export function projectLiveModelObservations(
  surface: ProviderSurfaceDefinition,
  observations: LiveModelObservation[],
): CatalogModelContribution[] {
  const unique = new Map<string, LiveModelObservation>();
  for (const observation of observations) {
    if (unique.has(observation.modelId)) {
      throw new Error(`Live catalog contains duplicate model id ${observation.modelId}.`);
    }
    unique.set(observation.modelId, observation);
  }
  const availableModelIds = new Set(observations.flatMap((observation) => {
    const definition = findDefinition(surface, observation);
    return observation.availability === 'unavailable' ? [] : [definition?.modelId ?? observation.modelId];
  }));
  return observations.flatMap((observation) => {
    const definition = findDefinition(surface, observation);
    if (definition) return [projectCompiledModel(surface, definition, observation, availableModelIds)];
    return admittedDynamicModel(surface) ? [projectDynamicModel(surface, observation)] : [];
  });
}
