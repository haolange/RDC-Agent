import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_THEME_PRESET_ID, getPresetChrome } from '@shared/theme/presets';

const f = vi.hoisted(() => ({
  theme: { shouldUseDarkColors: true },
  windows: [] as Array<{ isDestroyed: () => boolean; setBackgroundColor: (color: string) => void }>,
}));
vi.mock('electron', () => ({ nativeTheme: f.theme, BrowserWindow: { getAllWindows: () => f.windows } }));
vi.mock('../settings/settings-core/SettingsService', () => ({
  settingsService: { snapshot: () => ({ revision: 1, user: { appearance: appearance('light') } }) },
}));

function appearance(theme: 'dark' | 'light' | 'system') {
  const chrome = (variant: 'dark' | 'light') => getPresetChrome(DEFAULT_THEME_PRESET_ID, variant);
  return { theme, chromeThemes: { dark: chrome('dark'), light: chrome('light') } } as never;
}

beforeEach(() => {
  f.theme.shouldUseDarkColors = true;
  f.windows = [];
});

it('paints the window with the background of the theme the user will see', async () => {
  const { windowBackgroundColor } = await import('./appearanceChrome');
  const dark = windowBackgroundColor(appearance('dark'));
  const light = windowBackgroundColor(appearance('light'));
  expect(dark).toMatch(/^#[0-9a-f]{6}$/);
  expect(light).not.toBe(dark);
  f.theme.shouldUseDarkColors = false;
  expect(windowBackgroundColor(appearance('system'))).toBe(light);
});

it('repaints every live window after a theme change', async () => {
  const { applyWindowBackgrounds, windowBackgroundColor } = await import('./appearanceChrome');
  const live = { isDestroyed: () => false, setBackgroundColor: vi.fn() };
  const closed = { isDestroyed: () => true, setBackgroundColor: vi.fn() };
  f.windows = [live, closed];
  applyWindowBackgrounds();
  expect(live.setBackgroundColor).toHaveBeenCalledWith(windowBackgroundColor(appearance('light')));
  expect(closed.setBackgroundColor).not.toHaveBeenCalled();
});
