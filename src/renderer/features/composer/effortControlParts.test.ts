import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  buildDisplaySelections,
  buildModelEffortCapsulePresentation,
  clampSliderRatio,
  EffortModeIconButton,
  findAdjacentSupportedLevel,
  getStopPosition,
  resolveNearestSnapLevel,
} from './effortControlParts';
import {
  clampCenteredTooltipPercent,
  EFFORT_THUMB_WIDTH_PX,
  ratioFromInsetClientX,
  thumbInsetCenterPx,
  thumbInsetPercent,
} from './effortSliderGeometry';
import {
  createActiveMaxTimeline,
  createMaxTimeline,
  createReopenMaxTimeline,
  isMaxTierLevel,
  MAX_TRAVEL_CYCLE_MS,
  MAX_TRAVEL_SPATIAL_CYCLES,
  MAX_INGRESS_LEFT_EASE,
  MAX_INGRESS_MID_ENERGY,
  MAX_VISUAL_EGRESS_MS,
  MAX_VISUAL_INGRESS_MS,
  type MaxFieldMode,
  resolveMaxAnimationProgress,
  resolveMaxClipX,
  resolveMaxFieldCell,
  resolveMaxIngressCoverage,
  resolveMaxIngressEnergyProgress,
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

  it('shows Fast and Max icons on the capsule only when those modes are on', () => {
    const presentation = buildModelEffortCapsulePresentation({
      modelLabel: 'GPT-5.6 Sol',
      reasoningLabel: 'Max',
      maxContextMode: true,
      maxContextLabel: 'Max mode',
      fastModel: true,
      fastModelLabel: 'Fast mode',
    });

    expect(presentation.modelLabel).toBe('GPT-5.6 Sol');
    expect(presentation.reasoningLabel).toBe('Max');
    expect(presentation.showFast).toBe(true);
    expect(presentation.showMax).toBe(true);
    expect(presentation.title).toBe('GPT-5.6 Sol · Max · Fast mode · Max mode');
  });

  it('hides capsule Fast and Max icons when those modes are off', () => {
    const presentation = buildModelEffortCapsulePresentation({
      modelLabel: 'GPT-5.6 Sol',
      reasoningLabel: 'Medium',
      maxContextMode: false,
      maxContextLabel: 'Max mode',
      fastModel: false,
      fastModelLabel: 'Fast mode',
    });

    expect(presentation.showFast).toBe(false);
    expect(presentation.showMax).toBe(false);
    expect(presentation.title).toBe('GPT-5.6 Sol · Medium');
  });

  it('projects unavailable Max mode entitlement as Disabled in the icon accessible name', () => {
    const markup = renderToStaticMarkup(React.createElement(EffortModeIconButton, {
      mode: 'max-context',
      'data-testid': 'composer-model-effort-max-mode',
      label: 'Max mode',
      statusLabel: 'Disabled',
      available: false,
      active: false,
      onToggle: () => undefined,
      children: 'M',
    }));

    expect(markup).toContain('composer-model-effort-mode-tip');
    expect(markup).toContain('Disabled');
    expect(markup).toContain('aria-label="Max mode · Disabled"');
    expect(markup).toContain('disabled=""');
  });

  it('renders fixed Max mode as active and disabled instead of flashing off', () => {
    const markup = renderToStaticMarkup(React.createElement(EffortModeIconButton, {
      mode: 'max-context',
      'data-testid': 'composer-model-effort-max-mode',
      label: 'Max mode',
      statusLabel: 'Fixed',
      available: false,
      active: true,
      onToggle: () => undefined,
      children: 'M',
    }));

    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('composer-model-effort-mode');
    expect(markup).toContain('is-active');
    expect(markup).toContain('Fixed');
  });

  it('calculates stop positions and clamps drag ratios', () => {
    expect(getStopPosition(0, 1)).toBe(0);
    expect(getStopPosition(2, 5)).toBe(0.5);
    expect(clampSliderRatio(-1)).toBe(0);
    expect(clampSliderRatio(0.25)).toBe(0.25);
    expect(clampSliderRatio(9)).toBe(1);
  });

  it('keeps inset thumb centers inside the track for every ratio', () => {
    const trackWidth = 280;
    const half = EFFORT_THUMB_WIDTH_PX / 2;
    for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
      const centerPercent = thumbInsetPercent(ratio, trackWidth);
      const centerPx = (centerPercent / 100) * trackWidth;
      expect(centerPx - half).toBeGreaterThanOrEqual(-0.001);
      expect(centerPx + half).toBeLessThanOrEqual(trackWidth + 0.001);
    }
    expect(thumbInsetPercent(0, trackWidth)).toBeCloseTo((half / trackWidth) * 100);
    expect(thumbInsetPercent(1, trackWidth)).toBeCloseTo(((trackWidth - half) / trackWidth) * 100);
    expect(thumbInsetPercent(0.5, trackWidth)).toBeCloseTo(50);
    expect(thumbInsetPercent(-2, 0)).toBe(0);
    expect(thumbInsetPercent(2, Number.NaN)).toBe(100);
  });

  it('clamps drag tooltip centers so they stay inside the track', () => {
    const trackWidth = 280;
    const tooltipWidth = 96;
    const half = tooltipWidth / 2;
    expect(clampCenteredTooltipPercent(0, trackWidth, tooltipWidth)).toBeCloseTo((half / trackWidth) * 100);
    expect(clampCenteredTooltipPercent(100, trackWidth, tooltipWidth)).toBeCloseTo(
      ((trackWidth - half) / trackWidth) * 100,
    );
    expect(clampCenteredTooltipPercent(50, trackWidth, tooltipWidth)).toBeCloseTo(50);
  });

  it('inverts inset pointer mapping so thumb centers follow the pointer', () => {
    const trackWidth = 280;
    const trackLeft = 100;
    const half = EFFORT_THUMB_WIDTH_PX / 2;
    expect(ratioFromInsetClientX(trackLeft + half, trackLeft, trackWidth)).toBeCloseTo(0);
    expect(ratioFromInsetClientX(trackLeft + trackWidth - half, trackLeft, trackWidth)).toBeCloseTo(1);
    expect(ratioFromInsetClientX(trackLeft + trackWidth / 2, trackLeft, trackWidth)).toBeCloseTo(0.5);
    const ratio = 0.37;
    const center = thumbInsetCenterPx(ratio, trackWidth);
    expect(ratioFromInsetClientX(trackLeft + center, trackLeft, trackWidth)).toBeCloseTo(ratio);
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
    expect(dragMid.energy).toBeCloseTo(0.5);
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
    // Stops finish on the 384ms clock while linear ingress energy is only partway (~0.24).
    expect(stopsSettled.energy).toBeCloseTo(MAX_VISUAL_EGRESS_MS / MAX_VISUAL_INGRESS_MS);
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

  it('keeps ingress gradual and the active field animating', () => {
    const ingress = createMaxTimeline({
      phase: 'ingress-committed',
      revision: 1,
      now: 0,
      fromEnergy: 0,
      fromStopsOpacity: 1,
      fieldEpoch: 0,
    });
    expect(resolveMaxVisualFrame(ingress, 0)).toMatchObject({
      energy: 0,
      stopsOpacity: 1,
      running: true,
      complete: false,
    });
    expect(resolveMaxVisualFrame(createActiveMaxTimeline(2, 0), 10)).toMatchObject({
      energy: 1,
      stopsOpacity: 0,
      running: true,
    });
  });

  it('keeps a full lattice occupied while only brightness breathes over time', () => {
    const first = resolveGrid(1, 0);
    const later = resolveGrid(1, 430);
    expect(first.every(({ sample }) => sample.occupied)).toBe(true);
    expect(first.map(({ sample }) => sample.occupied)).toEqual(
      later.map(({ sample }) => sample.occupied),
    );

    const deltas = first.map(({ col, row, sample }) => {
      const laterAlpha = later[row * FIELD_COLS + col]?.sample.alpha ?? sample.alpha;
      return laterAlpha - sample.alpha;
    });
    expect(deltas.filter((delta) => Math.abs(delta) > 0.01).length).toBeGreaterThan(first.length * 0.35);
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

  it('reaches mid-track near mid-energy then eases out across the left half', () => {
    expect(resolveMaxIngressEnergyProgress(800, MAX_VISUAL_INGRESS_MS)).toBeCloseTo(0.5);
    expect(resolveMaxIngressCoverage(MAX_INGRESS_MID_ENERGY)).toBeCloseTo(0.5);
    expect(resolveMaxIngressCoverage(0.5)).toBeGreaterThan(0.55);
    expect(resolveMaxIngressCoverage(0.5)).toBeLessThan(0.72);
    expect(MAX_INGRESS_LEFT_EASE).toBeGreaterThan(1);

    // After mid-track, equal energy steps cover progressively less distance.
    const cMid = resolveMaxIngressCoverage(MAX_INGRESS_MID_ENERGY);
    const c60 = resolveMaxIngressCoverage(0.6);
    const c80 = resolveMaxIngressCoverage(0.8);
    const c100 = resolveMaxIngressCoverage(1);
    expect(c60 - cMid).toBeGreaterThan(c80 - c60);
    expect(c80 - c60).toBeGreaterThan(c100 - c80);

    const leftBoundary = (grid: ReturnType<typeof resolveGrid>) => Math.min(
      ...grid.filter(({ sample }) => sample.visible).map(({ col }) => col),
    );
    const atMid = leftBoundary(resolveGrid(MAX_INGRESS_MID_ENERGY, 700));
    const at070 = leftBoundary(resolveGrid(0.7, 1_100));
    const at100 = leftBoundary(resolveGrid(1, 1_600));
    expect(atMid - at070).toBeGreaterThan(at070 - at100);
  });

  it('keeps the completed field translucent with a mottled left edge and brighter right edge', () => {
    const active = resolveGrid(1, 620).filter(({ sample }) => sample.occupied);
    const left = active.filter(({ col }) => col < FIELD_COLS / 3);
    const right = active.filter(({ col }) => col >= FIELD_COLS * 2 / 3);
    const averageAlpha = (cells: typeof active) => (
      cells.reduce((sum, { sample }) => sum + sample.alpha, 0) / cells.length
    );
    const alphaRange = (cells: typeof active) => {
      const values = cells.map(({ sample }) => sample.alpha);
      return Math.max(...values) - Math.min(...values);
    };

    expect(active.every(({ sample }) => sample.visible)).toBe(true);
    expect(Math.min(...active.map(({ sample }) => sample.alpha))).toBeGreaterThanOrEqual(0.02);
    expect(Math.max(...active.map(({ sample }) => sample.alpha))).toBeLessThan(0.7);
    expect(averageAlpha(left)).toBeLessThan(0.18);
    expect(averageAlpha(right)).toBeGreaterThan(averageAlpha(left) + 0.16);
    // Left mottling is primarily spatial; require a clear per-cell spread there.
    expect(alphaRange(left)).toBeGreaterThan(0.1);
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
    expect(resolveMaxClipX(300, 1)).toBe(284);
    expect(resolveMaxClipX(300, 0.42)).toBeCloseTo(128.56);
    expect(resolveMaxClipX(300, -1)).toBe(16);
    expect(resolveMaxClipX(300, 0)).toBe(16);
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
