import type {
  CapabilityConstraintSelector,
  ContextTier,
  EffectiveModel,
  JsonObject,
  JsonValue,
  RequestPlan,
  RequestPlanningErrorCode,
  RequestPlanningResult,
} from '@shared/types/providerCapability';
import type {
  ConversationTurnControls,
  ReasoningControl,
} from '@shared/types/modelCapability';
import {
  clampReasoningSelection,
  createReasoningControl,
} from '@shared/types/modelCapability';

export interface RequestPlannerInput {
  model: EffectiveModel;
  controls?: Partial<ConversationTurnControls> & { reasoningLevel?: unknown };
  clientBudgetTokens?: number;
  requestedTemperature?: number;
}

function normalizeControls(
  controls: RequestPlannerInput['controls'],
  reasoning: ReasoningControl,
): ConversationTurnControls {
  return {
    reasoningLevel: clampReasoningSelection(controls?.reasoningLevel, reasoning)
      ?? reasoning.defaultSelection,
    maxContextMode: controls?.maxContextMode === true,
    fastModel: controls?.fastModel === true,
  };
}

function tierPromptCap(tier: ContextTier): number | undefined {
  if (typeof tier.maxPromptTokens === 'number' && tier.maxPromptTokens > 0) {
    return tier.maxPromptTokens;
  }
  if (typeof tier.maxTotalTokens === 'number' && tier.maxTotalTokens > 0) {
    const reserve = typeof tier.maxOutputTokens === 'number' && tier.maxOutputTokens > 0
      ? tier.maxOutputTokens
      : 0;
    return Math.max(1, tier.maxTotalTokens - reserve);
  }
  return undefined;
}

function selectTier(model: EffectiveModel, maxContextMode: boolean): ContextTier | undefined {
  const usable = model.contextTiers.filter((tier) => tier.entitlement !== 'denied');
  if (usable.length === 0) {
    return undefined;
  }
  if (!maxContextMode) {
    return usable.find((tier) => tier.entitlement === 'granted') ?? usable[0];
  }
  return usable[usable.length - 1];
}

function hasMaxChoice(model: EffectiveModel): boolean {
  const usable = model.contextTiers.filter((tier) => tier.entitlement !== 'denied');
  if (usable.length < 2) {
    return false;
  }
  const base = selectTier(model, false);
  const highest = selectTier(model, true);
  return Boolean(base && highest && base.id !== highest.id);
}

function selectorMatches(
  selector: CapabilityConstraintSelector,
  controls: ConversationTurnControls,
  tierId: string | undefined,
): boolean {
  if (selector.fast !== undefined && selector.fast !== controls.fastModel) {
    return false;
  }
  if (selector.maxContextMode !== undefined && selector.maxContextMode !== controls.maxContextMode) {
    return false;
  }
  if (selector.tierIds && (!tierId || !selector.tierIds.includes(tierId))) {
    return false;
  }
  if (selector.reasoningSelections && !selector.reasoningSelections.includes(controls.reasoningLevel)) {
    return false;
  }
  return true;
}

function applyConstraints(
  model: EffectiveModel,
  initial: ConversationTurnControls,
): { controls: ConversationTurnControls; error?: { code: string; message: string } } {
  const controls = { ...initial };
  const constraints = model.constraints ?? [];
  for (let pass = 0; pass <= constraints.length; pass += 1) {
    let changed = false;
    const tier = selectTier(model, controls.maxContextMode);
    for (const constraint of constraints) {
      if (!selectorMatches(constraint.when, controls, tier?.id)) {
        continue;
      }
      if (constraint.action.kind === 'reject') {
        return {
          controls,
          error: { code: constraint.action.code, message: constraint.reason },
        };
      }
      const { control, value } = constraint.action;
      if (control === 'reasoningLevel' && typeof value === 'string') {
        const next = clampReasoningSelection(value, model.reasoning) ?? model.reasoning.defaultSelection;
        if (controls.reasoningLevel !== next) {
          controls.reasoningLevel = next;
          changed = true;
        }
      } else if (control === 'fastModel' && typeof value === 'boolean' && controls.fastModel !== value) {
        controls.fastModel = value;
        changed = true;
      } else if (control === 'maxContextMode' && typeof value === 'boolean' && controls.maxContextMode !== value) {
        controls.maxContextMode = value;
        changed = true;
      }
    }
    if (!changed) {
      return { controls };
    }
  }
  return {
    controls,
    error: {
      code: 'CONSTRAINT_CYCLE',
      message: 'Capability constraints did not converge',
    },
  };
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
      if (conflict) {
        return conflict;
      }
      continue;
    }
    if (current !== undefined && !valuesEqual(current, value)) {
      return field;
    }
    target[key] = value;
  }
  return undefined;
}

