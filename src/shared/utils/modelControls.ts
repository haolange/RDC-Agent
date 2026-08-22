import type { ConversationTurnControls } from '../types/modelCapability';
import { clampReasoningSelection } from '../types/modelCapability';
import type {
  ControlDefinition,
  EffectiveModel,
  ExecutionBindingDefinition,
  ExecutionBindingResolution,
  ResolvedBooleanControlCapability,
  ResolvedModelControls,
} from '../types/providerCapability';
import { contextTierWindowTokens, isEligibleMaxContextTier } from './contextTiers';

export interface ModelControlEvaluation {
  controls: ConversationTurnControls;
  resolved: ResolvedModelControls;
  binding?: ExecutionBindingDefinition;
  error?: { code: string; message: string };
}

export type ModelControlInput = Partial<Omit<ConversationTurnControls, 'reasoningLevel'>> & {
  reasoningLevel?: unknown;
};

function definitionValue(definition: ControlDefinition, requested: boolean): boolean {
  switch (definition.state) {
    case 'fixed': return definition.fixedValue;
    case 'selectable': return requested;
    case 'provider-managed': return definition.fixedValue ?? definition.defaultValue ?? false;
    case 'unknown': return definition.defaultValue;
    case 'unsupported': return definition.fixedValue;
  }
}

function selectorMatches(
  model: EffectiveModel,
  binding: ExecutionBindingDefinition,
  controls: ConversationTurnControls,
): boolean {
  if (binding.when.fast !== undefined && binding.when.fast !== controls.fastModel) return false;
  if (binding.when.maxContext !== undefined && binding.when.maxContext !== controls.maxContextMode) return false;
  if (binding.when.reasoning && !binding.when.reasoning.includes(controls.reasoningLevel)) return false;
  if (!binding.routeOptionIds?.length) return true;
  const selectedRouteOptionId = model.preferredRouteOptionId
    ?? model.routeOptions?.find((option) => (
      option.routeRevision === model.routeRevision
      || (option.route.protocol === model.route.protocol && option.route.baseUrl === model.route.baseUrl)
    ))?.id
    ?? model.route.protocol;
  return binding.routeOptionIds.includes(selectedRouteOptionId);
}

function bindingSpecificity(binding: ExecutionBindingDefinition): number {
  return Number(binding.when.fast !== undefined)
    + Number(binding.when.maxContext !== undefined)
    + Number(Boolean(binding.when.reasoning));
}

function selectBinding(
  model: EffectiveModel,
  controls: ConversationTurnControls,
): { binding?: ExecutionBindingDefinition; error?: ModelControlEvaluation['error'] } {
  const matches = (model.executionBindings ?? [])
    .filter((binding) => selectorMatches(model, binding, controls))
    .sort((left, right) => bindingSpecificity(right) - bindingSpecificity(left));
  if (matches.length < 2 || bindingSpecificity(matches[0]) !== bindingSpecificity(matches[1])) {
    return { binding: matches[0] };
  }
  if (JSON.stringify(matches[0].actions) === JSON.stringify(matches[1].actions)) {
    return { binding: matches[0] };
  }
  return {
    error: {
      code: 'PLAN_CONFLICT',
      message: `Conflicting execution bindings ${matches[0].id} and ${matches[1].id}`,
    },
  };
}

