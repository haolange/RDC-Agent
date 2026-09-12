import { describe, expect, it, vi } from 'vitest';
import { createAppSettingsAppearanceActions } from './appSettingsAppearanceActions';
import { DEFAULT_SETTINGS } from './defaultAppSettings';

describe('Appearance persistence ordering', () => {
  it('merges consecutive edits after the preceding save, without losing the other theme', async () => {
    let settings = structuredClone(DEFAULT_SETTINGS);
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const patchSettings = vi.fn(async (patch) => {
      if (patchSettings.mock.calls.length === 1) await first;
      settings = { ...settings, appearance: { ...settings.appearance, ...patch.appearance } };
      return settings;
    });
    const actions = createAppSettingsAppearanceActions(() => ({ settings, patchSettings }));
    const accent = actions.setChromeTheme('light', { accent: '#bf4c22' });
    const surface = actions.setChromeTheme('light', { surface: '#f8eee8' });
    const dark = actions.setChromeTheme('dark', { accent: '#33d1ff' });
    await Promise.resolve();
    expect(patchSettings).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([accent, surface, dark]);
    expect(settings.appearance.chromeThemes.light).toMatchObject({ accent: '#bf4c22', surface: '#f8eee8' });
    expect(settings.appearance.chromeThemes.dark.accent).toBe('#33d1ff');
  });

  it('reports a failed save and continues with subsequent edits', async () => {
    const patchSettings = vi.fn().mockRejectedValueOnce(new Error('write failed')).mockResolvedValue(DEFAULT_SETTINGS);
    const actions = createAppSettingsAppearanceActions(() => ({ settings: DEFAULT_SETTINGS, patchSettings }));
    await expect(actions.setTheme('light')).rejects.toThrow('write failed');
    await actions.setTheme('dark');
    expect(patchSettings).toHaveBeenLastCalledWith({ appearance: { theme: 'dark' } });
  });
});
