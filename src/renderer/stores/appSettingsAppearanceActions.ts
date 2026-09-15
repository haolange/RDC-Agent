import type {
  AppLanguage,
  AppTheme,
  FontScale,
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
  | 'setChromeTheme'
  | 'setContextBreakdownExpanded'
> {
  let pending: Promise<unknown> = Promise.resolve();
  type Patch = Parameters<AppSettingsState['patchSettings']>[0];
  const save = (patch: Patch | (() => Patch)): Promise<void> => {
    const next = pending.then(() => get().patchSettings(typeof patch === 'function' ? patch() : patch)).then(() => undefined);
    pending = next.catch(() => undefined);
    return next;
  };
  return {
    setTheme: async (theme: AppTheme) => {
      await save({ appearance: { theme } });
    },
    setLanguage: async (language: AppLanguage) => {
      await save({ appearance: { language } });
    },
    setFontScale: async (fontScale: FontScale) => {
      await save({ appearance: { fontScale } });
    },
    setComposerMarkdown: async (composerMarkdown: boolean) => {
      await save({ appearance: { composerMarkdown } });
    },
    setUsePointerCursors: async (usePointerCursors: boolean) => {
      await save({ appearance: { usePointerCursors } });
    },
    setChromeTheme: async (variant: ThemeVariant, chrome: Partial<ThemeChromeConfig>) => {
      await save(() => {
        const current = get().settings.appearance.chromeThemes;
        return { appearance: { chromeThemes: { ...current, [variant]: {
          ...current[variant], ...chrome,
          fonts: { ...current[variant].fonts, ...chrome.fonts },
        } } } };
      });
    },
    setContextBreakdownExpanded: async (contextBreakdownExpanded: boolean) => {
      await save({ appearance: { contextBreakdownExpanded } });
    },
  };
}
