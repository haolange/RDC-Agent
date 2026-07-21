import type { ResolvedTheme } from '../types/settings';
import {
  hexToRgb,
  hslToRgb,
  normalizeHexColor,
  rgbToCssTriplet,
  rgbToHex,
  rgbToHsl,
  mixRgb,
} from './color';

/** Last-resort compose accent when manifest accent is missing (not a product authority). */
export const COMPOSE_ACCENT_FALLBACK = '#33d1ff';

export interface ComposeAccentCssVars {
  '--composer-mode-accent': string;
  '--composer-effort-fill-1': string;
  '--composer-effort-fill-2': string;
  '--composer-effort-fill-3': string;
  '--composer-effort-fill-4': string;
  '--composer-effort-fill-5': string;
  '--composer-effort-thumb': string;
  '--composer-effort-track': string;
  '--composer-effort-max-track': string;
  '--composer-effort-max-from': string;
  '--composer-effort-max-mid': string;
  '--composer-effort-max-to': string;
  '--composer-effort-max-sparkle': string;
  '--composer-effort-max-thumb': string;
}

/**
 * Derive compose-scoped accent + Effort/Max visuals from agent accent.
 * Light/Dark only modulates luminance; hue stays agent-owned.
 */
export function deriveComposeAccentVars(
  accentHex: string,
  resolvedTheme: ResolvedTheme,
): ComposeAccentCssVars {
  const accent = normalizeHexColor(accentHex, COMPOSE_ACCENT_FALLBACK);
  const base = hexToRgb(accent);
  const hsl = rgbToHsl(base);
  const isLight = resolvedTheme === 'light';

  // Ordinary tiers (exclude Max): low = lighter/softer, high = deeper/stronger.
  const fill = (level: number) => {
    const l = isLight
      ? 86 - level * 8
      : 72 - level * 7;
    const s = Math.min(100, hsl.s * (0.85 + level * 0.04));
    return `hsl(${Math.round(hsl.h)} ${Math.round(s)}% ${Math.round(l)}%)`;
  };

  const thumbL = isLight ? 48 : 62;
  /* Keep the Max rail neutral/translucent so the pixel field stays readable. */
  const maxTrack = isLight
    ? mixRgb({ r: 230, g: 232, b: 238 }, base, 0.08)
    : mixRgb({ r: 40, g: 40, b: 46 }, base, 0.1);
  const maxFrom = mixRgb(base, isLight ? { r: 120, g: 120, b: 130 } : { r: 116, g: 111, b: 124 }, 0.45);
  const maxMid = mixRgb(base, isLight ? { r: 160, g: 160, b: 175 } : { r: 157, g: 148, b: 173 }, 0.35);
  const maxTo = mixRgb(base, isLight ? { r: 200, g: 200, b: 210 } : { r: 200, g: 192, b: 212 }, 0.4);
  const sparkle = mixRgb(base, { r: 255, g: 255, b: 255 }, isLight ? 0.55 : 0.72);

  return {
    '--composer-mode-accent': accent,
    '--composer-effort-fill-1': fill(1),
    '--composer-effort-fill-2': fill(2),
    '--composer-effort-fill-3': fill(3),
    '--composer-effort-fill-4': fill(4),
    '--composer-effort-fill-5': fill(5),
    '--composer-effort-thumb': `hsl(${Math.round(hsl.h)} ${Math.round(hsl.s)}% ${thumbL}%)`,
    '--composer-effort-track': isLight
      ? 'color-mix(in srgb, var(--token-border-muted) 80%, transparent)'
      : 'color-mix(in srgb, var(--token-border-muted) 80%, transparent)',
    '--composer-effort-max-track': `rgb(${rgbToCssTriplet(maxTrack)} / 0.38)`,
    '--composer-effort-max-from': rgbToHex(maxFrom),
    '--composer-effort-max-mid': rgbToHex(maxMid),
    '--composer-effort-max-to': rgbToHex(maxTo),
    '--composer-effort-max-sparkle': `rgb(${rgbToCssTriplet(sparkle)} / 0.86)`,
    '--composer-effort-max-thumb': rgbToHex(mixRgb(sparkle, maxTo, 0.12)),
  };
}

export function normalizeAgentAccent(value: unknown, fallback = COMPOSE_ACCENT_FALLBACK): string {
  if (typeof value !== 'string') return normalizeHexColor(fallback, COMPOSE_ACCENT_FALLBACK);
  return normalizeHexColor(value, fallback);
}

/** Soft luminance tweak for agent accent under light/dark shells (hue preserved). */
export function modulateAccentForTheme(accentHex: string, resolvedTheme: ResolvedTheme): string {
  const rgb = hexToRgb(normalizeHexColor(accentHex, COMPOSE_ACCENT_FALLBACK));
  const hsl = rgbToHsl(rgb);
  if (resolvedTheme === 'light') {
    return rgbToHex(hslToRgb({ h: hsl.h, s: hsl.s, l: Math.min(52, Math.max(36, hsl.l)) }));
  }
  return rgbToHex(hslToRgb({ h: hsl.h, s: hsl.s, l: Math.max(48, Math.min(68, hsl.l)) }));
}
