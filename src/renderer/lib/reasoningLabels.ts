import type { TranslationKey } from '../i18n/messages';

/** The one wording of each reasoning level, shared by the Composer controls and the subagent card. */
export const EFFORT_LABEL_KEYS = {
  off: 'composer.effort.levelOff',
  on: 'composer.effort.levelOn',
  minimal: 'composer.effort.levelMinimal',
  low: 'composer.effort.levelLow',
  medium: 'composer.effort.levelMedium',
  high: 'composer.effort.levelHigh',
  xhigh: 'composer.effort.levelExtra',
  max: 'composer.effort.levelMax',
} as const satisfies Record<string, TranslationKey>;

export type ReasoningLevelLabel = keyof typeof EFFORT_LABEL_KEYS;

export const isReasoningLevelLabel = (level: string): level is ReasoningLevelLabel => level in EFFORT_LABEL_KEYS;
