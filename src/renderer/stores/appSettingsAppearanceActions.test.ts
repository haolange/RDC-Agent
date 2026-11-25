import { describe, expect, it, vi } from 'vitest';
import { createDefaultAppSettings } from '@shared/constants/appSettingsDefaults';
import { createAppSettingsAppearanceActions } from './appSettingsAppearanceActions';
import type { SettingsPatchOp } from '@shared/types/settings';

const DEFAULT_SETTINGS = createDefaultAppSettings();

describe('Appearance persistence', () => {
  it('commits each edit as its own op computed from the settings shown, without waiting for the previous save', async () => {
    let settings = structuredClone(DEFAULT_SETTINGS);
    const patchSettings = vi.fn(async (ops: SettingsPatchOp[]) => {
      for (const op of ops) if (op.op === 'appearance') settings = { ...settings, appearance: { ...settings.appearance, ...op.value } };
      return settings;
    });
    const actions = createAppSettingsAppearanceActions(() => ({ settings, patchSettings }), vi.fn());
    const accent = actions.setChromeTheme('light', { accent: '#bf4c22' });
    const surface = actions.setChromeTheme('light', { surface: '#f8eee8' });
    const dark = actions.setChromeTheme('dark', { accent: '#33d1ff' });
    expect(patchSettings).toHaveBeenCalledTimes(3);
    await Promise.all([accent, surface, dark]);
    expect(settings.appearance.chromeThemes.light).toMatchObject({ accent: '#bf4c22', surface: '#f8eee8' });
    expect(settings.appearance.chromeThemes.dark.accent).toBe('#33d1ff');
  });

  it('reports a failed save and continues with subsequent edits', async () => {
    const patchSettings = vi.fn().mockRejectedValueOnce(new Error('write failed')).mockResolvedValue(DEFAULT_SETTINGS);
    const actions = createAppSettingsAppearanceActions(() => ({ settings: DEFAULT_SETTINGS, patchSettings }), vi.fn());
    await expect(actions.setTheme('light')).rejects.toThrow('write failed');
    await actions.setTheme('dark');
    expect(patchSettings).toHaveBeenLastCalledWith([{ op: 'appearance', value: { theme: 'dark' } }]);
  });

  it('keeps disclosure intent immediate when a stale save fails and reports only the latest failure', async () => {
    let rejectFirst!: (error: Error) => void;
    const first = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
    const display = vi.fn();
    const patchSettings = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(DEFAULT_SETTINGS)
      .mockRejectedValueOnce(new Error('disk full'));
    const actions = createAppSettingsAppearanceActions(() => ({ settings: DEFAULT_SETTINGS, patchSettings }), display);
    const expanding = actions.setContextBreakdownExpanded(true);
    const collapsing = actions.setContextBreakdownExpanded(false);
    expect(display.mock.calls).toEqual([[{ expanded: true }], [{ expanded: false }]]);
    expect(patchSettings.mock.calls).toEqual([
      [[{ op: 'appearance', value: { contextBreakdownExpanded: true } }]],
      [[{ op: 'appearance', value: { contextBreakdownExpanded: false } }]],
    ]);
    rejectFirst(new Error('stale write failed'));
    await Promise.all([expanding, collapsing]);
    expect(display).toHaveBeenCalledTimes(2);
    await actions.setContextBreakdownExpanded(true);
    expect(display).toHaveBeenLastCalledWith({ expanded: true, error: 'disk full' });
  });
});
