import type { DropdownOption } from './types';

export const VIEWPORT_MARGIN = 16;
/** Gap between trigger and menu; filled by the caret tip for a tight junction. */
export const ANCHOR_GAP = 6;
export const MENU_CARET_SIZE = 7;
export const DEFAULT_MIN_MENU_WIDTH = 240;

export const clamp = (value: number, min: number, max: number): number => {
  if (max < min) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
};

export const normalizeTestIdSegment = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'option';
};

export const findFirstEnabledIndex = (options: DropdownOption[]): number =>
  options.findIndex((option) => !option.disabled);

export const findSelectedEnabledIndex = (options: DropdownOption[], value: string): number =>
  options.findIndex((option) => option.value === value && !option.disabled);

export const findNextEnabledIndex = (
  options: DropdownOption[],
  startIndex: number,
  direction: 1 | -1,
): number => {
  if (options.length === 0) {
    return -1;
  }

  let nextIndex = startIndex;
  for (let step = 0; step < options.length; step += 1) {
    nextIndex = (nextIndex + direction + options.length) % options.length;
    if (!options[nextIndex]?.disabled) {
      return nextIndex;
    }
  }

  return -1;
};