function mergeHeaders(target: Record<string, string>, patch: Record<string, string>): string | undefined {
  for (const [name, value] of Object.entries(patch)) {
    const currentName = Object.keys(target).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    if (currentName && target[currentName] !== value) {
      return name;
    }
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

export function planModelRequest(input: RequestPlannerInput): RequestPlanningResult {
  const { model } = input;
  let controls = normalizeControls(input.controls, model.reasoning);
  if (model.availability === 'unavailable') {
    return planningError('MODEL_UNAVAILABLE', model.unavailableReason ?? `${model.modelId} is unavailable`, controls);
  }
  if (controls.maxContextMode && !hasMaxChoice(model)) {
    controls.maxContextMode = false;
  }
  if (controls.fastModel) {
    if (model.fast.kind === 'unsupported' || model.fast.kind === 'unknown' || model.fast.entitlement === 'denied') {
      controls.fastModel = false;
    }
  }

  const constrained = applyConstraints(model, controls);
  controls = constrained.controls;
  if (constrained.error) {
    return planningError('CONSTRAINT_REJECTED', constrained.error.message, controls);
  }

  let activeTier = selectTier(model, controls.maxContextMode);
  if (!activeTier) {
    return planningError('NO_USABLE_CONTEXT_TIER', `${model.modelId} has no usable context tier`, controls);
  }

  const warnings: string[] = [];
  let effectiveModelId = model.modelId;
  const headers = { ...(model.route.headers ?? {}) };
  const bodyPatch: JsonObject = {};

  if (controls.fastModel && model.fast.kind !== 'unsupported' && model.fast.kind !== 'unknown') {
    if (model.fast.entitlement === 'unknown') {
      warnings.push('Fast mode entitlement is unverified');
    }
    if (model.fast.kind === 'request-param') {
      const conflict = mergePatch(bodyPatch, model.fast.patch);
      if (conflict) {
        return planningError('PLAN_CONFLICT', `Fast mode conflicts at ${conflict}`, controls);
      }
    } else if (model.fast.kind === 'model-variant') {
      effectiveModelId = model.fast.modelId;
    } else if (model.fast.kind === 'client-tier') {
      const fastTierId = model.fast.tierId;
      const fastTier = model.contextTiers.find((tier) => tier.id === fastTierId && tier.entitlement !== 'denied');
      if (!fastTier) {
        return planningError('NO_USABLE_CONTEXT_TIER', `Fast tier ${model.fast.tierId} is unavailable`, controls);
      }
      activeTier = fastTier;
    }
  }

  if (activeTier.entitlement === 'unknown') {
    warnings.push(`Context tier ${activeTier.label} is unverified`);
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
  } else if (activeTier.activation.kind === 'model-variant') {
    if (effectiveModelId !== model.modelId && effectiveModelId !== activeTier.activation.modelId) {
      return planningError('PLAN_CONFLICT', 'Fast mode and context tier select different model variants', controls);
    }
    effectiveModelId = activeTier.activation.modelId;
  }

  const tierCap = tierPromptCap(activeTier);
  const defaultBudget = typeof model.defaultBudgetTokens === 'number' && model.defaultBudgetTokens > 0
    ? model.defaultBudgetTokens
    : tierCap ?? 256_000;
  const requestedBudget = typeof input.clientBudgetTokens === 'number' && input.clientBudgetTokens > 0
    ? input.clientBudgetTokens
    : controls.maxContextMode
      ? tierCap ?? defaultBudget
      : defaultBudget;
  const contextBudgetTokens = tierCap ? Math.min(requestedBudget, tierCap) : requestedBudget;
  const reasoningSelection = clampReasoningSelection(controls.reasoningLevel, model.reasoning)
    ?? model.reasoning.defaultSelection;
  controls.reasoningLevel = reasoningSelection;

  const plan: RequestPlan = {
    providerId: model.providerId,
    effectiveModelId,
    route: {
      ...model.route,
      headers: model.route.headers ? { ...model.route.headers } : undefined,
    },
    headers,
    bodyPatch,
    contextBudgetTokens,
    activeTierId: activeTier.id,
    reasoningWire: {
      selection: reasoningSelection,
      control: createReasoningControl(model.reasoning),
    },
    temperature: typeof model.fixedTemperature === 'number'
      ? model.fixedTemperature
      : input.requestedTemperature,
  };
  return { ok: true, plan, controls, warnings };
}
