import type { ResolvedTheme, ThemeChromeConfig, UiPreferences } from '@shared/types/settings';
import { compileThemeChrome } from '@shared/theme/compiler';

let chromeSheet: CSSStyleSheet | null = null;

function ensureChromeSheet(): CSSStyleSheet | null {
  if (typeof document === 'undefined') return null;
  if (!chromeSheet) {
    chromeSheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, chromeSheet];
  }
  return chromeSheet;
}

export function resolveActiveChrome(
  appearance: UiPreferences,
  resolvedTheme: ResolvedTheme,
): ThemeChromeConfig {
  return resolvedTheme === 'light'
    ? appearance.chromeThemes.light
    : appearance.chromeThemes.dark;
}

/**
 * Apply compiled Appearance chrome onto documentElement.
 * Uses a constructable stylesheet so CSP may keep `style-src 'self'` /
 * `style-src-attr 'none'` (no `<style>` textContent or inline style attributes).
 */
export function applyChromeTheme(
  appearance: UiPreferences,
  resolvedTheme: ResolvedTheme,
): void {
  const chrome = resolveActiveChrome(appearance, resolvedTheme);
  const vars = compileThemeChrome(chrome, resolvedTheme);
  const declarations = Object.entries(vars)
    .map(([key, value]) => `${key}: ${value};`)
    .join('\n  ');

  const sheet = ensureChromeSheet();
  if (sheet) {
    sheet.replaceSync(
      `:root {\n  color-scheme: ${resolvedTheme};\n  ${declarations}\n}`,
    );
  }

  document.documentElement.dataset.chromePreset = chrome.presetId;
  document.documentElement.dataset.resolvedTheme = resolvedTheme;
  document.documentElement.dataset.theme = appearance.theme;
  document.documentElement.dataset.fontScale = appearance.fontScale;
  document.documentElement.dataset.pointerCursors = appearance.usePointerCursors ? 'true' : 'false';
}
