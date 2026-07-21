import type {
  ChromeThemesConfig,
  ReduceMotionPreference,
  ThemeChromeConfig,
  ThemeChromeFonts,
  ThemePresetId,
  ThemeVariant,
} from '../types/settings';
import { isHexColor, normalizeHexColor } from './color';
import {
  createDefaultChromeThemes,
  getPresetChrome,
  isThemePresetId,
} from './presets';

const VALID_REDUCE_MOTION: ReduceMotionPreference[] = ['system', 'on', 'off'];

function sanitizeFonts(candidate: unknown, fallback: ThemeChromeFonts): ThemeChromeFonts {
  if (!candidate || typeof candidate !== 'object') {
    return { ui: fallback.ui, code: fallback.code };
  }
  const record = candidate as Record<string, unknown>;
  const ui = record.ui === null
    ? null
    : typeof record.ui === 'string' && record.ui.trim()
      ? record.ui.trim()
      : fallback.ui;
  const code = record.code === null
    ? null
    : typeof record.code === 'string' && record.code.trim()
      ? record.code.trim()
      : fallback.code;
  return { ui, code };
}

export function sanitizeThemeChrome(
  candidate: unknown,
  variant: ThemeVariant,
  fallback?: ThemeChromeConfig,
): ThemeChromeConfig {
  const base = fallback ?? getPresetChrome('rdc', variant);
  if (!candidate || typeof candidate !== 'object') {
    return {
      ...base,
      fonts: { ...base.fonts },
    };
  }
  const record = candidate as Record<string, unknown>;
  const presetId: ThemePresetId = isThemePresetId(record.presetId)
    ? record.presetId
    : base.presetId;
  const contrastRaw = typeof record.contrast === 'number' && Number.isFinite(record.contrast)
    ? record.contrast
    : base.contrast;
  return {
    presetId,
    accent: normalizeHexColor(
      typeof record.accent === 'string' ? record.accent : base.accent,
      base.accent,
    ),
    surface: normalizeHexColor(
      typeof record.surface === 'string' ? record.surface : base.surface,
      base.surface,
    ),
    ink: normalizeHexColor(
      typeof record.ink === 'string' ? record.ink : base.ink,
      base.ink,
    ),
    contrast: Math.max(0, Math.min(100, Math.round(contrastRaw))),
    fonts: sanitizeFonts(record.fonts, base.fonts),
  };
}

export function sanitizeChromeThemes(candidate: unknown, fallback?: ChromeThemesConfig): ChromeThemesConfig {
  const defaults = fallback ?? createDefaultChromeThemes();
  if (!candidate || typeof candidate !== 'object') {
    return {
      light: { ...defaults.light, fonts: { ...defaults.light.fonts } },
      dark: { ...defaults.dark, fonts: { ...defaults.dark.fonts } },
    };
  }
  const record = candidate as Record<string, unknown>;
  return {
    light: sanitizeThemeChrome(record.light, 'light', defaults.light),
    dark: sanitizeThemeChrome(record.dark, 'dark', defaults.dark),
  };
}

export function sanitizeReduceMotion(
  candidate: unknown,
  fallback: ReduceMotionPreference = 'system',
): ReduceMotionPreference {
  return typeof candidate === 'string' && VALID_REDUCE_MOTION.includes(candidate as ReduceMotionPreference)
    ? (candidate as ReduceMotionPreference)
    : fallback;
}

export function assertHexOrNull(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === 'string' && isHexColor(value)) return value.toLowerCase();
  return null;
}
