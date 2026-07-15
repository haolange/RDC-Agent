import type { ReasoningSelection } from '@shared/types/modelCapability';

/** Max is the sole top-tier visual pipeline. */
export type MaxVisualPhase = 'idle' | 'preview' | 'evolve' | 'settled' | 'retreat';

export const MAX_VISUAL_EVOLVE_MS = 800;
export const MAX_VISUAL_RETREAT_MS = 800;

export function clampMaxProgress(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** Symmetric easing keeps the midpoint at half coverage while softening both endpoints. */
export function resolveMaxAnimationProgress(elapsedMs: number, durationMs: number): number {
  const linear = durationMs > 0 ? clampMaxProgress(elapsedMs / durationMs) : 1;
  return linear * linear * (3 - 2 * linear);
}

export function isMaxTierLevel(level: ReasoningSelection): boolean {
  return level === 'max';
}

/** Stable [0, 1) coordinate noise; wall-clock time never changes cell occupancy. */
export function maxFieldNoise(col: number, row: number, salt = 0): number {
  const n = Math.sin((col + 1.7) * 12.9898 + (row + 1.3) * 78.233 + salt * 45.164) * 43758.5453;
  return n - Math.floor(n);
}

export function resolveMaxFieldCell(input: {
  col: number;
  row: number;
  cols: number;
  rows: number;
  coverage: number;
}): {
  visible: boolean;
  alpha: number;
  tone: number;
} {
  const { col, row } = input;
  const coverage = clampMaxProgress(input.coverage);
  const fromRight = Math.max(0, input.cols - 1 - col);
  const distance = input.cols <= 1 ? 0 : fromRight / (input.cols - 1);
  const along = 1 - distance;
  const n1 = maxFieldNoise(col, row, 0);
  const n2 = maxFieldNoise(col, row, 1);
  const n4 = maxFieldNoise(col, row, 4);

  // A broad deterministic birth band produces a dissolve edge instead of a vertical wipe.
  const birth = distance * 0.72 + n1 * 0.24;
  const stableHole = n4 < 0.055 + distance * 0.035;
  const visible = birth <= coverage && !stableHole;
  const age = clampMaxProgress((coverage - birth) / 0.18);
  const edge = age * age * (3 - 2 * age);
  const rowMid = (input.rows - 1) / 2;
  const rowWeight = 0.86 + (1 - Math.abs(row - rowMid) / (rowMid + 0.5)) * 0.14;
  const alpha = visible
    ? edge * (0.58 + along * 0.34) * rowWeight * (0.92 + n2 * 0.08)
    : 0;

  return {
    visible,
    alpha: clampMaxProgress(alpha),
    tone: clampMaxProgress(along * 0.82 + n2 * 0.18),
  };
}

export function resolveMaxStopsOpacity(input: {
  phase: MaxVisualPhase;
  progress: number;
  evolveHideStops: boolean;
  retreatStopsFrom?: number;
}): number {
  const progress = clampMaxProgress(input.progress);
  switch (input.phase) {
    case 'idle':
    case 'preview':
      return 1;
    case 'evolve':
      return input.evolveHideStops ? 0 : 1 - progress;
    case 'settled':
      return 0;
    case 'retreat': {
      const from = clampMaxProgress(input.retreatStopsFrom ?? 0);
      return from + (1 - from) * progress;
    }
    default:
      return 1;
  }
}

/** Preview paints a local cluster and therefore has no rail-wide coverage. */
export function resolveMaxFieldCoverage(input: {
  phase: MaxVisualPhase;
  progress: number;
}): number {
  const progress = clampMaxProgress(input.progress);
  switch (input.phase) {
    case 'evolve':
      return progress;
    case 'settled':
      return 1;
    case 'retreat':
      return 1 - progress;
    default:
      return 0;
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
