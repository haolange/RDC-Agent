import { createHash } from 'crypto';
import type {
  EffectiveModel,
  ExecutionIdentity,
  ProviderStateMode,
  ToolLoopPhase,
  JsonObject,
  JsonValue,
  ModelRoute,
  ModelSelection,
  RequestPlan,
  RequestPlanningErrorCode,
  RequestPlanningResult,
} from '@shared/types/providerCapability';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import {
  clampReasoningSelection,
  createReasoningControl,
  DEFAULT_CONTEXT_COMPACTION_PERCENT,
} from '@shared/types/modelCapability';
import {
  contextTierBudgetTokens,
  contextTierPromptCap,
  contextTierWindowTokens,
  resolveContextTierChoices,
  resolvePlanningOutputTokens,
} from '@shared/utils/contextTiers';
import {
  resolveCompactionThresholdTokens,
  sanitizeCompactionThresholdPercent,
} from '@shared/utils/contextBudget';
import { resolveModelControls } from '@shared/utils/modelControls';
import { providerAdapterIdForProtocol } from '@shared/provider-catalog/implementationRegistry';

import { createFailClosedProviderContracts } from '@shared/provider-catalog/providerContracts';
export interface RequestPlannerInput {
  model: EffectiveModel;
  /** Effective snapshot used to validate hidden internal model targets. */
  catalogModels?: readonly EffectiveModel[];
  controls?: Partial<ConversationTurnControls> & { reasoningLevel?: unknown };
  requestedTemperature?: number;
  /** User/policy-merged compaction percent. Defaults to 80. */
  compactionThresholdPercent?: number;
  /** Secret-free account/credential scope identifier; only its hash enters RequestPlan. */
  credentialScopeId?: string;
  /** Provider-managed state is opt-in. Local stateless is the product default. */
  stateMode?: ProviderStateMode;
  toolLoopPhase?: ToolLoopPhase;
}

