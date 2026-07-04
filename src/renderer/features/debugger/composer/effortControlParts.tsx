import type { EffortLevel } from '@shared/types/modelCapability';
import { EFFORT_LEVELS } from '@shared/types/modelCapability';

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

export function findAdjacentSupportedLevel(
  current: EffortLevel,
  direction: -1 | 1,
  supported: EffortLevel[],
): EffortLevel | null {
  const currentIndex = EFFORT_LEVELS.indexOf(current);
  for (let offset = 1; offset < EFFORT_LEVELS.length; offset += 1) {
    const candidate = EFFORT_LEVELS[currentIndex + direction * offset];
    if (!candidate) {
      return null;
    }
    if (supported.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}
