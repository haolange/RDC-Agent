import { BrowserWindow, nativeTheme } from 'electron';
import { compileThemeChrome } from '@shared/theme/compiler';
import { rgbToHex } from '@shared/theme/color';
import { settingsService } from '../settings/settings-core/SettingsService';
import type { ResolvedTheme, UiPreferences } from '@shared/types/settings';

/** The theme the window shows now: the user's choice, or the system's when the choice is "system". */
export function resolvedAppearanceMode(appearance: UiPreferences): ResolvedTheme {
  if (appearance.theme !== 'system') return appearance.theme;
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

export function activeChromeAccent(appearance: UiPreferences): string {
  return appearance.chromeThemes[resolvedAppearanceMode(appearance)].accent;
}

/** The compiled app background of the active theme, so the window never flashes another theme before paint. */
export function windowBackgroundColor(appearance: UiPreferences): string {
  const mode = resolvedAppearanceMode(appearance);
  const triplet = compileThemeChrome(appearance.chromeThemes[mode], mode)['--color-bg-0'];
  const [r, g, b] = triplet.split(/\s+/).map(Number);
  return rgbToHex({ r, g, b });
}

/** Repaints every window's native background after the theme or the system appearance changes. */
export function applyWindowBackgrounds(): void {
  const color = windowBackgroundColor(settingsService.snapshot().user.appearance);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.setBackgroundColor(color);
  }
}
