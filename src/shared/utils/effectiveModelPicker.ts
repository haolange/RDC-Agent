import type { EffectiveAvailability } from '../types/providerCapability';

export interface EffectiveModelPickerCandidate {
  enabled?: boolean;
  availability?: EffectiveAvailability | string;
  selection?: { pickerVisibility?: string } | null;
}

/**
 * Composer / session override picker gate.
 * RequestPlanner still fail-closes unverified accounts at send time.
 * Only an explicit denial or an internal variant is hidden here.
 */
export function isEffectiveModelPickerSelectable(model: EffectiveModelPickerCandidate): boolean {
  return model.enabled !== false
    && model.availability !== 'unavailable'
    && model.selection?.pickerVisibility !== 'internal';
}
