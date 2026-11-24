import { describe, expect, it, vi } from 'vitest';
import { createDefaultAppSettings } from '@shared/constants/appSettingsDefaults';
import { createAppSettingsAppearanceActions } from './appSettingsAppearanceActions';

const DEFAULT_SETTINGS = createDefaultAppSettings();

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
    const actions = createAppSettingsAppearanceActions(() => ({ settings, patchSettings }), vi.fn(), vi.fn());
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
    const actions = createAppSettingsAppearanceActions(() => ({ settings: DEFAULT_SETTINGS, patchSettings }), vi.fn(), vi.fn());
    await expect(actions.setTheme('light')).rejects.toThrow('write failed');
    await actions.setTheme('dark');
    expect(patchSettings).toHaveBeenLastCalledWith({ appearance: { theme: 'dark' } });
  });

  it('keeps disclosure intent immediate when a stale save fails and reports only the latest failure', async () => {
    let rejectFirst!: (error: Error) => void;
    const first = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
    const display = vi.fn();
    const persist = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk full'));
    const actions = createAppSettingsAppearanceActions(
      () => ({ settings: DEFAULT_SETTINGS, patchSettings: vi.fn() }), display, persist,
    );
    const expanding = actions.setContextBreakdownExpanded(true);
    const collapsing = actions.setContextBreakdownExpanded(false);
    expect(display.mock.calls).toEqual([[{ expanded: true }], [{ expanded: false }]]);
    await Promise.resolve();
    expect(persist.mock.calls).toEqual([[true]]);
    rejectFirst(new Error('stale write failed'));
    await Promise.all([expanding, collapsing]);
    expect(persist.mock.calls).toEqual([[true], [false]]);
    expect(display).toHaveBeenCalledTimes(2);
    await actions.setContextBreakdownExpanded(true);
    expect(display).toHaveBeenLastCalledWith({ expanded: true, error: 'disk full' });
  });
});
