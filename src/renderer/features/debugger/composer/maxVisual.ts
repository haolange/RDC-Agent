import type { ReasoningSelection } from '@shared/types/modelCapability';

/** Max is the sole top-tier visual pipeline. */
export type MaxVisualPhase =
  | 'idle'
  | 'ingress-drag'
  | 'ingress-committed'
  | 'ingress-reopen'
  | 'active'
  | 'egress';

export type MaxFieldMode = 'propagate' | 'dissolve';

export interface MaxVisualTimeline {
  phase: MaxVisualPhase;
  revision: number;
  startedAt: number;
  durationMs: number;
  fromEnergy: number;
  formationEnergy: number;
  fieldMode: MaxFieldMode;
  fromStopsOpacity: number;
  fieldEpoch: number;
}

export interface MaxVisualFrame {
  phase: MaxVisualPhase;
  progress: number;
  energy: number;
  stopsOpacity: number;
  running: boolean;
  complete: boolean;
}

export interface MaxFieldSample {
  occupied: boolean;
  visible: boolean;
  alpha: number;
  tone: number;
}

export const MAX_VISUAL_INGRESS_MS = 1_600;
export const MAX_VISUAL_EGRESS_MS = 384;
export const MAX_TRAVEL_CYCLE_MS = 1_600;
export const MAX_TRAVEL_SPATIAL_CYCLES = 1.2;

