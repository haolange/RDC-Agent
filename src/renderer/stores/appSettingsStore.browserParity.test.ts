import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from './defaultAppSettings';
import { useAppSettingsStore } from './appSettingsStore';

describe('app settings browser parity', () => {
  afterEach(() => {
    useAppSettingsStore.setState({
      settings: DEFAULT_SETTINGS,
      hydrated: false,
      systemTheme: 'dark',
      agentRouteSyncById: {},
    });
    vi.unstubAllGlobals();
  });

  it('persists a language change once and updates the hydrated store', async () => {
    const persisted = {
      ...DEFAULT_SETTINGS,
      appearance: { ...DEFAULT_SETTINGS.appearance, language: 'en' as const },
    };
    const setSettings = vi.fn().mockResolvedValue(persisted);
    vi.stubGlobal('window', {
      electronAPI: { settings: { set: setSettings } },
    });
    useAppSettingsStore.getState().hydrate(DEFAULT_SETTINGS, 'dark');

    await useAppSettingsStore.getState().setLanguage('en');

    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(setSettings).toHaveBeenCalledWith({ appearance: { language: 'en' } });
    expect(useAppSettingsStore.getState().settings.appearance.language).toBe('en');
    expect(useAppSettingsStore.getState().hydrated).toBe(true);
  });
});