export function resolveExecutionBinding(
  model: EffectiveModel,
  binding: ExecutionBindingDefinition,
  catalogModels?: readonly EffectiveModel[],
): ExecutionBindingResolution {
  if (binding.entitlement !== 'granted') {
    return binding.entitlement === 'denied'
      ? { state: 'blocked', reason: binding.unavailableReason ?? 'Execution binding is not entitled.' }
      : { state: 'unknown', reason: binding.unavailableReason ?? 'Execution binding entitlement is not yet verified.' };
  }
  const selectedRouteOption = model.preferredRouteOptionId
    ? model.routeOptions?.find((option) => option.id === model.preferredRouteOptionId)
    : model.routeOptions?.find((option) => (
      option.routeRevision === model.routeRevision
      || (option.route.protocol === model.route.protocol && option.route.baseUrl === model.route.baseUrl)
    ));
  const selectedRouteOptionId = selectedRouteOption?.id ?? model.preferredRouteOptionId ?? model.route.protocol;
  const selectedProtocol = selectedRouteOption?.route.protocol ?? model.route.protocol;
  if (binding.routeOptionIds?.length && !binding.routeOptionIds.includes(selectedRouteOptionId)) {
    return { state: 'blocked', reason: 'Execution binding is not available for the selected route.' };
  }
  let effectiveModelId = model.modelId;
  for (const action of binding.actions) {
    if (action.kind === 'unsupported') {
      return { state: 'blocked', reason: action.reason ?? binding.unavailableReason ?? 'Control combination is unsupported.' };
    }
    if (action.kind !== 'model-switch') continue;
    effectiveModelId = action.targetModelId;
    const target = catalogModels?.find((candidate) => candidate.modelId === action.targetModelId)
      ?? catalogModels?.find((candidate) => candidate.aliases.includes(action.targetModelId));
    if (!target) {
      const projected = model.bindingResolutions?.[binding.id];
      return projected ?? {
        state: 'blocked',
        reason: `Execution target ${action.targetModelId} is not present in the effective Catalog.`,
        effectiveModelId: action.targetModelId,
      };
    }
    if (target.availability !== 'available' || target.enabled === false) {
      return {
        state: 'blocked',
        reason: target.unavailableReason
          ?? `Execution target ${action.targetModelId} is ${target.availability === 'unknown' ? 'unverified' : 'unavailable'}.`,
        effectiveModelId: action.targetModelId,
      };
    }
    const targetRouteOption = action.routeOptionId
      ? target.routeOptions?.find((option) => option.id === action.routeOptionId)
      : target.routeOptions?.find((option) => option.id === selectedRouteOptionId && option.route.protocol === selectedProtocol)
        ?? target.routeOptions?.find((option) => option.route.protocol === selectedProtocol);
    const targetProtocol = targetRouteOption?.route.protocol ?? target.route.protocol;
    if (targetProtocol !== selectedProtocol) {
      return {
        state: 'blocked',
        reason: `Execution target ${action.targetModelId} is incompatible with the selected protocol.`,
        effectiveModelId: action.targetModelId,
      };
    }
    if (action.routeOptionId && !targetRouteOption) {
      return {
        state: 'blocked',
        reason: `Execution target route ${action.routeOptionId} is unavailable.`,
        effectiveModelId: action.targetModelId,
      };
    }
    if (targetRouteOption?.availability !== undefined && targetRouteOption.availability !== 'available') {
      return {
        state: 'blocked',
        reason: targetRouteOption.unavailableReason
          ?? `Execution target route ${targetRouteOption.id} is ${targetRouteOption.availability}.`,
        effectiveModelId: action.targetModelId,
      };
    }
  }
  return { state: 'available', effectiveModelId };
}

function applyBindingResolution(
  control: ResolvedBooleanControlCapability,
  resolution: ExecutionBindingResolution,
  bindingId: string,
): ResolvedBooleanControlCapability {
  if (resolution.state === 'blocked') {
    return { ...control, state: 'blocked', value: false, disabled: true, reason: resolution.reason };
  }
  return {
    ...control,
    bindingId,
    effectiveModelId: resolution.effectiveModelId,
    reason: resolution.state === 'unknown' ? resolution.reason : control.reason,
  };
}

function resolvedDefinition(
  definition: ControlDefinition,
  value: boolean,
): ResolvedBooleanControlCapability {
  switch (definition.state) {
    case 'fixed':
      return {
        state: 'fixed',
        value: definition.fixedValue,
        defaultValue: definition.fixedValue,
        disabled: true,
        entitlement: definition.entitlement,
        tierId: definition.tierId,
      };
    case 'selectable': {
      if (definition.entitlement === 'denied') {
        return {
          state: 'blocked',
          value: false,
          defaultValue: definition.defaultValue,
          disabled: true,
          entitlement: definition.entitlement,
          reason: 'Control is not entitled for the active account.',
          tierId: definition.tierId,
        };
      }
      return {
        state: 'selectable',
        value,
        defaultValue: definition.defaultValue,
        disabled: false,
        entitlement: definition.entitlement,
        reason: definition.entitlement === 'unknown'
          ? 'Control entitlement is not yet verified.'
          : undefined,
        tierId: definition.tierId,
      };
    }
    case 'provider-managed': {
      const managedValue = definition.fixedValue ?? definition.defaultValue ?? false;
      return {
        state: 'provider-managed',
        value: managedValue,
        defaultValue: managedValue,
        disabled: true,
        reason: definition.reason,
      };
    }
    case 'unknown':
      return {
        state: 'unknown',
        value: definition.defaultValue,
        defaultValue: definition.defaultValue,
        disabled: true,
        reason: definition.reason,
      };
    case 'unsupported':
      return {
        state: 'unsupported',
        value: definition.fixedValue,
        defaultValue: definition.fixedValue,
        disabled: true,
        reason: definition.reason,
      };
  }
}

