import type { ReasoningLevel } from '@shared/types/modelCapability';
import { REASONING_LEVELS } from '@shared/types/modelCapability';

export const EFFORT_LABEL_KEYS = {
  off: 'composer.effort.levelOff',
  auto: 'composer.effort.levelAuto',
  low: 'composer.effort.levelLow',
  medium: 'composer.effort.levelMedium',
  high: 'composer.effort.levelHigh',
  extHigh: 'composer.effort.levelExtHigh',
  max: 'composer.effort.levelMax',
} as const;

export function LightningIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

export function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function normalizeDisplayLevels(levels: ReasoningLevel[] | undefined): ReasoningLevel[] {
  if (!levels || levels.length === 0) {
    return ['off'];
  }
  const normalized = REASONING_LEVELS.filter((level) => levels.includes(level));
  return normalized.length > 0 ? normalized : ['off'];
}

export function getStopPosition(index: number, total: number): number {
  return total <= 1 ? 0 : index / (total - 1);
}

export function clampSliderRatio(ratio: number): number {
  return Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
}

export function resolveNearestSnapLevel(ratio: number, supported: ReasoningLevel[]): ReasoningLevel {
  if (supported.length <= 1) {
    return supported[0] ?? 'off';
  }
  const position = clampSliderRatio(ratio) * (supported.length - 1);
  const selectedIndex = Math.max(0, Math.min(supported.length - 1, Math.round(position)));
  return supported[selectedIndex] ?? supported[0] ?? 'off';
}

export function findAdjacentSupportedLevel(
  current: ReasoningLevel,
  direction: -1 | 1,
  supported: ReasoningLevel[],
): ReasoningLevel | null {
  const currentIndex = supported.indexOf(current);
  if (currentIndex < 0) {
    return supported[0] ?? null;
  }
  return supported[currentIndex + direction] ?? null;
}
