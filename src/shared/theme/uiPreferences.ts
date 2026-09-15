import type {
  AppLanguage,
  AppTheme,
  FontScale,
  UiPreferences,
} from '../types/settings';
import { createDefaultChromeThemes } from './presets';
import { sanitizeChromeThemes } from './sanitize';

const VALID_THEMES: AppTheme[] = ['dark', 'light', 'system'];
const VALID_LANGUAGES: AppLanguage[] = ['zh-CN', 'en'];
const VALID_FONT_SCALES: FontScale[] = ['small', 'medium', 'large'];

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function createDefaultUiPreferences(): UiPreferences {
  return {
    theme: 'dark',
    language: 'zh-CN',
    fontScale: 'medium',
    composerMarkdown: false,
    usePointerCursors: false,
    contextBreakdownExpanded: true,
    chromeThemes: createDefaultChromeThemes(),
  };
}

export function sanitizeUiPreferences(
  candidate: unknown,
  fallback: UiPreferences = createDefaultUiPreferences(),
): UiPreferences {
  const record = candidate && typeof candidate === 'object'
    ? candidate as Partial<UiPreferences> & Record<string, unknown>
    : {};
  const chromeSource = record.chromeThemes
    ?? (record as { chromeThemes?: unknown }).chromeThemes;
  return {
    theme: pickEnum(record.theme, VALID_THEMES, fallback.theme),
    language: pickEnum(record.language, VALID_LANGUAGES, fallback.language),
    fontScale: pickEnum(record.fontScale, VALID_FONT_SCALES, fallback.fontScale),
    composerMarkdown: typeof record.composerMarkdown === 'boolean'
      ? record.composerMarkdown
      : fallback.composerMarkdown,
    usePointerCursors: typeof record.usePointerCursors === 'boolean'
      ? record.usePointerCursors
      : fallback.usePointerCursors,
    contextBreakdownExpanded: typeof record.contextBreakdownExpanded === 'boolean'
      ? record.contextBreakdownExpanded
      : fallback.contextBreakdownExpanded,
    chromeThemes: sanitizeChromeThemes(chromeSource, fallback.chromeThemes),
  };
}

/** Merge a partial appearance patch onto current preferences, then sanitize. */
export function mergeUiPreferences(
  current: UiPreferences,
  patch: Partial<UiPreferences> | undefined,
): UiPreferences {
  if (!patch) {
    return sanitizeUiPreferences(current);
  }
  const chromePatch = patch.chromeThemes;
  const mergedChrome = chromePatch
    ? {
        light: { ...current.chromeThemes.light, ...chromePatch.light, fonts: {
          ...current.chromeThemes.light.fonts,
          ...(chromePatch.light?.fonts ?? {}),
        } },
        dark: { ...current.chromeThemes.dark, ...chromePatch.dark, fonts: {
          ...current.chromeThemes.dark.fonts,
          ...(chromePatch.dark?.fonts ?? {}),
        } },
      }
    : current.chromeThemes;
  return sanitizeUiPreferences({
    ...current,
    ...patch,
    chromeThemes: mergedChrome,
  });
}
