import { describe, expect, it } from 'vitest';
import {
  buildDisplaySelections,
  buildEffortPillPresentation,
  clampSliderRatio,
  findAdjacentSupportedLevel,
  getStopPosition,
  resolveReasoningIconVariant,
  resolveNearestSnapLevel,
} from './effortControlParts';
import {
  isMaxTierLevel,
  MAX_VISUAL_EVOLVE_MS,
  MAX_VISUAL_RETREAT_MS,
  resolveMaxFieldCoverage,
  resolveMaxStopsOpacity,
} from './maxVisual';

describe('effortControlParts', () => {
  it('builds visible selections for levels, toggle, and always-on controls', () => {
    expect(buildDisplaySelections({
      kind: 'levels',
      supportsOff: true,
      levels: ['low', 'medium', 'high', 'extra'],
      defaultSelection: 'medium',
      wireProfile: { kind: 'none' },
    })).toEqual(['off', 'low', 'medium', 'high', 'extra']);

    expect(buildDisplaySelections({
      kind: 'toggle',
      supportsOff: true,
      levels: [],
      defaultSelection: 'on',
      wireProfile: { kind: 'none' },
    })).toEqual(['off', 'on']);

    expect(buildDisplaySelections({
      kind: 'always-on',
      supportsOff: false,
      levels: [],
      defaultSelection: 'on',
      lockedSelection: 'on',
      wireProfile: { kind: 'none' },
    })).toEqual(['on']);
  });

  it('maps every reasoning selection to a stable pill icon variant', () => {
    expect(resolveReasoningIconVariant('off')).toBe('off');
    expect(resolveReasoningIconVariant('minimal')).toBe('minimal');
    expect(resolveReasoningIconVariant('low')).toBe('low');
    expect(resolveReasoningIconVariant('medium')).toBe('medium');
    expect(resolveReasoningIconVariant('on')).toBe('medium');
    expect(resolveReasoningIconVariant('high')).toBe('high');
    expect(resolveReasoningIconVariant('extra')).toBe('extra');
    expect(resolveReasoningIconVariant('max')).toBe('max');
    expect(resolveReasoningIconVariant('ultra')).toBe('max-plus');
  });

  it('keeps reasoning, max context, and fast mode as separate pill states', () => {
    const presentation = buildEffortPillPresentation({
      reasoningLabel: 'Max',
      maxContextMode: true,
      maxContextLabel: 'Max context',
      maxContextBadgeLabel: '1M',
      fastModel: true,
      fastModelLabel: 'Fast mode',
      fastModelBadgeLabel: '2x',
    });

    expect(presentation.label).toBe('Max');
    expect(presentation.title).toBe('Max | Max context | Fast mode');
    expect(presentation.badges).toEqual([
      { mode: 'max-context', label: '1M', title: 'Max context' },
      { mode: 'fast', label: '2x', title: 'Fast mode' },
    ]);
    expect(presentation.label).not.toContain('Max context');
  });

  it('calculates stop positions and clamps drag ratios', () => {
    expect(getStopPosition(0, 1)).toBe(0);
    expect(getStopPosition(2, 5)).toBe(0.5);
    expect(clampSliderRatio(-1)).toBe(0);
    expect(clampSliderRatio(0.25)).toBe(0.25);
    expect(clampSliderRatio(9)).toBe(1);
  });

  it('snaps to the nearest visible level and moves across adjacent stops', () => {
    const supported = ['off', 'low', 'medium', 'high', 'extra'] as const;

    expect(resolveNearestSnapLevel(0, [...supported])).toBe('off');
    expect(resolveNearestSnapLevel(0.24, [...supported])).toBe('low');
    expect(resolveNearestSnapLevel(0.76, [...supported])).toBe('high');
    expect(resolveNearestSnapLevel(1, [...supported])).toBe('extra');

    expect(findAdjacentSupportedLevel('medium', -1, [...supported])).toBe('low');
    expect(findAdjacentSupportedLevel('medium', 1, [...supported])).toBe('high');
    expect(findAdjacentSupportedLevel('off', -1, [...supported])).toBeNull();
  });

  it('treats max and ultra as the shared top-tier visual pipeline', () => {
    expect(isMaxTierLevel('max')).toBe(true);
    expect(isMaxTierLevel('ultra')).toBe(true);
    expect(isMaxTierLevel('high')).toBe(false);
    expect(MAX_VISUAL_EVOLVE_MS).toBe(800);
    expect(MAX_VISUAL_RETREAT_MS).toBe(800);
  });

  it('maps max visual phases to stop opacity and field coverage', () => {
    expect(resolveMaxStopsOpacity({ phase: 'idle', progress: 0, evolveHideStops: false })).toBe(1);
    expect(resolveMaxStopsOpacity({ phase: 'preview', progress: 0, evolveHideStops: false })).toBe(1);
    expect(resolveMaxStopsOpacity({ phase: 'evolve', progress: 0.25, evolveHideStops: false })).toBe(0.75);
    expect(resolveMaxStopsOpacity({ phase: 'evolve', progress: 0.25, evolveHideStops: true })).toBe(0);
    expect(resolveMaxStopsOpacity({ phase: 'settled', progress: 1, evolveHideStops: false })).toBe(0);
    expect(resolveMaxStopsOpacity({ phase: 'retreat', progress: 0.4, evolveHideStops: false })).toBe(0.4);
    expect(resolveMaxStopsOpacity({ phase: 'retreat', progress: 0.4, evolveHideStops: false, retreatStopsFrom: 0 })).toBe(0.4);
    expect(resolveMaxStopsOpacity({ phase: 'retreat', progress: 0.5, evolveHideStops: false, retreatStopsFrom: 1 })).toBe(1);
    expect(resolveMaxStopsOpacity({ phase: 'retreat', progress: 0.5, evolveHideStops: false, retreatStopsFrom: 0.2 })).toBeCloseTo(0.6);

    expect(resolveMaxFieldCoverage({ phase: 'idle', progress: 0 })).toBe(0);
    expect(resolveMaxFieldCoverage({ phase: 'preview', progress: 0 })).toBe(0);
    expect(resolveMaxFieldCoverage({ phase: 'evolve', progress: 0.6 })).toBe(0.6);
    expect(resolveMaxFieldCoverage({ phase: 'settled', progress: 1 })).toBe(1);
    expect(resolveMaxFieldCoverage({ phase: 'retreat', progress: 0.25 })).toBe(0.75);
  });
});
