import { clampReasoningSelection, DEFAULT_CONTEXT_COMPACTION_PERCENT } from '@shared/types/modelCapability';
import {
  contextTierBudgetTokens,
  contextTierPromptCap,
  contextTierWindowTokens,
  resolveContextTierChoices,
  resolvePlanningOutputTokens,
  type ContextTierChoices,
} from '@shared/utils/contextTiers';
import {
  resolveCompactionThresholdTokens,
  sanitizeCompactionThresholdPercent,
} from '@shared/utils/contextBudget';
import { resolveModelControls, type ModelControlEvaluation } from '@shared/utils/modelControls';
import { providerAdapterIdForProtocol } from '@shared/provider-catalog/implementationRegistry';
import {
  classifyAgentToolEligibility,
  describeAgentToolIneligibility,
  isAgentToolExecutableModel,
} from '@shared/utils/agentToolCapability';

import { createFailClosedProviderContracts } from '@shared/provider-catalog/providerContracts';
import { revisionFor } from './effectiveCatalogMerge';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type { EffectiveModel, ExecutionIdentity, ProviderStateMode, ToolLoopPhase, CatalogModelRoute, ContextTier, ModelSelection, RequestPlan, RequestPlanningErrorCode } from '@shared/types/providerCapability';
import type { RequestPlanningResult } from './providerCatalogTypes';
import type { JsonObject, JsonValue } from '@shared/utils/jsonValue';
import type { ReasoningControl, ReasoningWireProfile } from '@shared/types/modelCapability';
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
  /**
   * Agent send path defaults to true. Capability probes set false so
   * unknown-tool catalog rows remain probeable without becoming Agent-executable.
   */
  requireAgentToolEligibility?: boolean;
}