export function clampMaxProgress(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** Symmetric easing keeps reversals visually quiet and both endpoints soft. */
export function resolveMaxAnimationProgress(elapsedMs: number, durationMs: number): number {
  const linear = durationMs > 0 ? clampMaxProgress(elapsedMs / durationMs) : 1;
  return linear * linear * (3 - 2 * linear);
}

export function isMaxTierLevel(level: ReasoningSelection): boolean {
  return level === 'max';
}

export function shouldStartMaxDragIngress(phase: MaxVisualPhase): boolean {
  return phase === 'idle' || phase === 'egress' || phase === 'ingress-committed';
}

export function createIdleMaxTimeline(revision = 0, now = 0): MaxVisualTimeline {
  return {
    phase: 'idle',
    revision,
    startedAt: now,
    durationMs: 0,
    fromEnergy: 0,
    formationEnergy: 0,
    fieldMode: 'propagate',
    fromStopsOpacity: 1,
    fieldEpoch: now,
  };
}

export function createMaxTimeline(input: {
  phase: Exclude<MaxVisualPhase, 'idle' | 'active'>;
  revision: number;
  now: number;
  fromEnergy: number;
  formationEnergy?: number;
  fieldMode?: MaxFieldMode;
  fromStopsOpacity: number;
  fieldEpoch: number;
}): MaxVisualTimeline {
  const fromEnergy = clampMaxProgress(input.fromEnergy);
  const fieldMode = input.fieldMode ?? (input.phase === 'egress' ? 'dissolve' : 'propagate');
  const formationEnergy = clampMaxProgress(input.formationEnergy ?? fromEnergy);
  const remainingIngressMs = (1 - fromEnergy) * MAX_VISUAL_INGRESS_MS;
  const durationMs = input.phase === 'egress'
    ? MAX_VISUAL_EGRESS_MS
    : input.phase === 'ingress-committed'
      ? Math.max(MAX_VISUAL_EGRESS_MS, remainingIngressMs)
      : remainingIngressMs;
  return {
    phase: input.phase,
    revision: input.revision,
    startedAt: input.now,
    durationMs,
    fromEnergy,
    formationEnergy,
    fieldMode,
    fromStopsOpacity: clampMaxProgress(input.fromStopsOpacity),
    fieldEpoch: input.fieldEpoch,
  };
}

export function createReopenMaxTimeline(revision: number, now: number): MaxVisualTimeline {
  return createMaxTimeline({
    phase: 'ingress-reopen',
    revision,
    now,
    fromEnergy: 0,
    fromStopsOpacity: 0,
    fieldEpoch: now,
  });
}

export function createActiveMaxTimeline(
  revision: number,
  now: number,
  fieldEpoch = now,
): MaxVisualTimeline {
  return {
    phase: 'active',
    revision,
    startedAt: now,
    durationMs: 0,
    fromEnergy: 1,
    formationEnergy: 1,
    fieldMode: 'propagate',
    fromStopsOpacity: 0,
    fieldEpoch,
  };
}

export function resolveMaxVisualFrame(
  timeline: MaxVisualTimeline,
  now: number,
  reducedMotion = false,
): MaxVisualFrame {
  if (timeline.phase === 'idle') {
    return {
      phase: timeline.phase,
      progress: 0,
      energy: 0,
      stopsOpacity: 1,
      running: false,
      complete: false,
    };
  }
  if (timeline.phase === 'active') {
    return {
      phase: timeline.phase,
      progress: 1,
      energy: 1,
      stopsOpacity: 0,
      running: !reducedMotion,
      complete: false,
    };
  }

  const elapsedMs = now - timeline.startedAt;
  const progress = reducedMotion
    ? 1
    : resolveMaxAnimationProgress(elapsedMs, timeline.durationMs);
  if (timeline.phase === 'egress') {
    return {
      phase: timeline.phase,
      progress,
      energy: timeline.fromEnergy * (1 - progress),
      stopsOpacity: timeline.fromStopsOpacity + (1 - timeline.fromStopsOpacity) * progress,
      running: !reducedMotion && progress < 1,
      complete: progress >= 1,
    };
  }

  const remainingIngressMs = (1 - timeline.fromEnergy) * MAX_VISUAL_INGRESS_MS;
  const energyProgress = reducedMotion
    ? 1
    : resolveMaxAnimationProgress(elapsedMs, remainingIngressMs);
  const energy = timeline.fromEnergy + (1 - timeline.fromEnergy) * energyProgress;
  const dragPreview = timeline.phase === 'ingress-drag';
  const stopsProgress = reducedMotion
    ? 1
    : resolveMaxAnimationProgress(elapsedMs, MAX_VISUAL_EGRESS_MS);
  return {
    phase: timeline.phase,
    progress,
    energy,
    stopsOpacity: dragPreview
      ? timeline.fromStopsOpacity
      : timeline.fromStopsOpacity * (1 - stopsProgress),
    running: !reducedMotion && (dragPreview || progress < 1),
    complete: !dragPreview && progress >= 1,
  };
}

/** Stable [0, 1) coordinate noise; wall-clock time never changes cell occupancy. */
export function maxFieldNoise(col: number, row: number, salt = 0): number {
  const n = Math.sin((col + 1.7) * 12.9898 + (row + 1.3) * 78.233 + salt * 45.164) * 43758.5453;
  return n - Math.floor(n);
}

function smoothUnit(value: number): number {
  const clamped = clampMaxProgress(value);
  return clamped * clamped * (3 - 2 * clamped);
}

function coherentFieldNoise(col: number, row: number, salt: number): number {
  const x = col / 3;
  const y = row / 2;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothUnit(x - x0);
  const ty = smoothUnit(y - y0);
  const top = maxFieldNoise(x0, y0, salt) * (1 - tx)
    + maxFieldNoise(x0 + 1, y0, salt) * tx;
  const bottom = maxFieldNoise(x0, y0 + 1, salt) * (1 - tx)
    + maxFieldNoise(x0 + 1, y0 + 1, salt) * tx;
  return top * (1 - ty) + bottom * ty;
}

export function resolveMaxTravelingAmplitude(
  position: number,
  fieldTimeMs: number,
  phaseOffset = 0,
): number {
  const temporalPhase = (Math.max(0, fieldTimeMs) / MAX_TRAVEL_CYCLE_MS) * Math.PI * 2;
  const spatialPhase = clampMaxProgress(position) * MAX_TRAVEL_SPATIAL_CYCLES * Math.PI * 2;
  // Positive time plus positive x means an equal phase point moves toward smaller x.
  return Math.sin(temporalPhase + spatialPhase + phaseOffset);
}

export function resolveMaxFieldCell(input: {
  col: number;
  row: number;
  cols: number;
  rows: number;
  energy: number;
  formationEnergy?: number;
  fieldMode?: MaxFieldMode;
  fieldTimeMs: number;
  emitterRatio: number;
}): MaxFieldSample {
  const cols = Math.max(1, input.cols);
  const emitterRatio = clampMaxProgress(input.emitterRatio);
  const fieldMode = input.fieldMode ?? 'propagate';
  const position = cols <= 1 ? 0 : input.col / (cols - 1);
  // Egress freezes the field's formed spatial range. Only the live thumb clip and
  // distributed cell decay may remove pixels; the birth front must not run backward.
  const formationEmitterRatio = fieldMode === 'dissolve' ? 1 : emitterRatio;
  const normalizedPosition = formationEmitterRatio > 0
    ? clampMaxProgress(position / formationEmitterRatio)
    : 0;
  const distanceFromSource = 1 - normalizedPosition;
  const occupancyNoise = maxFieldNoise(input.col, input.row, 4);
  const occupied = occupancyNoise >= 0.2;
  if (!occupied || emitterRatio <= 0 || position > emitterRatio) {
    return { occupied, visible: false, alpha: 0, tone: 0 };
  }

  const energy = clampMaxProgress(input.energy);
  const birthNoise = maxFieldNoise(input.col, input.row, 0);
  const birthThreshold = Math.min(0.84, distanceFromSource * 0.78 + birthNoise * 0.2);
  const formationEnergy = clampMaxProgress(input.formationEnergy ?? 1);
  let cellEnvelope = smoothUnit((energy - birthThreshold) / 0.16);
  if (fieldMode === 'dissolve' && energy <= formationEnergy) {
    const formedEnvelope = smoothUnit((formationEnergy - birthThreshold) / 0.16);
    const remaining = formationEnergy > 0 ? clampMaxProgress(energy / formationEnergy) : 0;
    const deathThreshold = 0.06 + maxFieldNoise(input.col, input.row, 12) * 0.68;
    const distributedFade = smoothUnit((remaining - deathThreshold) / 0.18);
    cellEnvelope = formedEnvelope * smoothUnit(remaining) * distributedFade;
  }
  if (cellEnvelope <= 0) {
    return { occupied, visible: false, alpha: 0, tone: 0 };
  }

  const detailNoise = maxFieldNoise(input.col, input.row, 1);
  const coherentNoise = coherentFieldNoise(input.col, input.row, 8);
  const rowMid = (input.rows - 1) / 2;
  const rowWeight = 0.8 + (1 - Math.abs(input.row - rowMid) / (rowMid + 0.5)) * 0.2;
  const breath = Math.sin((input.fieldTimeMs / 1_800) * Math.PI * 2 + coherentNoise * 0.7) * 0.025;
  const localPeriodMs = 1_000 + coherentNoise * 450;
  const shimmer = Math.sin(
    (input.fieldTimeMs / localPeriodMs) * Math.PI * 2
      + coherentNoise * Math.PI * 2
      + normalizedPosition * 0.8,
  ) * 0.035;
  const traveling = resolveMaxTravelingAmplitude(
    normalizedPosition,
    input.fieldTimeMs,
    coherentNoise * Math.PI * 1.6 + input.row * 0.34,
  ) * (0.035 + coherentNoise * 0.035);

  const alphaGradient = normalizedPosition ** 1.45;
  const base = 0.11 + alphaGradient * 0.34 + detailNoise * 0.025;
  const temporalScale = 0.35 + alphaGradient * 0.65;
  const fieldAlpha = Math.max(
    0.1,
    rowWeight * (base + (breath + shimmer + traveling) * temporalScale),
  );
  const alpha = clampMaxProgress(cellEnvelope * fieldAlpha);
  const tone = clampMaxProgress(
    normalizedPosition * 0.5 + detailNoise * 0.24 + Math.max(0, traveling) * 1.4 + 0.08,
  );
  return {
    occupied,
    visible: alpha > 0.018,
    alpha,
    tone,
  };
}

export function resolveMaxClipX(width: number, emitterRatio: number): number {
  return Math.max(0, width) * clampMaxProgress(emitterRatio);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