function resolveNormalTier(model: EffectiveModel) {
  return model.contextTiers.find((tier) => tier.id === 'default' && tier.entitlement !== 'denied')
    ?? model.contextTiers.find((tier) => tier.entitlement !== 'denied');
}

export function resolveModelControls(
  model: EffectiveModel,
  input: ModelControlInput = {},
  catalogModels?: readonly EffectiveModel[],
): ModelControlEvaluation {
  const requestedFast = input.fastModel === true;
  const requestedContext = input.maxContextMode === true;
  let controls: ConversationTurnControls = {
    reasoningLevel: clampReasoningSelection(input.reasoningLevel, model.controls.reasoning)
      ?? model.controls.reasoning.defaultSelection,
    fastModel: definitionValue(model.controls.fast, requestedFast),
    maxContextMode: definitionValue(model.controls.maxContext, requestedContext),
  };
  let fast = resolvedDefinition(model.controls.fast, controls.fastModel);
  let maxContext = resolvedDefinition(model.controls.maxContext, controls.maxContextMode);

  const hypotheticalFast = { ...controls, fastModel: true };
  const fastBindingSelection = model.controls.fast.state === 'selectable'
    ? selectBinding(model, hypotheticalFast)
    : {};
  if (model.controls.fast.state === 'selectable') {
    if (fastBindingSelection.error) {
      fast = { ...fast, state: 'blocked', value: false, disabled: true, reason: fastBindingSelection.error.message };
    } else if (!fastBindingSelection.binding) {
      fast = { ...fast, state: 'blocked', value: false, disabled: true, reason: 'Fast has no execution binding.' };
    } else {
      const resolution = resolveExecutionBinding(model, fastBindingSelection.binding, catalogModels);
      fast = applyBindingResolution(fast, resolution, fastBindingSelection.binding.id);
    }
  }

  if (model.controls.maxContext.state === 'selectable' || model.controls.maxContext.state === 'fixed') {
    const contextTierId = model.controls.maxContext.tierId;
    const tier = model.contextTiers.find((candidate) => candidate.id === contextTierId);
    const normalTier = resolveNormalTier(model);
    if (!tier || tier.entitlement === 'denied') {
      maxContext = {
        ...maxContext,
        state: 'blocked',
        value: false,
        disabled: true,
        reason: !tier ? 'Max mode tier is missing.' : 'Max mode tier is not entitled.',
      };
    } else if (!normalTier || contextTierWindowTokens(tier) === undefined || contextTierWindowTokens(normalTier) === undefined) {
      maxContext = {
        ...maxContext,
        state: 'blocked',
        value: false,
        disabled: true,
        reason: 'Max mode tier is missing a numeric window.',
      };
    } else if (!isEligibleMaxContextTier(tier, normalTier)) {
      maxContext = {
        ...maxContext,
        state: 'blocked',
        value: false,
        disabled: true,
        reason: 'Max mode tier is not larger than the default context window.',
      };
    }
  }

  if (fast.state === 'blocked') controls = { ...controls, fastModel: false };
  if (maxContext.state === 'blocked') controls = { ...controls, maxContextMode: false };
  const selectedBinding = selectBinding(model, controls);
  const resolved: ResolvedModelControls = {
    fast,
    maxContext,
    reasoning: model.controls.reasoning,
    catalogRevision: model.catalogRevision,
    routeRevision: model.routeRevision,
  };
  const blockedRequest = requestedFast && fast.state === 'blocked'
    ? { code: 'FAST_BLOCKED', message: fast.reason ?? 'Fast is unavailable.' }
    : requestedContext && maxContext.state === 'blocked'
      ? { code: 'MAX_CONTEXT_BLOCKED', message: maxContext.reason ?? 'Max mode is unavailable.' }
      : undefined;
  return {
    controls,
    resolved,
    binding: selectedBinding.binding,
    error: fastBindingSelection.error ?? selectedBinding.error ?? blockedRequest,
  };
}