function valuesEqual(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function modelIdentityProvenance(model: EffectiveModel) {
  // Freshness is validated during catalog resolution; renewal alone does not
  // change the source or executable model facts bound to a continuation.
  return model.provenance.map(evidence => Object.fromEntries(
    Object.entries(evidence).filter(([key]) => !['observedAt', 'refreshedAt', 'expiresAt'].includes(key)),
  ));
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

type PlanningFailure = Extract<RequestPlanningResult, { ok: false }>;

function planningError(
  code: RequestPlanningErrorCode,
  message: string,
  controls: ConversationTurnControls,
): PlanningFailure {
  return { ok: false, code, message, controls };
}

function routeMatches(left: CatalogModelRoute, right: CatalogModelRoute): boolean {
  return left.protocol === right.protocol && left.baseUrl === right.baseUrl;
}

/** A phase either yields its value or ends planning with the failure it found. */
type PlanningStep<T> = { ok: true; value: T } | PlanningFailure;

/**
 * Facts the planning phases refine in order: eligibility, route selection, execution binding,
 * context tier headers, context budget, reasoning wire, route contracts and execution identity.
 */
interface RequestPlanningState {
  readonly input: RequestPlannerInput;
  readonly model: EffectiveModel;
  readonly evaluation: ModelControlEvaluation;
  readonly controls: ConversationTurnControls;
  readonly maxMode: boolean;
  readonly tierChoices: ContextTierChoices;
  readonly warnings: string[];
  readonly bodyPatch: JsonObject;
  readonly bindingHeaders: Record<string, string>;
  activeTier: ContextTier;
  effectiveModelId: string;
  effectiveModel: EffectiveModel;
  modelSelection: ModelSelection;
  route: CatalogModelRoute;
  selectedRouteOptionId: string | undefined;
  selectedRouteRevision: string;
  suppressReasoningWire: boolean;
}

interface ContextBudgetPlan {
  contextWindowTokens: number;
  contextBudgetTokens: number;
  maxOutputTokens: RequestPlan['maxOutputTokens'];
  compactionThresholdTokens: number;
}

/** Availability, Agent tool eligibility and control conflicts, before any route is chosen. */
function rejectIneligibleModel(input: RequestPlannerInput, evaluation: ModelControlEvaluation): PlanningFailure | undefined {
  const { model } = input;
  const controls = evaluation.controls;
  if (model.availability !== 'available' || model.enabled === false) {
    return planningError(
      'MODEL_UNAVAILABLE',
      model.unavailableReason
        ?? `${model.modelId} is ${model.availability === 'unknown' ? 'not yet verified' : 'unavailable'}`,
      controls,
    );
  }
  if (input.requireAgentToolEligibility !== false && !isAgentToolExecutableModel(model)) {
    const eligibility = classifyAgentToolEligibility(model);
    const detail = eligibility === 'executable'
      ? {
          technicalMessage: `MODEL_UNAVAILABLE: ${model.providerId}/${model.modelId} is not Agent-executable.`,
        }
      : describeAgentToolIneligibility(eligibility, model.providerId, model.modelId);
    return planningError('MODEL_UNAVAILABLE', detail.technicalMessage, controls);
  }
  if (evaluation.error) {
    const code: RequestPlanningErrorCode = evaluation.error.code === 'PLAN_CONFLICT'
      ? 'PLAN_CONFLICT'
      : evaluation.error.code === 'MAX_CONTEXT_BLOCKED'
        ? 'NO_USABLE_CONTEXT_TIER'
        : 'MODEL_UNAVAILABLE';
    return planningError(code, evaluation.error.message, controls);
  }
  return undefined;
}

/** The usable context tier and the model's route, honouring a preferred route option. */
function createPlanningState(input: RequestPlannerInput, evaluation: ModelControlEvaluation): PlanningStep<RequestPlanningState> {
  const { model } = input;
  const controls = evaluation.controls;
  const tierChoices = resolveContextTierChoices(model);
  const maxMode = evaluation.resolved.maxContext.value;
  const activeTier = maxMode ? tierChoices.maxTier : tierChoices.normalTier;
  if (!activeTier || activeTier.entitlement === 'denied') {
    return planningError('NO_USABLE_CONTEXT_TIER', `${model.modelId} has no usable context tier`, controls);
  }
  let route: CatalogModelRoute = {
    ...model.route,
    headers: model.route.headers ? { ...model.route.headers } : undefined,
  };
  const selectedRouteOptionId = model.preferredRouteOptionId
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
  return { ok: true, value: {
    input, model, evaluation, controls, maxMode, tierChoices,
    warnings: [], bodyPatch: {}, bindingHeaders: {},
    activeTier,
    effectiveModelId: model.modelId,
    effectiveModel: model,
    modelSelection: model.selection ?? { pickerVisibility: 'primary' },
    route,
    selectedRouteOptionId,
    selectedRouteRevision,
    suppressReasoningWire: false,
  } };
}

/** A binding's model switch moves execution to a hidden catalog target on the same protocol. */
function switchExecutionModel(
  state: RequestPlanningState,
  targetModelId: string,
  routeOptionId?: string,
): PlanningFailure | undefined {
  const { input, model, controls } = state;
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
    : target.routeOptions?.find((option) => option.id === state.selectedRouteOptionId && option.route.protocol === state.route.protocol)
      ?? target.routeOptions?.find((option) => option.route.protocol === state.route.protocol);
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
  if (targetRoute.protocol !== state.route.protocol) {
    return planningError(
      'PLAN_CONFLICT',
      `Execution target ${targetModelId} requires ${targetRoute.protocol}, not ${state.route.protocol}`,
      controls,
    );
  }
  state.route = {
    ...targetRoute,
    headers: targetRoute.headers ? { ...targetRoute.headers } : undefined,
  };
  state.selectedRouteOptionId = targetRouteOption?.id ?? state.selectedRouteOptionId;
  state.selectedRouteRevision = targetRouteOption?.routeRevision
    ?? target.routeRevision
    ?? revisionFor({ targetModelId, route: targetRoute, routeOptionId: targetRouteOption?.id ?? null });
  state.effectiveModel = target;
  state.effectiveModelId = target.modelId;
  state.modelSelection = target.selection ?? {
    pickerVisibility: 'internal',
    relatedPrimaryModelIds: [model.modelId],
  };
  return undefined;
}

/** Apply the resolved execution binding's patches, headers, model switch and client tier. */
function applyExecutionBinding(state: RequestPlanningState): PlanningFailure | undefined {
  const { model, controls } = state;
  const binding = state.evaluation.binding;
  if (!binding) return undefined;
  if (binding.entitlement === 'denied') {
    return planningError(
      'MODEL_UNAVAILABLE',
      binding.unavailableReason ?? `Execution binding ${binding.id} is denied`,
      controls,
    );
  }
  if (binding.entitlement === 'unknown') {
    state.warnings.push(`Execution binding ${binding.id} entitlement is unverified`);
  }
  if (binding.routeOptionIds?.length
    && (!state.selectedRouteOptionId || !binding.routeOptionIds.includes(state.selectedRouteOptionId))) {
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
      const conflict = mergePatch(state.bodyPatch, action.patch);
      if (conflict) {
        return planningError('PLAN_CONFLICT', `Execution binding conflicts at ${conflict}`, controls);
      }
    } else if (action.kind === 'request-headers') {
      const conflict = mergeHeaders(state.bindingHeaders, action.headers);
      if (conflict) {
        return planningError('PLAN_CONFLICT', `Execution binding conflicts at header ${conflict}`, controls);
      }
    } else if (action.kind === 'model-switch') {
      if (state.effectiveModelId !== model.modelId && state.effectiveModelId !== action.targetModelId) {
        return planningError('PLAN_CONFLICT', 'Execution binding selects conflicting target models', controls);
      }
      const error = switchExecutionModel(state, action.targetModelId, action.routeOptionId);
      if (error) return error;
      state.suppressReasoningWire ||= action.suppressReasoningWire === true;
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
      state.activeTier = tier;
    }
  }
  return undefined;
}

/** Route headers merged with binding headers and the active tier's activation. */
function resolveRequestHeaders(state: RequestPlanningState): PlanningStep<Record<string, string>> {
  const { controls, activeTier, maxMode } = state;
  const headers = { ...(state.route.headers ?? {}) };
  const bindingHeaderConflict = mergeHeaders(headers, state.bindingHeaders);
  if (bindingHeaderConflict) {
    return planningError('PLAN_CONFLICT', `Execution binding conflicts at header ${bindingHeaderConflict}`, controls);
  }
  if (maxMode && state.tierChoices.maxTierUnverified) {
    state.warnings.push('Max mode entitlement is unverified');
  } else if (activeTier.entitlement === 'unknown') {
    state.warnings.push(maxMode
      ? 'Max mode entitlement is unverified'
      : `Context tier ${activeTier.label} is unverified`);
  }
  if (activeTier.activation.kind === 'header') {
    const conflict = mergeHeaders(headers, activeTier.activation.headers);
    if (conflict) {
      return planningError('PLAN_CONFLICT', `Context tier conflicts at header ${conflict}`, controls);
    }
  } else if (activeTier.activation.kind === 'body') {
    const conflict = mergePatch(state.bodyPatch, activeTier.activation.patch);
    if (conflict) {
      return planningError('PLAN_CONFLICT', `Context tier conflicts at ${conflict}`, controls);
    }
  }
  return { ok: true, value: headers };
}

/** Context window, prompt budget, output ceiling and compaction threshold of the active tier. */
function planContextBudget(state: RequestPlanningState): PlanningStep<ContextBudgetPlan> {
  const { model, controls, activeTier } = state;
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

  const requestedBudget = state.maxMode
    ? (contextTierPromptCap(activeTier) ?? contextWindowTokens)
    : model.defaultBudgetTokens;
  const contextBudgetTokens = contextTierBudgetTokens(activeTier, requestedBudget);
  const maxOutputTokens = resolvePlanningOutputTokens(activeTier, contextWindowTokens);
  const compactionThresholdPercent = sanitizeCompactionThresholdPercent(
    state.input.compactionThresholdPercent,
    DEFAULT_CONTEXT_COMPACTION_PERCENT,
  );
  const compactionThresholdTokens = resolveCompactionThresholdTokens(
    contextBudgetTokens,
    compactionThresholdPercent,
  );
  return { ok: true, value: { contextWindowTokens, contextBudgetTokens, maxOutputTokens, compactionThresholdTokens } };
}

/** The reasoning selection sent on the wire; a known selection is written back to the controls. */
function resolveReasoningWire(state: RequestPlanningState): RequestPlan['reasoningWire'] {
  const { model, controls } = state;
  const reasoningSelection = model.controls.reasoning.kind === 'unknown'
    || (model.controls.reasoning.defaultState && model.controls.reasoning.defaultState !== 'known'
      && state.input.controls?.reasoningLevel === undefined)
    ? 'unknown' as const
    : clampReasoningSelection(controls.reasoningLevel, model.controls.reasoning)
      ?? model.controls.reasoning.defaultSelection;
  if (reasoningSelection !== 'unknown') controls.reasoningLevel = reasoningSelection;
  const reasoningControl = createReasoningControl(model.controls.reasoning);
  if (state.suppressReasoningWire) reasoningControl.wireProfile = { kind: 'none' };
  return { selection: reasoningSelection, control: reasoningControl };
}

/** Route contracts (with the model cache contract), the tool-loop continuation patch and the state mode. */
function resolveRouteContracts(
  state: RequestPlanningState,
): PlanningStep<{ contracts: RequestPlan['contracts']; stateMode: ProviderStateMode }> {
  const { model, controls, effectiveModelId } = state;
  const routeContracts = state.route.contracts ?? createFailClosedProviderContracts(state.route.protocol);
  const contracts = state.effectiveModel.cacheContract
    ? { ...routeContracts, cache: state.effectiveModel.cacheContract }
    : routeContracts;
  state.route = { ...state.route, contracts };
  const continuationModelAdmitted = !contracts.reasoning.continuationModelIds
    || contracts.reasoning.continuationModelIds.includes(effectiveModelId);
  if (
    continuationModelAdmitted
    && contracts.reasoning.continuation !== 'none'
    && contracts.reasoning.continuation !== 'unknown'
    && contracts.toolLoop.requestPatch
  ) {
    const conflict = mergePatch(state.bodyPatch, contracts.toolLoop.requestPatch);
    if (conflict) {
      return planningError('PLAN_CONFLICT', `Tool-loop continuation conflicts at ${conflict}`, controls);
    }
  }
  const stateMode = state.input.stateMode ?? contracts.state.defaultMode;
  if (!contracts.state.supportedModes.includes(stateMode)) {
    return planningError(
      'CONSTRAINT_REJECTED',
      `State mode ${stateMode} is not supported by ${model.providerId}/${effectiveModelId}`,
      controls,
    );
  }
  return { ok: true, value: { contracts, stateMode } };
}

/** The execution identity that binds continuations and caches to the exact provider route and model. */
function buildExecutionIdentity(
  state: RequestPlanningState,
  facts: {
    contracts: RequestPlan['contracts'];
    stateMode: ProviderStateMode;
    catalogRevision: string;
    appliedBindingIds: string[];
    contextMode: RequestPlan['contextMode'];
    toolLoopPhase: ToolLoopPhase;
    reasoningSelection: RequestPlan['reasoningWire']['selection'];
  },
): ExecutionIdentity {
  const { model, route, effectiveModelId, selectedRouteRevision } = state;
  const { contracts, catalogRevision, appliedBindingIds, contextMode, reasoningSelection } = facts;
  const contractHash = revisionFor(contracts);
  const credentialScopeHash = revisionFor({
    providerId: model.providerId,
    credentialScopeId: state.input.credentialScopeId ?? 'default',
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
    canonicalModelId: state.effectiveModel.modelId,
    modelSnapshotId: revisionFor({
      catalogRevision,
      routeRevision: selectedRouteRevision,
      effectiveModelId,
      provenance: modelIdentityProvenance(state.effectiveModel),
    }),
    compatibilityGroup: contracts.compatibilityGroup,
    bindingIds: appliedBindingIds,
    variantKey: revisionFor({
      bindingIds: appliedBindingIds,
      fast: state.evaluation.resolved.fast.value,
      contextMode,
      reasoningSelection,
    }),
    reasoningMode: reasoningSelection,
    contextMode,
    stateMode: facts.stateMode,
    artifactFormat: contracts.reasoning.artifactFormat,
    artifactVersion: contracts.reasoning.artifactVersion,
    contractHash,
    toolLoopPhase: facts.toolLoopPhase,
  };
  return {
    ...identityBase,
    fingerprint: revisionFor(identityBase),
  };
}

/** State, cache, tool-loop, streaming and context-transition plans derived from the route contracts. */
function planContractBehaviour(
  contracts: RequestPlan['contracts'],
  stateMode: ProviderStateMode,
  toolLoopPhase: ToolLoopPhase,
): Pick<RequestPlan, 'statePlan' | 'cachePlan' | 'toolLoopPlan' | 'streamingPlan' | 'contextTransitionPlan'> {
  return {
    statePlan: {
      mode: stateMode,
      carrier: stateMode === 'provider-managed' ? contracts.state.carrier : 'none' as const,
      store: stateMode === 'provider-managed',
      reuseProviderState: stateMode === 'provider-managed',
    },
    cachePlan: {
      enabled: contracts.cache.mode !== 'none' && contracts.cache.mode !== 'unknown',
      mode: contracts.cache.mode,
      keyCarrier: contracts.cache.keyCarrier,
      breakpointCarrier: contracts.cache.breakpointCarrier,
      telemetry: [...contracts.cache.telemetry],
      ttl: contracts.cache.ttl,
    },
    toolLoopPlan: {
      phase: toolLoopPhase,
      pinned: true as const,
      artifactPolicy: contracts.toolLoop.artifactPolicy,
      artifactScope: contracts.toolLoop.artifactScope,
      ordering: contracts.toolLoop.ordering,
    },
    streamingPlan: { ...contracts.streaming },
    contextTransitionPlan: stateMode === 'provider-managed'
      ? {
          strategy: 'provider-managed' as const,
          portable: false,
          reason: 'Explicit provider-managed state mode.',
        }
      : {
          strategy: 'semantic-replay' as const,
          portable: true,
          reason: 'Local stateless mode replays canonical semantic context.',
        },
  };
}

export function planModelRequest(input: RequestPlannerInput): RequestPlanningResult {
  const { model } = input;
  const evaluation = resolveModelControls(model, input.controls, input.catalogModels);
  const controls = evaluation.controls;
  const ineligible = rejectIneligibleModel(input, evaluation);
  if (ineligible) return ineligible;
  const created = createPlanningState(input, evaluation);
  if (!created.ok) return created;
  const state = created.value;
  const bindingFailure = applyExecutionBinding(state);
  if (bindingFailure) return bindingFailure;
  const headers = resolveRequestHeaders(state);
  if (!headers.ok) return headers;
  const budget = planContextBudget(state);
  if (!budget.ok) return budget;
  const reasoningWire = resolveReasoningWire(state);
  const resolvedContracts = resolveRouteContracts(state);
  if (!resolvedContracts.ok) return resolvedContracts;
  const { contracts, stateMode } = resolvedContracts.value;

  const catalogRevision = model.catalogRevision ?? revisionFor({
    providerId: model.providerId,
    modelId: model.modelId,
    provenance: modelIdentityProvenance(model),
  });
  const appliedBindingIds = evaluation.binding ? [evaluation.binding.id] : [];
  const contextMode = state.maxMode ? 'one-million' as const : 'normal' as const;
  const toolLoopPhase = input.toolLoopPhase ?? 'top-level';
  const executionIdentity = buildExecutionIdentity(state, {
    contracts, stateMode, catalogRevision, appliedBindingIds, contextMode, toolLoopPhase,
    reasoningSelection: reasoningWire.selection,
  });
  const { route, effectiveModelId, effectiveModel } = state;
  const plan: RequestPlan = {
    providerId: model.providerId,
    adapterId: providerAdapterIdForProtocol(route.protocol),
    catalogRevision,
    routeRevision: state.selectedRouteRevision,
    selectedModelId: model.modelId,
    effectiveModelId,
    appliedBindingIds,
    modelSelection: state.modelSelection,
    route,
    headers: headers.value,
    contracts,
    executionIdentity,
    ...planContractBehaviour(contracts, stateMode, toolLoopPhase),
    bodyPatch: state.bodyPatch,
    contextBudgetTokens: budget.value.contextBudgetTokens,
    contextMode,
    contextWindowTokens: budget.value.contextWindowTokens,
    maxOutputTokens: budget.value.maxOutputTokens,
    compactionThresholdTokens: budget.value.compactionThresholdTokens,
    activeTierId: state.activeTier.id,
    fastMode: evaluation.resolved.fast.value,
    reasoningWire,
    temperature: typeof effectiveModel.fixedTemperature === 'number'
      ? effectiveModel.fixedTemperature
      : typeof model.fixedTemperature === 'number'
        ? model.fixedTemperature
        : input.requestedTemperature,
  };
  return { ok: true, plan, controls, warnings: state.warnings };
}

export function createReasoningControl(control: ReasoningControl): ReasoningControl {
  return {
    ...control,
    levels: [...control.levels],
    wireProfile: cloneReasoningWireProfile(control.wireProfile),
  };
}

function cloneReasoningWireProfile(profile: ReasoningWireProfile): ReasoningWireProfile {
  switch (profile.kind) {
    case 'openai-responses':
      return {
        ...profile,
        levels: { ...profile.levels },
      };
    case 'openai-compatible':
      return {
        ...profile,
        levels: profile.levels ? { ...profile.levels } : profile.levels,
      };
    case 'anthropic':
      return {
        ...profile,
        levels: profile.levels ? { ...profile.levels } : profile.levels,
      };
    case 'gemini-thinking-level':
      return {
        ...profile,
        levels: { ...profile.levels },
      };
    case 'gemini-thinking-budget':
      return {
        ...profile,
        levels: { ...profile.levels },
      };
    case 'moonshot-thinking':
    case 'none':
    default:
      return { ...profile };
  }
}
