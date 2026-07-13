import type { ConversationTurnControls } from '../types/modelCapability';
import { clampReasoningSelection } from '../types/modelCapability';
import type {
  CapabilityConstraintSelector,
  EffectiveModel,
} from '../types/providerCapability';
import { resolveContextTierChoices } from './contextTiers';

export interface ModelControlEvaluation {
  controls: ConversationTurnControls;
  error?: { code: string; message: string };
}

export type ModelControlInput = Partial<Omit<ConversationTurnControls, 'reasoningLevel'>> & {
  reasoningLevel?: unknown;
};

export function isFastModeSelectable(model: EffectiveModel): boolean {
  return model.fast.kind !== 'unsupported'
    && model.fast.kind !== 'unknown'
    && model.fast.entitlement !== 'denied';
}

function clampToCapabilities(
  model: EffectiveModel,
  input: ModelControlInput,
): ConversationTurnControls {
  const choices = resolveContextTierChoices(model);
  return {
    reasoningLevel: clampReasoningSelection(input.reasoningLevel, model.reasoning)
      ?? model.reasoning.defaultSelection,
    maxContextMode: input.maxContextMode === true && Boolean(choices.maxTier),
    fastModel: input.fastModel === true && isFastModeSelectable(model),
  };
}

function selectorMatches(
  selector: CapabilityConstraintSelector,
  controls: ConversationTurnControls,
  tierId: string | undefined,
): boolean {
  if (selector.fast !== undefined && selector.fast !== controls.fastModel) return false;
  if (selector.maxContextMode !== undefined && selector.maxContextMode !== controls.maxContextMode) return false;
  if (selector.tierIds && (!tierId || !selector.tierIds.includes(tierId))) return false;
  if (selector.reasoningSelections && !selector.reasoningSelections.includes(controls.reasoningLevel)) return false;
  return true;
}

/** Shared UI/planner evaluator for capability clamps and declarative constraints. */
export function evaluateModelControls(
  model: EffectiveModel,
  input: ModelControlInput = {},
): ModelControlEvaluation {
  let controls = clampToCapabilities(model, input);
  const constraints = model.constraints ?? [];
  for (let pass = 0; pass <= constraints.length; pass += 1) {
    const before = JSON.stringify(controls);
    const choices = resolveContextTierChoices(model);
    const tier = controls.maxContextMode ? choices.maxTier : choices.baseTier;
    for (const constraint of constraints) {
      if (!selectorMatches(constraint.when, controls, tier?.id)) continue;
      if (constraint.action.kind === 'reject') {
        return {
          controls,
          error: { code: constraint.action.code, message: constraint.reason },
        };
      }
      const { control, value } = constraint.action;
      if (control === 'reasoningLevel' && typeof value === 'string') {
        controls.reasoningLevel = clampReasoningSelection(value, model.reasoning)
          ?? model.reasoning.defaultSelection;
      } else if (control === 'fastModel' && typeof value === 'boolean') {
        controls.fastModel = value;
      } else if (control === 'maxContextMode' && typeof value === 'boolean') {
        controls.maxContextMode = value;
      }
    }
    controls = clampToCapabilities(model, controls);
    if (JSON.stringify(controls) === before) return { controls };
  }
  return {
    controls,
    error: {
      code: 'CONSTRAINT_CYCLE',
      message: 'Capability constraints did not converge',
    },
  };
}
