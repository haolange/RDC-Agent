import { RevisionLanes } from '../lib/revisionLanes';
import type {
  AppearancePatch,
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
  // Only the newest preference shows its save failure.
  const preferenceLanes = new RevisionLanes();
  // Each change is applied at once and committed as its own op; an earlier one still in flight is never overwritten.
  const save = async (value: AppearancePatch): Promise<void> => {
    await get().patchSettings([{ op: 'appearance', value }]);
  };
  return {
    setTheme: (theme: AppTheme) => save({ theme }),
    setLanguage: (language: AppLanguage) => save({ language }),
    setFontScale: (fontScale: FontScale) => save({ fontScale }),
    setComposerMarkdown: (composerMarkdown: boolean) => save({ composerMarkdown }),
    setChromeTheme: (variant: ThemeVariant, chrome: Partial<ThemeChromeConfig>) => {
      const current = get().settings.appearance.chromeThemes;
      return save({
        chromeThemes: {
          ...current,
          [variant]: {
            ...current[variant],
            ...chrome,
            fonts: { ...current[variant].fonts, ...chrome.fonts },
          },
        },
      });
    },
    setContextBreakdownExpanded: async (expanded: boolean) => {
      const revision = preferenceLanes.begin('contextBreakdown');
      setContextBreakdownPreference({ expanded });
      try {
        await save({ contextBreakdownExpanded: expanded });
      } catch (error) {
        if (preferenceLanes.isLatest('contextBreakdown', revision)) {
          setContextBreakdownPreference({ expanded, error: error instanceof Error ? error.message : String(error) });
        }
      }
    },
    setWorkProcessExpansion: (workProcessExpansion: WorkProcessExpansion) => save({ workProcessExpansion }),
  };
}
