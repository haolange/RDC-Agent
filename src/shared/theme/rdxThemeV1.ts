import type { ThemeChromeConfig, ThemeVariant } from '../types/settings';
import { sanitizeThemeChrome } from './sanitize';
import { isThemePresetId } from './presets';

export const RDX_THEME_V1_PREFIX = 'rdx-theme-v1:';

export interface RdxThemeV1Payload {
  presetId: string;
  variant: ThemeVariant;
  theme: {
    accent: string;
    surface: string;
    ink: string;
    contrast: number;
    fonts: { ui: string | null; code: string | null };
  };
}

export type RdxThemeV1ParseResult =
  | { ok: true; payload: RdxThemeV1Payload; chrome: ThemeChromeConfig }
  | { ok: false; error: string };

export function serializeRdxThemeV1(chrome: ThemeChromeConfig, variant: ThemeVariant): string {
  const payload: RdxThemeV1Payload = {
    presetId: chrome.presetId,
    variant,
    theme: {
      accent: chrome.accent,
      surface: chrome.surface,
      ink: chrome.ink,
      contrast: chrome.contrast,
      fonts: {
        ui: chrome.fonts.ui,
        code: chrome.fonts.code,
      },
    },
  };
  return `${RDX_THEME_V1_PREFIX}${JSON.stringify(payload)}`;
}

export function parseRdxThemeV1(raw: string, expectedVariant?: ThemeVariant): RdxThemeV1ParseResult {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(RDX_THEME_V1_PREFIX)) {
    if (trimmed.startsWith('codex-theme-v1:')) {
      return { ok: false, error: 'codex-theme-v1 is not supported; use rdx-theme-v1:' };
    }
    return { ok: false, error: 'Theme string must start with rdx-theme-v1:' };
  }
  const jsonPart = trimmed.slice(RDX_THEME_V1_PREFIX.length).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonPart);
  } catch {
    return { ok: false, error: 'Invalid JSON after rdx-theme-v1: prefix' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Theme payload must be an object' };
  }
  const record = parsed as Record<string, unknown>;
  const variant = record.variant === 'light' || record.variant === 'dark'
    ? record.variant
    : null;
  if (!variant) {
    return { ok: false, error: 'variant must be "light" or "dark"' };
  }
  if (expectedVariant && variant !== expectedVariant) {
    return {
      ok: false,
      error: `Theme variant is ${variant}, but this Import targets ${expectedVariant}`,
    };
  }
  const theme = record.theme && typeof record.theme === 'object'
    ? record.theme as Record<string, unknown>
    : null;
  if (!theme) {
    return { ok: false, error: 'theme object is required' };
  }
  const presetId = isThemePresetId(record.presetId) ? record.presetId : 'rdc';
  const chrome = sanitizeThemeChrome(
    {
      presetId,
      accent: theme.accent,
      surface: theme.surface,
      ink: theme.ink,
      contrast: theme.contrast,
      fonts: theme.fonts,
    },
    variant,
  );
  return {
    ok: true,
    payload: {
      presetId: chrome.presetId,
      variant,
      theme: {
        accent: chrome.accent,
        surface: chrome.surface,
        ink: chrome.ink,
        contrast: chrome.contrast,
        fonts: chrome.fonts,
      },
    },
    chrome,
  };
}
