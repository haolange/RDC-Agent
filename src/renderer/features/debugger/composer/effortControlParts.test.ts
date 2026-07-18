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
  createActiveMaxTimeline,
  createMaxTimeline,
  createReopenMaxTimeline,
  isMaxTierLevel,
  MAX_TRAVEL_CYCLE_MS,
  MAX_TRAVEL_SPATIAL_CYCLES,
  MAX_VISUAL_EGRESS_MS,
  MAX_VISUAL_INGRESS_MS,
  type MaxFieldMode,
  resolveMaxAnimationProgress,
  resolveMaxClipX,
  resolveMaxFieldCell,
  resolveMaxTravelingAmplitude,
  resolveMaxVisualFrame,
  shouldStartMaxDragIngress,
} from './maxVisual';

const FIELD_COLS = 72;
const FIELD_ROWS = 5;

function resolveGrid(
  energy: number,
  fieldTimeMs = 0,
  emitterRatio = 1,
  fieldMode: MaxFieldMode = 'propagate',
  formationEnergy = energy,
) {
  return Array.from({ length: FIELD_COLS * FIELD_ROWS }, (_, index) => {
    const col = index % FIELD_COLS;
    const row = Math.floor(index / FIELD_COLS);
    return {
      col,
      row,
      sample: resolveMaxFieldCell({
        col,
        row,
        cols: FIELD_COLS,
        rows: FIELD_ROWS,
        energy,
        formationEnergy,
        fieldMode,
        fieldTimeMs,
        emitterRatio,
      }),
    };
  });
}

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
    expect(MAX_VISUAL_INGRESS_MS).toBe(1_600);
    expect(MAX_VISUAL_EGRESS_MS).toBe(384);
  });

  it('starts drag ingress only when entry or reversal needs a preview timeline', () => {
    expect(shouldStartMaxDragIngress('idle')).toBe(true);
    expect(shouldStartMaxDragIngress('egress')).toBe(true);
    expect(shouldStartMaxDragIngress('ingress-committed')).toBe(true);
    expect(shouldStartMaxDragIngress('active')).toBe(false);
    expect(shouldStartMaxDragIngress('ingress-reopen')).toBe(false);
    expect(shouldStartMaxDragIngress('ingress-drag')).toBe(false);
  });

  it('uses one interruptible timeline for drag, commit, and reopen ingress', () => {
    const dragStartedAt = 1_000;
    const drag = createMaxTimeline({
      phase: 'ingress-drag',
      revision: 1,
      now: dragStartedAt,
      fromEnergy: 0,
      fromStopsOpacity: 0.2,
      fieldEpoch: dragStartedAt,
    });
    expect(drag.fromStopsOpacity).toBe(0.2);
    const dragMid = resolveMaxVisualFrame(drag, dragStartedAt + MAX_VISUAL_INGRESS_MS / 2);
    expect(dragMid.energy).toBe(0.5);
    expect(dragMid.stopsOpacity).toBe(0.2);
    expect(dragMid.running).toBe(true);

    const dragEndedAt = dragStartedAt + MAX_VISUAL_INGRESS_MS;
    const dragEnd = resolveMaxVisualFrame(drag, dragEndedAt);
    expect(dragEnd.energy).toBe(1);
    expect(dragEnd.stopsOpacity).toBe(0.2);
    expect(dragEnd.complete).toBe(false);
    expect(dragEnd.running).toBe(true);

    const committed = createMaxTimeline({
      phase: 'ingress-committed',
      revision: 2,
      now: dragEndedAt,
      fromEnergy: dragEnd.energy,
      fromStopsOpacity: dragEnd.stopsOpacity,
      fieldEpoch: drag.fieldEpoch,
    });
    expect(committed.durationMs).toBe(MAX_VISUAL_EGRESS_MS);
    const committedStart = resolveMaxVisualFrame(committed, dragEndedAt);
    expect(committedStart.energy).toBe(dragEnd.energy);
    expect(committedStart.stopsOpacity).toBe(dragEnd.stopsOpacity);
    expect(resolveMaxVisualFrame(committed, dragEndedAt + MAX_VISUAL_EGRESS_MS / 2).stopsOpacity).toBeCloseTo(0.1);
    expect(resolveMaxVisualFrame(committed, dragEndedAt + MAX_VISUAL_EGRESS_MS).stopsOpacity).toBe(0);
  });

  it('hides committed stops on the 384ms egress clock without slowing the 1.6s field ingress', () => {
    const committed = createMaxTimeline({
      phase: 'ingress-committed',
      revision: 8,
      now: 1_000,
      fromEnergy: 0,
      fromStopsOpacity: 1,
      fieldEpoch: 1_000,
    });
    const stopsSettled = resolveMaxVisualFrame(committed, 1_000 + MAX_VISUAL_EGRESS_MS);
    expect(stopsSettled.stopsOpacity).toBe(0);
    expect(stopsSettled.energy).toBeLessThan(0.25);
    expect(stopsSettled.complete).toBe(false);
    expect(resolveMaxVisualFrame(committed, 1_000 + MAX_VISUAL_INGRESS_MS)).toMatchObject({
      energy: 1,
      stopsOpacity: 0,
      complete: true,
    });
  });

  it('constructs reopen before-paint state with no gray stops or field energy', () => {
    const reopen = createReopenMaxTimeline(3, 2_000);
    expect(reopen).toMatchObject({
      phase: 'ingress-reopen',
      fromEnergy: 0,
      fromStopsOpacity: 0,
      fieldEpoch: 2_000,
    });
    expect(resolveMaxVisualFrame(reopen, 2_000)).toMatchObject({
      energy: 0,
      stopsOpacity: 0,
      running: true,
    });
  });

  it('keeps egress and mid-flight reversal continuous, including field time', () => {
    const egress = createMaxTimeline({
      phase: 'egress',
      revision: 2,
      now: 1_000,
      fromEnergy: 0.7,
      fromStopsOpacity: 0.2,
      fieldEpoch: 240,
    });
    const egressMidAt = 1_000 + MAX_VISUAL_EGRESS_MS / 2;
    const egressMid = resolveMaxVisualFrame(egress, egressMidAt);
    expect(egressMid.energy).toBeCloseTo(0.35);
    expect(egressMid.stopsOpacity).toBeCloseTo(0.6);

    const reverse = createMaxTimeline({
      phase: 'ingress-drag',
      revision: 3,
      now: egressMidAt,
      fromEnergy: egressMid.energy,
      formationEnergy: egress.formationEnergy,
      fieldMode: egress.fieldMode,
      fromStopsOpacity: egressMid.stopsOpacity,
      fieldEpoch: egress.fieldEpoch,
    });
    const reverseStart = resolveMaxVisualFrame(reverse, egressMidAt);
    expect(reverseStart.energy).toBeCloseTo(egressMid.energy);
    expect(reverseStart.stopsOpacity).toBeCloseTo(egressMid.stopsOpacity);
    expect(resolveMaxVisualFrame(reverse, egressMidAt + MAX_VISUAL_EGRESS_MS).stopsOpacity).toBeCloseTo(egressMid.stopsOpacity);
    expect(reverse.fieldEpoch).toBe(egress.fieldEpoch);
    expect(reverse.formationEnergy).toBe(egress.formationEnergy);
    expect(reverse.fieldMode).toBe('dissolve');
    expect(resolveMaxVisualFrame(egress, 1_000 + MAX_VISUAL_EGRESS_MS)).toMatchObject({
      energy: 0,
      stopsOpacity: 1,
      complete: true,
    });
  });

  it('resolves reduced motion to static endpoints without a running loop', () => {
    const ingress = createMaxTimeline({
      phase: 'ingress-committed',
      revision: 1,
      now: 0,
      fromEnergy: 0,
      fromStopsOpacity: 1,
      fieldEpoch: 0,
    });
    expect(resolveMaxVisualFrame(ingress, 0, true)).toMatchObject({
      energy: 1,
      stopsOpacity: 0,
      running: false,
      complete: true,
    });
    expect(resolveMaxVisualFrame(createActiveMaxTimeline(2, 0), 10, true)).toMatchObject({
      energy: 1,
      stopsOpacity: 0,
      running: false,
    });
  });

  it('keeps one deterministic porous topology while the unified field changes brightness', () => {
    const first = resolveGrid(1, 0);
    const later = resolveGrid(1, 430);
    expect(first.map(({ sample }) => sample.occupied)).toEqual(
      later.map(({ sample }) => sample.occupied),
    );
    const occupied = first.filter(({ sample }) => sample.occupied);
    expect(occupied.length).toBeGreaterThan(first.length * 0.7);
    expect(occupied.length).toBeLessThan(first.length * 0.85);

    const deltas = occupied.map(({ col, row, sample }) => {
      const laterAlpha = later[row * FIELD_COLS + col]?.sample.alpha ?? sample.alpha;
      return laterAlpha - sample.alpha;
    });
    expect(deltas.filter((delta) => Math.abs(delta) > 0.01).length).toBeGreaterThan(occupied.length * 0.35);
    expect(deltas.some((delta) => delta > 0.01)).toBe(true);
    expect(deltas.some((delta) => delta < -0.01)).toBe(true);
  });

  it('advances the noisy ingress boundary leftward while the formed right side stays alive', () => {
    const early = resolveGrid(0.18, 224);
    const middle = resolveGrid(0.55, 800);
    const late = resolveGrid(1, 1_600);
    const leftBoundary = (grid: ReturnType<typeof resolveGrid>) => Math.min(
      ...grid.filter(({ sample }) => sample.visible).map(({ col }) => col),
    );
    expect(leftBoundary(middle)).toBeLessThan(leftBoundary(early));
    expect(leftBoundary(late)).toBeLessThan(leftBoundary(middle));
    for (const grid of [early, middle, late]) {
      expect(grid.some(({ col, sample }) => col > FIELD_COLS * 0.8 && sample.visible)).toBe(true);
    }
  });

  it('keeps the completed field translucent with a visible left floor and brighter right edge', () => {
    const active = resolveGrid(1, 620).filter(({ sample }) => sample.occupied);
    const left = active.filter(({ col }) => col < FIELD_COLS / 3);
    const right = active.filter(({ col }) => col >= FIELD_COLS * 2 / 3);
    const averageAlpha = (cells: typeof active) => (
      cells.reduce((sum, { sample }) => sum + sample.alpha, 0) / cells.length
    );

    expect(active.every(({ sample }) => sample.visible)).toBe(true);
    expect(Math.min(...active.map(({ sample }) => sample.alpha))).toBeGreaterThanOrEqual(0.099);
    expect(Math.max(...active.map(({ sample }) => sample.alpha))).toBeLessThan(0.7);
    expect(averageAlpha(left)).toBeLessThan(0.18);
    expect(averageAlpha(right)).toBeGreaterThan(averageAlpha(left) + 0.18);
  });

  it('moves one continuous correlated brightness amplitude from right to left', () => {
    const position = 0.72;
    const elapsedMs = 180;
    const leftShift = elapsedMs / (MAX_TRAVEL_CYCLE_MS * MAX_TRAVEL_SPATIAL_CYCLES);
    const phaseOffset = 0.37;
    expect(resolveMaxTravelingAmplitude(position, 240, phaseOffset)).toBeCloseTo(
      resolveMaxTravelingAmplitude(position - leftShift, 240 + elapsedMs, phaseOffset),
      10,
    );
  });

  it('fades the formed field across its full width without an inward-contracting edge', () => {
    const full = resolveGrid(1, 620);
    const retreat = resolveGrid(0.5, 620, 1, 'dissolve', 1);
    const occupied = full.filter(({ sample }) => sample.occupied);
    const surviving = occupied.filter(({ col, row }) => {
      const index = row * FIELD_COLS + col;
      return retreat[index]?.sample.visible;
    });
    expect(surviving.length).toBeGreaterThan(0);
    expect(surviving.length).toBeLessThan(occupied.length);

    const thirds = [0, 1, 2].map((third) => surviving.filter(({ col }) => (
      col >= third * FIELD_COLS / 3 && col < (third + 1) * FIELD_COLS / 3
    )).length);
    expect(thirds.every((count) => count > 0)).toBe(true);

    const restoredFormation = resolveGrid(0.5, 620, 1, 'dissolve', 0.5);
    const propagationAtFormation = resolveGrid(0.5, 620);
    expect(restoredFormation.map(({ sample }) => sample.alpha)).toEqual(
      propagationAtFormation.map(({ sample }) => sample.alpha),
    );
    const resumedGrowth = resolveGrid(0.8, 620, 1, 'dissolve', 0.5);
    expect(resumedGrowth.filter(({ sample }) => sample.visible).length).toBeGreaterThan(
      restoredFormation.filter(({ sample }) => sample.visible).length,
    );

    const alphaRatios = surviving.map(({ col, row, sample }) => {
      const retreatAlpha = retreat[row * FIELD_COLS + col]?.sample.alpha ?? 0;
      return retreatAlpha / sample.alpha;
    });
    expect(Math.max(...alphaRatios) - Math.min(...alphaRatios)).toBeGreaterThan(0.2);
  });

  it('enforces the thumb as an exact hard clip boundary', () => {
    expect(resolveMaxClipX(300, 1)).toBe(300);
    expect(resolveMaxClipX(300, 0.42)).toBe(126);
    expect(resolveMaxClipX(300, -1)).toBe(0);
    const clipped = resolveGrid(1, 500, 0.42);
    expect(clipped.every(({ col, sample }) => (
      col / (FIELD_COLS - 1) <= 0.42 || sample.alpha === 0
    ))).toBe(true);
  });

  it('uses one symmetric progress curve for ingress and egress', () => {
    expect(resolveMaxAnimationProgress(0, MAX_VISUAL_INGRESS_MS)).toBe(0);
    expect(resolveMaxAnimationProgress(800, MAX_VISUAL_INGRESS_MS)).toBe(0.5);
    expect(resolveMaxAnimationProgress(1_600, MAX_VISUAL_INGRESS_MS)).toBe(1);
    expect(resolveMaxAnimationProgress(2_000, MAX_VISUAL_INGRESS_MS)).toBe(1);
  });
});
