import type {
  AppLanguage,
  AppTheme,
  FontScale,
  ReduceMotionPreference,
  ThemeChromeConfig,
  ThemeVariant,
} from '@shared/types/settings';
import type { AppSettingsState } from './appSettingsStoreState';

type AppearanceGet = () => Pick<AppSettingsState, 'settings' | 'patchSettings'>;

export function createAppSettingsAppearanceActions(get: AppearanceGet): Pick<
  AppSettingsState,
  | 'setTheme'
  | 'setLanguage'
  | 'setFontScale'
  | 'setComposerMarkdown'
  | 'setUsePointerCursors'
  | 'setReduceMotion'
  | 'setChromeTheme'
  | 'setContextBreakdownExpanded'
> {
  return {
    setTheme: async (theme: AppTheme) => {
      await get().patchSettings({ appearance: { theme } });
    },
    setLanguage: async (language: AppLanguage) => {
      await get().patchSettings({ appearance: { language } });
    },
    setFontScale: async (fontScale: FontScale) => {
      await get().patchSettings({ appearance: { fontScale } });
    },
    setComposerMarkdown: async (composerMarkdown: boolean) => {
      await get().patchSettings({ appearance: { composerMarkdown } });
    },
    setUsePointerCursors: async (usePointerCursors: boolean) => {
      await get().patchSettings({ appearance: { usePointerCursors } });
    },
    setReduceMotion: async (reduceMotion: ReduceMotionPreference) => {
      await get().patchSettings({ appearance: { reduceMotion } });
    },
    setChromeTheme: async (variant: ThemeVariant, chrome: Partial<ThemeChromeConfig>) => {
      const current = get().settings.appearance.chromeThemes;
      await get().patchSettings({
        appearance: {
          chromeThemes: {
            ...current,
            [variant]: {
              ...current[variant],
              ...chrome,
              fonts: {
                ...current[variant].fonts,
                ...(chrome.fonts ?? {}),
              },
            },
          },
        },
      });
    },
    setContextBreakdownExpanded: async (contextBreakdownExpanded: boolean) => {
      await get().patchSettings({ appearance: { contextBreakdownExpanded } });
    },
  };
}
