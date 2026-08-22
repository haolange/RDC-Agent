import { describe, expect, it } from 'vitest';
import { isEffectiveModelPickerSelectable } from './effectiveModelPicker';

describe('isEffectiveModelPickerSelectable', () => {
  it('keeps unverified account models selectable', () => {
    expect(isEffectiveModelPickerSelectable({
      enabled: true,
      availability: 'unknown',
      selection: { pickerVisibility: 'primary' },
    })).toBe(true);
  });

  it('hides denied, disabled, and internal models', () => {
    expect(isEffectiveModelPickerSelectable({
      enabled: true,
      availability: 'unavailable',
    })).toBe(false);
    expect(isEffectiveModelPickerSelectable({
      enabled: false,
      availability: 'available',
    })).toBe(false);
    expect(isEffectiveModelPickerSelectable({
      enabled: true,
      availability: 'available',
      selection: { pickerVisibility: 'internal' },
    })).toBe(false);
  });
});
