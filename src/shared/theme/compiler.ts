import {
  applyContrastPair,
  hexToRgb,
  inkOn,
  normalizeHexColor,
  readableOn,
  rgbToCssTriplet,
  scaleAccentPalette,
  scaleInkPalette,
  scaleSurfacePalette,
} from './color';
import type { ResolvedTheme, ThemeChromeConfig } from '../types/settings';

export type CompiledChromeCssVars = Record<string, string>;

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
  // Accent text, icons and outlined CTAs must stay readable on every chrome surface they sit on, and
  // filled accent surfaces carry whichever of near-black / near-white reads better on that ink.
  const accentInk = readableOn(accents['400'], [surfaces['1'], surfaces['2'], surfaces['3']]);
  vars['--color-accent-ink'] = rgbToCssTriplet(accentInk);
  vars['--color-text-on-accent'] = rgbToCssTriplet(inkOn(accentInk));
  vars['--color-text-primary'] = rgbToCssTriplet(texts.primary);
  vars['--color-text-secondary'] = rgbToCssTriplet(texts.secondary);
  vars['--color-text-tertiary'] = rgbToCssTriplet(texts.tertiary);
  vars['--color-text-muted'] = rgbToCssTriplet(texts.muted);
  vars['--color-text-disabled'] = rgbToCssTriplet(texts.disabled);
  vars['--color-success'] = variant === 'light' ? '20 108 61' : '34 197 94';
  vars['--color-warning'] = variant === 'light' ? '122 82 0' : '251 191 36';
  vars['--color-error'] = variant === 'light' ? '180 35 24' : '255 138 128';

  // Only a chosen font overrides the bundled default stacks owned by design-tokens.css.
  if (chrome.fonts.ui?.trim()) vars['--font-sans'] = chrome.fonts.ui.trim();
  if (chrome.fonts.code?.trim()) vars['--font-mono'] = chrome.fonts.code.trim();

  // Semantic surfaces that read from primitives
  vars['--surface-shell'] = `rgb(var(--color-bg-1))`;
  vars['--surface-panel'] = `rgb(var(--color-bg-2))`;
  vars['--surface-elevated'] = 'rgb(var(--color-bg-2))';
  vars['--surface-active'] = 'rgb(var(--color-accent-500) / 0.1)';
  vars['--color-border-focus'] = 'rgb(var(--color-accent-500))';
  // Popover / Context Usage overlay chrome follows Appearance surface (not a fixed slate).
  vars['--color-surface-overlay'] = rgbToCssTriplet(
    variant === 'light' ? surfaces['3'] : surfaces['2'],
  );

  if (variant === 'light') {
    vars['--color-border-subtle'] = '20 30 44 / 0.1';
    vars['--color-border-default'] = '20 30 44 / 0.15';
    vars['--color-border-strong'] = '20 30 44 / 0.24';
    vars['--token-surface-sunken'] = 'rgb(var(--color-bg-2))';
    vars['--token-surface-raised'] = 'rgb(var(--color-bg-1))';
  } else {
    vars['--color-border-subtle'] = '255 255 255 / 0.06';
    vars['--color-border-default'] = '255 255 255 / 0.1';
    vars['--color-border-strong'] = '255 255 255 / 0.15';
  }

  return vars;
}

export function compiledChromeToInlineStyle(vars: CompiledChromeCssVars): string {
  return Object.entries(vars)
    .map(([key, value]) => `${key}: ${value};`)
    .join(' ');
}
