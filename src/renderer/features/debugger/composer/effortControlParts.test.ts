import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  buildDisplaySelections,
  buildEffortPillPresentation,
  clampSliderRatio,
  EffortOneMillionContextSwitchRow,
  findAdjacentSupportedLevel,
  getStopPosition,
  resolveReasoningIconVariant,
  resolveNearestSnapLevel,
} from './effortControlParts';
import {
  isMaxTierLevel,
  MAX_VISUAL_EVOLVE_MS,
  MAX_VISUAL_RETREAT_MS,
  resolveMaxAnimationProgress,
  resolveMaxFieldCell,
  resolveMaxFieldCoverage,
  resolveMaxStopsOpacity,
} from './maxVisual';

describe('effortControlParts', () => {
  it('builds visible selections for levels, toggle, and always-on controls', () => {
    expect(buildDisplaySelections({
      kind: 'levels',
      supportsOff: true,
      levels: ['low', 'medium', 'high', 'xhigh'],
      defaultSelection: 'medium',
      wireProfile: { kind: 'none' },
    })).toEqual(['off', 'low', 'medium', 'high', 'xhigh']);

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
    expect(resolveReasoningIconVariant('xhigh')).toBe('xhigh');
    expect(resolveReasoningIconVariant('max')).toBe('max');
  });

  it('keeps reasoning, Max mode, and Fast mode as separate pill states', () => {
    const presentation = buildEffortPillPresentation({
      reasoningLabel: 'Reasoning Max',
      oneMillionContextMode: true,
      oneMillionContextLabel: 'Max mode',
      oneMillionContextBadgeLabel: 'Max mode',
      fastModel: true,
      fastModelLabel: 'Fast mode',
      fastModelBadgeLabel: '2x',
    });

    expect(presentation.label).toBe('Reasoning Max');
    expect(presentation.title).toBe('Reasoning Max | Max mode | Fast mode');
    expect(presentation.badges).toEqual([
      { mode: 'one-million-context', label: 'Max mode', title: 'Max mode' },
      { mode: 'fast', label: '2x', title: 'Fast mode' },
    ]);
    expect(presentation.label).not.toContain('Max mode');
  });

  it('projects unverified Max mode entitlement visibly and into the switch accessible name', () => {
    const markup = renderToStaticMarkup(React.createElement(EffortOneMillionContextSwitchRow, {
      label: 'Max mode',
      statusLabel: 'Unverified',
      available: true,
      active: false,
      onToggle: () => undefined,
    }));

    expect(markup).toContain('composer-effort-toggle-status');
    expect(markup).toContain('Unverified');
    expect(markup).toContain('aria-label="Max mode · Unverified"');
  });

  it('renders fixed Max mode as active and disabled instead of flashing off', () => {
    const markup = renderToStaticMarkup(React.createElement(EffortOneMillionContextSwitchRow, {
      label: 'Max mode',
      statusLabel: 'Fixed',
      available: false,
      active: true,
      onToggle: () => undefined,
    }));

    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('composer-effort-toggle active');
    expect(markup).toContain('Fixed');
  });

  it('calculates stop positions and clamps drag ratios', () => {
    expect(getStopPosition(0, 1)).toBe(0);
    expect(getStopPosition(2, 5)).toBe(0.5);
    expect(clampSliderRatio(-1)).toBe(0);
    expect(clampSliderRatio(0.25)).toBe(0.25);
    expect(clampSliderRatio(9)).toBe(1);
  });

  it('snaps to the nearest visible level and moves across adjacent stops', () => {
    const supported = ['off', 'low', 'medium', 'high', 'xhigh'] as const;

    expect(resolveNearestSnapLevel(0, [...supported])).toBe('off');
    expect(resolveNearestSnapLevel(0.24, [...supported])).toBe('low');
    expect(resolveNearestSnapLevel(0.76, [...supported])).toBe('high');
    expect(resolveNearestSnapLevel(1, [...supported])).toBe('xhigh');

    expect(findAdjacentSupportedLevel('medium', -1, [...supported])).toBe('low');
    expect(findAdjacentSupportedLevel('medium', 1, [...supported])).toBe('high');
    expect(findAdjacentSupportedLevel('off', -1, [...supported])).toBeNull();
  });

  it('treats max as the sole top-tier visual pipeline', () => {
    expect(isMaxTierLevel('max')).toBe(true);
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

  it('uses one symmetric progress curve for evolve and retreat', () => {
    expect(resolveMaxAnimationProgress(0, MAX_VISUAL_EVOLVE_MS)).toBe(0);
    expect(resolveMaxAnimationProgress(400, MAX_VISUAL_EVOLVE_MS)).toBe(0.5);
    expect(resolveMaxAnimationProgress(800, MAX_VISUAL_EVOLVE_MS)).toBe(1);
    expect(resolveMaxAnimationProgress(1_000, MAX_VISUAL_EVOLVE_MS)).toBe(1);

    const growCoverage = resolveMaxFieldCoverage({ phase: 'evolve', progress: 0.35 });
    const retreatCoverage = resolveMaxFieldCoverage({ phase: 'retreat', progress: 0.65 });
    expect(growCoverage).toBeCloseTo(retreatCoverage);
  });

  it('preserves stop opacity when evolve or preview transitions into retreat', () => {
    const evolveOpacity = resolveMaxStopsOpacity({
      phase: 'evolve',
      progress: 0.38,
      evolveHideStops: false,
    });
    expect(resolveMaxStopsOpacity({
      phase: 'retreat',
      progress: 0,
      evolveHideStops: false,
      retreatStopsFrom: evolveOpacity,
    })).toBe(evolveOpacity);

    const previewOpacity = resolveMaxStopsOpacity({
      phase: 'preview',
      progress: 0,
      evolveHideStops: false,
    });
    expect(resolveMaxStopsOpacity({
      phase: 'retreat',
      progress: 0,
      evolveHideStops: false,
      retreatStopsFrom: previewOpacity,
    })).toBe(1);
    expect(resolveMaxStopsOpacity({
      phase: 'evolve',
      progress: 0,
      evolveHideStops: true,
    })).toBe(0);
  });

  it('keeps max pixel topology deterministic, porous, and brighter on the right', () => {
    const cols = 72;
    const rows = 5;
    const samples = Array.from({ length: cols * rows }, (_, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      return { col, sample: resolveMaxFieldCell({ col, row, cols, rows, coverage: 1 }) };
    });
    expect(samples[137]?.sample).toEqual(resolveMaxFieldCell({
      col: 137 % cols,
      row: Math.floor(137 / cols),
      cols,
      rows,
      coverage: 1,
    }));

    const visible = samples.filter(({ sample }) => sample.visible);
    expect(visible.length).toBeGreaterThan(samples.length * 0.65);
    expect(visible.length).toBeLessThan(samples.length * 0.95);

    const leftAlpha = samples
      .filter(({ col, sample }) => col < cols / 3 && sample.visible)
      .reduce((sum, { sample }) => sum + sample.alpha, 0);
    const rightAlpha = samples
      .filter(({ col, sample }) => col >= cols * 2 / 3 && sample.visible)
      .reduce((sum, { sample }) => sum + sample.alpha, 0);
    expect(rightAlpha).toBeGreaterThan(leftAlpha);
  });
});