function valuesEqual(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergePatch(target: JsonObject, patch: JsonObject, prefix = ''): string | undefined {
  for (const [key, value] of Object.entries(patch)) {
    const field = prefix ? `${prefix}.${key}` : key;
    const current = target[key];
    if (
      current
      && value
      && typeof current === 'object'
      && typeof value === 'object'
      && !Array.isArray(current)
      && !Array.isArray(value)
    ) {
      const conflict = mergePatch(current as JsonObject, value as JsonObject, field);
      if (conflict) return conflict;
      continue;
    }
    if (current !== undefined && !valuesEqual(current, value)) return field;
    target[key] = value;
  }
  return undefined;
}

function mergeHeaders(target: Record<string, string>, patch: Record<string, string>): string | undefined {
  for (const [name, value] of Object.entries(patch)) {
    const currentName = Object.keys(target).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    if (currentName && target[currentName] !== value) return name;
    target[currentName ?? name] = value;
  }
  return undefined;
}

function planningError(
  code: RequestPlanningErrorCode,
  message: string,
  controls: ConversationTurnControls,
): RequestPlanningResult {
  return { ok: false, code, message, controls };
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

function revisionFor(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function routeMatches(left: ModelRoute, right: ModelRoute): boolean {
  return left.protocol === right.protocol && left.baseUrl === right.baseUrl;
}

export function planModelRequest(input: RequestPlannerInput): RequestPlanningResult {
  const { model } = input;
  const evaluation = resolveModelControls(model, input.controls, input.catalogModels);
  const controls = evaluation.controls;
  if (model.availability !== 'available' || model.enabled === false) {
    return planningError(
      'MODEL_UNAVAILABLE',
      model.unavailableReason
        ?? `${model.modelId} is ${model.availability === 'unknown' ? 'not yet verified' : 'unavailable'}`,
      controls,
    );
  }
  if (evaluation.error) {
    const code: RequestPlanningErrorCode = evaluation.error.code === 'PLAN_CONFLICT'
      ? 'PLAN_CONFLICT'
      : evaluation.error.code === 'MAX_CONTEXT_BLOCKED'
        ? 'NO_USABLE_CONTEXT_TIER'
        : 'MODEL_UNAVAILABLE';
    return planningError(code, evaluation.error.message, controls);
  }

  const tierChoices = resolveContextTierChoices(model);
  const maxMode = evaluation.resolved.maxContext.value;
  let activeTier = maxMode ? tierChoices.maxTier : tierChoices.normalTier;
  if (!activeTier || activeTier.entitlement === 'denied') {
    return planningError('NO_USABLE_CONTEXT_TIER', `${model.modelId} has no usable context tier`, controls);
  }

  const warnings: string[] = [];
  let effectiveModelId = model.modelId;
  let effectiveModel = model;
  let modelSelection: ModelSelection = model.selection ?? { pickerVisibility: 'primary' };
  let route: ModelRoute = {
    ...model.route,
    headers: model.route.headers ? { ...model.route.headers } : undefined,
  };
  let selectedRouteOptionId = model.preferredRouteOptionId
    ?? model.routeOptions?.find((option) => routeMatches(option.route, route))?.id;
  let selectedRouteRevision = model.routeRevision ?? revisionFor(route);
  if (model.preferredRouteOptionId) {
    const preferredRoute = model.routeOptions?.find((option) => option.id === model.preferredRouteOptionId);
    if (!preferredRoute) {
      return planningError(
        'PLAN_CONFLICT',
        `Preferred route ${model.preferredRouteOptionId} is not available for ${model.modelId}`,
        controls,
      );
    }
    if (preferredRoute.availability !== 'available') {
      return planningError(
        'MODEL_UNAVAILABLE',
        preferredRoute.unavailableReason ?? `Preferred route ${preferredRoute.id} is unavailable`,
        controls,
      );
    }
    route = {
      ...preferredRoute.route,
      headers: preferredRoute.route.headers ? { ...preferredRoute.route.headers } : undefined,
    };
    selectedRouteRevision = preferredRoute.routeRevision
      ?? revisionFor({ modelId: model.modelId, routeOptionId: preferredRoute.id, route: preferredRoute.route });
  }

  const bodyPatch: JsonObject = {};
  const bindingHeaders: Record<string, string> = {};
  let suppressReasoningWire = false;

  const switchModel = (
    targetModelId: string,
    routeOptionId?: string,
  ): RequestPlanningResult | undefined => {
    const target = input.catalogModels?.find((candidate) => candidate.modelId === targetModelId)
      ?? input.catalogModels?.find((candidate) => candidate.aliases.includes(targetModelId));
    if (!target) {
      return planningError(
        'MODEL_UNAVAILABLE',
        `Internal execution target ${targetModelId} is missing from the effective Catalog`,
        controls,
      );
    }
    if (target.availability !== 'available' || target.enabled === false) {
      return planningError(
        'MODEL_UNAVAILABLE',
        target.unavailableReason ?? `Internal execution target ${targetModelId} is unavailable`,
        controls,
      );
    }

    const targetRouteOption = routeOptionId
      ? target.routeOptions?.find((option) => option.id === routeOptionId)
      : target.routeOptions?.find((option) => option.id === selectedRouteOptionId && option.route.protocol === route.protocol)
        ?? target.routeOptions?.find((option) => option.route.protocol === route.protocol);
    if (routeOptionId && !targetRouteOption) {
      return planningError('PLAN_CONFLICT', `Execution target route ${routeOptionId} is unavailable`, controls);
    }
    if (targetRouteOption && targetRouteOption.availability !== 'available') {
      return planningError(
        'MODEL_UNAVAILABLE',
        targetRouteOption.unavailableReason
          ?? `Execution target route ${targetRouteOption.id} is ${targetRouteOption.availability}`,
        controls,
      );
    }
    const targetRoute = targetRouteOption?.route ?? target.route;
    if (targetRoute.protocol !== route.protocol) {
      return planningError(
        'PLAN_CONFLICT',
        `Execution target ${targetModelId} requires ${targetRoute.protocol}, not ${route.protocol}`,
        controls,
      );
    }
    route = {
      ...targetRoute,
      headers: targetRoute.headers ? { ...targetRoute.headers } : undefined,
    };
    selectedRouteOptionId = targetRouteOption?.id ?? selectedRouteOptionId;
    selectedRouteRevision = targetRouteOption?.routeRevision
      ?? target.routeRevision
      ?? revisionFor({ targetModelId, route: targetRoute, routeOptionId: targetRouteOption?.id ?? null });
    effectiveModel = target;
    effectiveModelId = target.modelId;
    modelSelection = target.selection ?? {
      pickerVisibility: 'internal',
      relatedPrimaryModelIds: [model.modelId],
    };
    return undefined;
  };

  const binding = evaluation.binding;
  if (binding) {
    if (binding.entitlement === 'denied') {
      return planningError(
        'MODEL_UNAVAILABLE',
        binding.unavailableReason ?? `Execution binding ${binding.id} is denied`,
        controls,
      );
    }
    if (binding.entitlement === 'unknown') {
      warnings.push(`Execution binding ${binding.id} entitlement is unverified`);
    }
    if (binding.routeOptionIds?.length
      && (!selectedRouteOptionId || !binding.routeOptionIds.includes(selectedRouteOptionId))) {
      return planningError(
        'PLAN_CONFLICT',
        `Execution binding ${binding.id} is unavailable for the selected route`,
        controls,
      );
    }

    for (const action of binding.actions) {
      if (action.kind === 'unsupported') {
        return planningError(
          'CONSTRAINT_REJECTED',
          action.reason ?? binding.unavailableReason ?? `Execution binding ${binding.id} is unsupported`,
          controls,
        );
      }
      if (action.kind === 'request-patch') {
        const conflict = mergePatch(bodyPatch, action.patch);
        if (conflict) {
          return planningError('PLAN_CONFLICT', `Execution binding conflicts at ${conflict}`, controls);
        }
      } else if (action.kind === 'request-headers') {
        const conflict = mergeHeaders(bindingHeaders, action.headers);
        if (conflict) {
          return planningError('PLAN_CONFLICT', `Execution binding conflicts at header ${conflict}`, controls);
        }
      } else if (action.kind === 'model-switch') {
        if (effectiveModelId !== model.modelId && effectiveModelId !== action.targetModelId) {
          return planningError('PLAN_CONFLICT', 'Execution binding selects conflicting target models', controls);
        }
        const error = switchModel(action.targetModelId, action.routeOptionId);
        if (error) return error;
        suppressReasoningWire ||= action.suppressReasoningWire === true;
      } else if (action.kind === 'client-tier') {
        const tier = model.contextTiers.find((candidate) => (
          candidate.id === action.tierId && candidate.entitlement !== 'denied'
        ));
        if (!tier) {
          return planningError(
            'NO_USABLE_CONTEXT_TIER',
            `Execution tier ${action.tierId} is unavailable`,
            controls,
          );
        }
        activeTier = tier;
      }
    }
  }

  const headers = { ...(route.headers ?? {}) };
  const bindingHeaderConflict = mergeHeaders(headers, bindingHeaders);
  if (bindingHeaderConflict) {
    return planningError('PLAN_CONFLICT', `Execution binding conflicts at header ${bindingHeaderConflict}`, controls);
  }
  if (maxMode && tierChoices.maxTierUnverified) {
    warnings.push('Max mode entitlement is unverified');
  } else if (activeTier.entitlement === 'unknown') {
    warnings.push(maxMode
      ? 'Max mode entitlement is unverified'
      : `Context tier ${activeTier.label} is unverified`);
  }
  if (activeTier.activation.kind === 'header') {
    const conflict = mergeHeaders(headers, activeTier.activation.headers);
    if (conflict) {
      return planningError('PLAN_CONFLICT', `Context tier conflicts at header ${conflict}`, controls);
    }
  } else if (activeTier.activation.kind === 'body') {
    const conflict = mergePatch(bodyPatch, activeTier.activation.patch);
    if (conflict) {
      return planningError('PLAN_CONFLICT', `Context tier conflicts at ${conflict}`, controls);
    }
  }

  const tierCap = contextTierPromptCap(activeTier);
  const contextWindowTokens = contextTierWindowTokens(activeTier)
    ?? tierCap
    ?? model.defaultBudgetTokens;
  if (!contextWindowTokens) {
    return planningError(
      'NO_USABLE_CONTEXT_TIER',
      `${model.modelId} has no known complete context window`,
      controls,
    );
  }
  if (!Number.isFinite(model.defaultBudgetTokens) || model.defaultBudgetTokens <= 0) {
    return planningError(
      'NO_USABLE_CONTEXT_TIER',
      `${model.modelId} has no positive default context budget`,
      controls,
    );
  }

  const requestedBudget = maxMode
    ? (contextTierPromptCap(activeTier) ?? contextWindowTokens)
    : model.defaultBudgetTokens;
  const contextBudgetTokens = contextTierBudgetTokens(activeTier, requestedBudget);
  const maxOutputTokens = resolvePlanningOutputTokens(activeTier, contextWindowTokens);
  const compactionThresholdPercent = sanitizeCompactionThresholdPercent(
    input.compactionThresholdPercent,
    DEFAULT_CONTEXT_COMPACTION_PERCENT,
  );
  const compactionThresholdTokens = resolveCompactionThresholdTokens(
    contextBudgetTokens,
    compactionThresholdPercent,
  );
  const reasoningSelection = model.controls.reasoning.kind === 'unknown'
    || (model.controls.reasoning.defaultState && model.controls.reasoning.defaultState !== 'known'
      && input.controls?.reasoningLevel === undefined)
    ? 'unknown' as const
    : clampReasoningSelection(controls.reasoningLevel, model.controls.reasoning)
      ?? model.controls.reasoning.defaultSelection;
  if (reasoningSelection !== 'unknown') controls.reasoningLevel = reasoningSelection;
  const reasoningControl = createReasoningControl(model.controls.reasoning);
  if (suppressReasoningWire) reasoningControl.wireProfile = { kind: 'none' };

  const routeContracts = route.contracts ?? createFailClosedProviderContracts(route.protocol);
  const contracts = effectiveModel.cacheContract
    ? { ...routeContracts, cache: effectiveModel.cacheContract }
    : routeContracts;
  route = { ...route, contracts };
  const continuationModelAdmitted = !contracts.reasoning.continuationModelIds
    || contracts.reasoning.continuationModelIds.includes(effectiveModelId);
  if (
    continuationModelAdmitted
    && contracts.reasoning.continuation !== 'none'
    && contracts.reasoning.continuation !== 'unknown'
    && contracts.toolLoop.requestPatch
  ) {
    const conflict = mergePatch(bodyPatch, contracts.toolLoop.requestPatch);
    if (conflict) {
      return planningError('PLAN_CONFLICT', `Tool-loop continuation conflicts at ${conflict}`, controls);
    }
  }
  const stateMode = input.stateMode ?? contracts.state.defaultMode;
  if (!contracts.state.supportedModes.includes(stateMode)) {
    return planningError(
      'CONSTRAINT_REJECTED',
      `State mode ${stateMode} is not supported by ${model.providerId}/${effectiveModelId}`,
      controls,
    );
  }
  const catalogRevision = model.catalogRevision ?? revisionFor({
    providerId: model.providerId,
    modelId: model.modelId,
    provenance: model.provenance,
  });
  const appliedBindingIds = binding ? [binding.id] : [];
  const contextMode = maxMode ? 'one-million' as const : 'normal' as const;
  const toolLoopPhase = input.toolLoopPhase ?? 'top-level';
  const contractHash = revisionFor(contracts);
  const credentialScopeHash = revisionFor({
    providerId: model.providerId,
    credentialScopeId: input.credentialScopeId ?? 'default',
  });
  const endpointHash = revisionFor(
    (route.baseUrl ?? `${route.protocol}:default`).trim().replace(/\/+$/u, '').toLowerCase(),
  );
  const identityBase: Omit<ExecutionIdentity, 'fingerprint'> = {
    schemaVersion: 1,
    providerId: model.providerId,
    credentialScopeHash,
    endpointHash,
    protocolFamily: route.protocol,
    protocolDialect: contracts.protocolDialect,
    protocolVersion: contracts.protocolVersion,
    catalogRevision,
    routeRevision: selectedRouteRevision,
    selectedModelId: model.modelId,
    effectiveModelId,
    canonicalModelId: effectiveModel.modelId,
    modelSnapshotId: revisionFor({
      catalogRevision,
      routeRevision: selectedRouteRevision,
      effectiveModelId,
      provenance: effectiveModel.provenance,
    }),
    compatibilityGroup: contracts.compatibilityGroup,
    bindingIds: appliedBindingIds,
    variantKey: revisionFor({
      bindingIds: appliedBindingIds,
      fast: evaluation.resolved.fast.value,
      contextMode,
      reasoningSelection,
    }),
    reasoningMode: reasoningSelection,
    contextMode,
    stateMode,
    artifactFormat: contracts.reasoning.artifactFormat,
    artifactVersion: contracts.reasoning.artifactVersion,
    contractHash,
    toolLoopPhase,
  };
  const executionIdentity: ExecutionIdentity = {
    ...identityBase,
    fingerprint: revisionFor(identityBase),
  };
  const statePlan = {
    mode: stateMode,
    carrier: stateMode === 'provider-managed' ? contracts.state.carrier : 'none' as const,
    store: stateMode === 'provider-managed',
    reuseProviderState: stateMode === 'provider-managed',
  };
  const cachePlan = {
    enabled: contracts.cache.mode !== 'none' && contracts.cache.mode !== 'unknown',
    mode: contracts.cache.mode,
    keyCarrier: contracts.cache.keyCarrier,
    breakpointCarrier: contracts.cache.breakpointCarrier,
    telemetry: [...contracts.cache.telemetry],
    ttl: contracts.cache.ttl,
  };
  const toolLoopPlan = {
    phase: toolLoopPhase,
    pinned: true as const,
    artifactPolicy: contracts.toolLoop.artifactPolicy,
    artifactScope: contracts.toolLoop.artifactScope,
    ordering: contracts.toolLoop.ordering,
  };
  const streamingPlan = { ...contracts.streaming };
  const contextTransitionPlan = stateMode === 'provider-managed'
    ? {
        strategy: 'provider-managed' as const,
        portable: false,
        reason: 'Explicit provider-managed state mode.',
      }
    : {
        strategy: 'semantic-replay' as const,
        portable: true,
        reason: 'Local stateless mode replays canonical semantic context.',
      };
  const plan: RequestPlan = {
    providerId: model.providerId,
    adapterId: providerAdapterIdForProtocol(route.protocol),
    catalogRevision,
    routeRevision: selectedRouteRevision,
    selectedModelId: model.modelId,
    effectiveModelId,
    appliedBindingIds,
    modelSelection,
    route,
    headers,
    contracts,
    executionIdentity,
    statePlan,
    cachePlan,
    toolLoopPlan,
    streamingPlan,
    contextTransitionPlan,
    bodyPatch,
    contextBudgetTokens,
    contextMode,
    contextWindowTokens,
    maxOutputTokens,
    compactionThresholdTokens,
    activeTierId: activeTier.id,
    fastMode: evaluation.resolved.fast.value,
    reasoningWire: {
      selection: reasoningSelection,
      control: reasoningControl,
    },
    temperature: typeof effectiveModel.fixedTemperature === 'number'
      ? effectiveModel.fixedTemperature
      : typeof model.fixedTemperature === 'number'
        ? model.fixedTemperature
        : input.requestedTemperature,
  };
  return { ok: true, plan, controls, warnings };
}
