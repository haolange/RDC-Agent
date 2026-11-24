import type {
  AppLanguage,
  AppTheme,
  FontScale,
  ThemeChromeConfig,
  ThemeVariant,
  WorkProcessExpansion,
} from '@shared/types/settings';
import type { AppSettingsState } from './appSettingsStoreState';

type AppearanceGet = () => Pick<AppSettingsState, 'settings' | 'patchSettings'>;

export function createAppSettingsAppearanceActions(
  get: AppearanceGet,
  setContextBreakdownPreference: (preference: NonNullable<AppSettingsState['contextBreakdownPreference']>) => void,
  persistContextBreakdownExpanded: (expanded: boolean) => Promise<void>,
): Pick<
  AppSettingsState,
  | 'setTheme'
  | 'setLanguage'
  | 'setFontScale'
  | 'setComposerMarkdown'
  | 'setChromeTheme'
  | 'setContextBreakdownExpanded'
  | 'setWorkProcessExpansion'
> {
  let pending: Promise<unknown> = Promise.resolve();
  let contextBreakdownRevision = 0;
  type Patch = Parameters<AppSettingsState['patchSettings']>[0];
  const enqueue = (operation: () => Promise<unknown>): Promise<void> => {
    const next = pending.then(operation).then(() => undefined);
    pending = next.catch(() => undefined);
    return next;
  };
  const save = (patch: Patch | (() => Patch)): Promise<void> => {
    return enqueue(() => get().patchSettings(typeof patch === 'function' ? patch() : patch));
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
    setChromeTheme: async (variant: ThemeVariant, chrome: Partial<ThemeChromeConfig>) => {
      await save(() => {
        const current = get().settings.appearance.chromeThemes;
        return { appearance: { chromeThemes: { ...current, [variant]: {
          ...current[variant], ...chrome,
          fonts: { ...current[variant].fonts, ...chrome.fonts },
        } } } };
      });
    },
    setContextBreakdownExpanded: async (expanded: boolean) => {
      const revision = ++contextBreakdownRevision;
      setContextBreakdownPreference({ expanded });
      try {
        await enqueue(() => persistContextBreakdownExpanded(expanded));
      } catch (error) {
        if (revision === contextBreakdownRevision) {
          setContextBreakdownPreference({ expanded, error: error instanceof Error ? error.message : String(error) });
        }
      }
    },
    setWorkProcessExpansion: async (workProcessExpansion: WorkProcessExpansion) => {
      await save({ appearance: { workProcessExpansion } });
    },
  };
}
