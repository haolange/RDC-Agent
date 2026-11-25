import {
  applyContrastPair,
  hexToRgb,
  inkOn,
  mixRgb,
  normalizeHexColor,
  readableOn,
  rgbToCssTriplet,
  scaleAccentPalette,
  scaleInkPalette,
  scaleSurfacePalette,
  type Rgb,
} from './color';
import type { ResolvedTheme, ThemeChromeConfig } from '../types/settings';

export type CompiledChromeCssVars = Record<string, string>;

/** WCAG AA: body text and status words read at 4.5:1, the focus ring and other component boundaries at 3:1. */
export const TEXT_CONTRAST = 4.5;
export const BOUNDARY_CONTRAST = 3;

/** Hairline borders are a translucent ink over the surface; the strong step seeds the control boundary. */
const LIGHT_BORDER_INK: Rgb = { r: 20, g: 30, b: 44 };
const DARK_BORDER_INK: Rgb = { r: 255, g: 255, b: 255 };
const LIGHT_STRONG_BORDER_ALPHA = 0.24;
const DARK_STRONG_BORDER_ALPHA = 0.15;

const roundRgb = ({ r, g, b }: Rgb): Rgb => ({ r: Math.round(r), g: Math.round(g), b: Math.round(b) });

/** Starting status hues; the compiler moves each only as far as its contrast floor requires on this chrome. */
const STATUS_SEEDS: Record<ResolvedTheme, Record<'success' | 'warning' | 'error' | 'info', Rgb>> = {
  dark: {
    success: { r: 34, g: 197, b: 94 },
    warning: { r: 251, g: 191, b: 36 },
    error: { r: 255, g: 138, b: 128 },
    info: { r: 56, g: 189, b: 248 },
  },
  light: {
    success: { r: 20, g: 108, b: 61 },
    warning: { r: 122, g: 82, b: 0 },
    error: { r: 180, g: 35, b: 24 },
    info: { r: 56, g: 189, b: 248 },
  },
};

/**
 * Compile Appearance chrome into CSS custom-property patches applied on :root.
 * Does not touch compose/agent effort variables.
 */
export function compileThemeChrome(
  chrome: ThemeChromeConfig,
  variant: ResolvedTheme,
): CompiledChromeCssVars {
  const accent = hexToRgb(normalizeHexColor(chrome.accent, '#33d1ff'));
  const surface = hexToRgb(normalizeHexColor(chrome.surface, variant === 'dark' ? '#0f1115' : '#fafbfd'));
  const ink = hexToRgb(normalizeHexColor(chrome.ink, variant === 'dark' ? '#f4f6f8' : '#151d27'));
  const contrasted = applyContrastPair(surface, ink, chrome.contrast, variant);
  const accents = scaleAccentPalette(accent);
  const surfaces = scaleSurfacePalette(contrasted.surface, variant);
  const texts = scaleInkPalette(contrasted.ink, variant);

  const vars: CompiledChromeCssVars = {};

  for (const [step, rgb] of Object.entries(accents)) {
    vars[`--color-accent-${step}`] = rgbToCssTriplet(rgb);
  }
  for (const [step, rgb] of Object.entries(surfaces)) {
    vars[`--color-bg-${step}`] = rgbToCssTriplet(rgb);
  }
  const overlay = variant === 'light' ? surfaces['3'] : surfaces['2'];
  // Text, status words and the focus ring sit on the app canvas, the chrome layers and popovers.
  const chromeSurfaces = [surfaces['0'], surfaces['1'], surfaces['2'], surfaces['3'], overlay];
  // Accent text, icons and outlined CTAs must stay readable on every chrome surface they sit on, and
  // filled accent surfaces carry whichever of near-black / near-white reads better on that ink.
  const accentInk = readableOn(accents['400'], [surfaces['1'], surfaces['2'], surfaces['3']]);
  vars['--color-accent-ink'] = rgbToCssTriplet(accentInk);
  vars['--color-text-on-accent'] = rgbToCssTriplet(inkOn(accentInk));
  // Each readable step of the ramp moves only when it misses 4.5:1; disabled text is exempt (WCAG 1.4.3).
  for (const step of ['primary', 'secondary', 'tertiary', 'muted'] as const) {
    vars[`--color-text-${step}`] = rgbToCssTriplet(readableOn(texts[step], chromeSurfaces, TEXT_CONTRAST));
  }
  vars['--color-text-disabled'] = rgbToCssTriplet(texts.disabled);
  for (const [status, seed] of Object.entries(STATUS_SEEDS[variant])) {
    vars[`--color-${status}`] = rgbToCssTriplet(readableOn(seed, chromeSurfaces, TEXT_CONTRAST));
  }
  vars['--color-focus-ring'] = rgbToCssTriplet(readableOn(accents['500'], chromeSurfaces, BOUNDARY_CONTRAST));
  // An unchecked checkbox is recognisable only by its outline, so the outline reads at 3:1 (WCAG 1.4.11). It starts
  // from the strong border as painted over the panel and moves only as far as that floor requires.
  const strongBorderOverPanel = variant === 'light'
    ? mixRgb(surfaces['2'], LIGHT_BORDER_INK, LIGHT_STRONG_BORDER_ALPHA)
    : mixRgb(surfaces['2'], DARK_BORDER_INK, DARK_STRONG_BORDER_ALPHA);
  vars['--color-control-boundary'] = rgbToCssTriplet(readableOn(roundRgb(strongBorderOverPanel), chromeSurfaces, BOUNDARY_CONTRAST));

  // Only a chosen font overrides the bundled default stacks owned by design-tokens.css.
  if (chrome.fonts.ui?.trim()) vars['--font-sans'] = chrome.fonts.ui.trim();
  if (chrome.fonts.code?.trim()) vars['--font-mono'] = chrome.fonts.code.trim();

  // Semantic surfaces that read from primitives
  vars['--surface-shell'] = `rgb(var(--color-bg-1))`;
  vars['--surface-panel'] = `rgb(var(--color-bg-2))`;
  vars['--surface-elevated'] = 'rgb(var(--color-bg-2))';
  vars['--surface-active'] = 'rgb(var(--color-accent-500) / 0.1)';
  vars['--color-border-focus'] = 'rgb(var(--color-focus-ring))';
  // Popover / Context Usage overlay chrome follows Appearance surface (not a fixed slate).
  vars['--color-surface-overlay'] = rgbToCssTriplet(overlay);

  if (variant === 'light') {
    vars['--color-border-subtle'] = '20 30 44 / 0.1';
    vars['--color-border-default'] = '20 30 44 / 0.15';
    vars['--color-border-strong'] = `20 30 44 / ${LIGHT_STRONG_BORDER_ALPHA}`;
    vars['--token-surface-sunken'] = 'rgb(var(--color-bg-2))';
    vars['--token-surface-raised'] = 'rgb(var(--color-bg-1))';
  } else {
    vars['--color-border-subtle'] = '255 255 255 / 0.06';
    vars['--color-border-default'] = '255 255 255 / 0.1';
    vars['--color-border-strong'] = `255 255 255 / ${DARK_STRONG_BORDER_ALPHA}`;
  }

  return vars;
}

export function compiledChromeToInlineStyle(vars: CompiledChromeCssVars): string {
  return Object.entries(vars)
    .map(([key, value]) => `${key}: ${value};`)
    .join(' ');
}
