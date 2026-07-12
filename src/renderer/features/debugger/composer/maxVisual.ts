import type { ReasoningSelection } from '@shared/types/modelCapability';

/** Max / Ultra share one top-tier visual pipeline. */
export type MaxVisualPhase = 'idle' | 'preview' | 'evolve' | 'settled' | 'retreat';

export const MAX_VISUAL_EVOLVE_MS = 800;
export const MAX_VISUAL_RETREAT_MS = 800;

export function isMaxTierLevel(level: ReasoningSelection): boolean {
  return level === 'max' || level === 'ultra';
}

/**
 * Stop-dot opacity for the max-tier visual lifecycle.
 * - Ordinary / preview: fully visible
 * - Evolve after adjust: fade 1→0 with progress
 * - Evolve on reopen (`evolveHideStops`): always 0
 * - Settled: hidden
 * - Retreat: lerp from `retreatStopsFrom` → 1 with progress (gradual return)
 */
export function resolveMaxStopsOpacity(input: {
  phase: MaxVisualPhase;
  progress: number;
  evolveHideStops: boolean;
  retreatStopsFrom?: number;
}): number {
  const progress = Number.isFinite(input.progress)
    ? Math.max(0, Math.min(1, input.progress))
    : 0;
  switch (input.phase) {
    case 'idle':
    case 'preview':
      return 1;
    case 'evolve':
      return input.evolveHideStops ? 0 : 1 - progress;
    case 'settled':
      return 0;
    case 'retreat': {
      const from = Number.isFinite(input.retreatStopsFrom)
        ? Math.max(0, Math.min(1, input.retreatStopsFrom as number))
        : 0;
      return from + (1 - from) * progress;
    }
    default:
      return 1;
  }
}

/**
 * How far the pixel field covers the track (0 empty → 1 full).
 * Preview uses a local cluster instead of coverage fill.
 */
export function resolveMaxFieldCoverage(input: {
  phase: MaxVisualPhase;
  progress: number;
}): number {
  const progress = Number.isFinite(input.progress)
    ? Math.max(0, Math.min(1, input.progress))
    : 0;
  switch (input.phase) {
    case 'idle':
      return 0;
    case 'preview':
      return 0;
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
