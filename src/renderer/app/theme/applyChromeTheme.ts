import type { ResolvedTheme, ThemeChromeConfig, UiPreferences } from '@shared/types/settings';
import { compileThemeChrome } from '@shared/theme/compiler';

const CHROME_STYLE_ATTR = 'data-rdx-chrome-theme';

function ensureChromeStyleElement(): HTMLStyleElement {
  let el = document.head.querySelector<HTMLStyleElement>(`style[${CHROME_STYLE_ATTR}]`);
  if (!el) {
    el = document.createElement('style');
    el.setAttribute(CHROME_STYLE_ATTR, 'true');
    document.head.appendChild(el);
  }
  return el;
}

export function resolveActiveChrome(
  appearance: UiPreferences,
  resolvedTheme: ResolvedTheme,
): ThemeChromeConfig {
  return resolvedTheme === 'light'
    ? appearance.chromeThemes.light
    : appearance.chromeThemes.dark;
}

/** Apply compiled Appearance chrome onto documentElement via a single style tag. */
export function applyChromeTheme(
  appearance: UiPreferences,
  resolvedTheme: ResolvedTheme,
): void {
  const chrome = resolveActiveChrome(appearance, resolvedTheme);
  const vars = compileThemeChrome(chrome, resolvedTheme);
  const declarations = Object.entries(vars)
    .map(([key, value]) => `${key}: ${value};`)
    .join('\n  ');
  const style = ensureChromeStyleElement();
  style.textContent = `:root {\n  ${declarations}\n}`;

  document.documentElement.dataset.chromePreset = chrome.presetId;
  document.documentElement.dataset.resolvedTheme = resolvedTheme;
  document.documentElement.dataset.theme = appearance.theme;
  document.documentElement.dataset.fontScale = appearance.fontScale;
  document.documentElement.dataset.pointerCursors = appearance.usePointerCursors ? 'true' : 'false';
  document.documentElement.dataset.reduceMotion = appearance.reduceMotion;
  document.documentElement.style.colorScheme = resolvedTheme;
}
