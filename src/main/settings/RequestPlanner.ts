import type {
  EffectiveModel,
  JsonObject,
  JsonValue,
  RequestPlan,
  RequestPlanningErrorCode,
  RequestPlanningResult,
} from '@shared/types/providerCapability';
import type {
  ConversationTurnControls,
} from '@shared/types/modelCapability';
import {
  clampReasoningSelection,
  createReasoningControl,
} from '@shared/types/modelCapability';
import {
  contextTierPromptCap,
  contextTierWindowTokens,
  ONE_MILLION_CONTEXT_TOKENS,
  resolveContextTierChoices,
} from '@shared/utils/contextTiers';
import { evaluateModelControls } from '@shared/utils/modelControls';

export interface RequestPlannerInput {
  model: EffectiveModel;
  controls?: Partial<ConversationTurnControls> & { reasoningLevel?: unknown };
  clientBudgetTokens?: number;
  requestedTemperature?: number;
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
  const evaluated = evaluateModelControls(model, input.controls);
  const controls = evaluated.controls;
  if (model.availability !== 'available') {
    return planningError(
      'MODEL_UNAVAILABLE',
      model.unavailableReason ?? `${model.modelId} is ${model.availability === 'unknown' ? 'not yet verified' : 'unavailable'}`,
      controls,
    );
  }
  if (evaluated.error) {
    return planningError('CONSTRAINT_REJECTED', evaluated.error.message, controls);
  }

  const tierChoices = resolveContextTierChoices(model);
  let activeTier = controls.maxContextMode ? tierChoices.oneMillionTier : tierChoices.normalTier;
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
    warnings.push(controls.maxContextMode
      ? '1M context entitlement is unverified'
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
  } else if (activeTier.activation.kind === 'model-variant') {
    if (effectiveModelId !== model.modelId && effectiveModelId !== activeTier.activation.modelId) {
      return planningError('PLAN_CONFLICT', 'Fast mode and context tier select different model variants', controls);
    }
    effectiveModelId = activeTier.activation.modelId;
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
  const defaultBudget = model.defaultBudgetTokens;
  const requestedBudget = controls.maxContextMode
    ? ONE_MILLION_CONTEXT_TOKENS
    : typeof input.clientBudgetTokens === 'number' && input.clientBudgetTokens > 0
      ? input.clientBudgetTokens
      : defaultBudget;
  const contextBudgetTokens = tierCap ? Math.min(requestedBudget, tierCap) : requestedBudget;
  const reasoningSelection = clampReasoningSelection(controls.reasoningLevel, model.reasoning)
    ?? model.reasoning.defaultSelection;
  controls.reasoningLevel = reasoningSelection;
  const reasoningControl = createReasoningControl(model.reasoning);
  if (model.reasoning.modelVariants) {
    const reasoningModelId = reasoningSelection === 'off'
      ? model.reasoning.modelVariants.offModelId
      : model.reasoning.modelVariants.onModelId;
    if (effectiveModelId !== model.modelId && effectiveModelId !== reasoningModelId) {
      return planningError('PLAN_CONFLICT', 'Reasoning and another control select different model variants', controls);
    }
    effectiveModelId = reasoningModelId;
    reasoningControl.wireProfile = { kind: 'none' };
  }

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
    contextMode: controls.maxContextMode ? 'one-million' : 'normal',
    contextWindowTokens,
    activeTierId: activeTier.id,
    fastMode: controls.fastModel,
    reasoningWire: {
      selection: reasoningSelection,
      control: reasoningControl,
    },
    temperature: typeof model.fixedTemperature === 'number'
      ? model.fixedTemperature
      : input.requestedTemperature,
  };
  return { ok: true, plan, controls, warnings };
}
