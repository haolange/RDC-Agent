import type { ThemeChromeConfig, ThemePresetId, ThemeVariant } from '../types/settings';

export interface ThemePresetDefinition {
  id: ThemePresetId;
  label: string;
  light: ThemeChromeConfig;
  dark: ThemeChromeConfig;
}

const chrome = (
  presetId: ThemePresetId,
  accent: string,
  surface: string,
  ink: string,
  contrast = 45,
): ThemeChromeConfig => ({
  presetId,
  accent,
  surface,
  ink,
  contrast,
  fonts: { ui: null, code: null },
});

/** Built-in Appearance presets (Codex-aligned names + RDC product default). */
export const THEME_PRESET_CATALOG: readonly ThemePresetDefinition[] = [
  {
    id: 'rdc',
    label: 'RDC',
    light: chrome('rdc', '#1b9dcc', '#fafbfd', '#151d27', 45),
    dark: chrome('rdc', '#33d1ff', '#0f1115', '#f4f6f8', 45),
  },
  {
    id: 'absolutely',
    label: 'Absolutely',
    light: chrome('absolutely', '#cc7d5e', '#f5f5f7', '#2d2d2e', 45),
    dark: chrome('absolutely', '#cc7d5e', '#202028', '#f5f5f7', 45),
  },
  {
    id: 'ayu',
    label: 'Ayu',
    light: chrome('ayu', '#ff8f40', '#fafafa', '#5c6166', 45),
    dark: chrome('ayu', '#ffb454', '#0f1419', '#e6e1cf', 45),
  },
  {
    id: 'catppuccin',
    label: 'Catppuccin',
    light: chrome('catppuccin', '#8839ef', '#eff1f5', '#4c4f69', 45),
    dark: chrome('catppuccin', '#cba6f7', '#1e1e2e', '#cdd6f4', 45),
  },
  {
    id: 'dracula',
    label: 'Dracula',
    light: chrome('dracula', '#bd93f9', '#f8f8f2', '#282a36', 48),
    dark: chrome('dracula', '#bd93f9', '#282a36', '#f8f8f2', 45),
  },
  {
    id: 'everforest',
    label: 'Everforest',
    light: chrome('everforest', '#8da101', '#fdf6e3', '#5c6a72', 45),
    dark: chrome('everforest', '#a7c080', '#2d353b', '#d3c6aa', 45),
  },
  {
    id: 'github',
    label: 'GitHub',
    light: chrome('github', '#0969da', '#ffffff', '#1f2328', 48),
    dark: chrome('github', '#4493f8', '#0d1117', '#e6edf3', 45),
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox',
    light: chrome('gruvbox', '#d65d0e', '#fbf1c7', '#3c3836', 45),
    dark: chrome('gruvbox', '#fe8019', '#282828', '#ebdbb2', 45),
  },
  {
    id: 'linear',
    label: 'Linear',
    light: chrome('linear', '#5e6ad2', '#f7f8f8', '#28282c', 45),
    dark: chrome('linear', '#5e6ad2', '#0f1011', '#f7f8f8', 45),
  },
] as const;

export const THEME_PRESET_IDS: readonly ThemePresetId[] = THEME_PRESET_CATALOG.map((p) => p.id);

export const DEFAULT_THEME_PRESET_ID: ThemePresetId = 'rdc';

export function isThemePresetId(value: unknown): value is ThemePresetId {
  return typeof value === 'string' && THEME_PRESET_IDS.includes(value as ThemePresetId);
}

export function getThemePreset(id: ThemePresetId): ThemePresetDefinition {
  const found = THEME_PRESET_CATALOG.find((preset) => preset.id === id);
  return found ?? THEME_PRESET_CATALOG[0];
}

export function getPresetChrome(id: ThemePresetId, variant: ThemeVariant): ThemeChromeConfig {
  const preset = getThemePreset(id);
  return variant === 'light' ? { ...preset.light, fonts: { ...preset.light.fonts } }
    : { ...preset.dark, fonts: { ...preset.dark.fonts } };
}

export function createDefaultChromeThemes(): { light: ThemeChromeConfig; dark: ThemeChromeConfig } {
  return {
    light: getPresetChrome('rdc', 'light'),
    dark: getPresetChrome('rdc', 'dark'),
  };
}
