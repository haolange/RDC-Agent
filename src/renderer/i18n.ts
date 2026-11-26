import { useMemo } from 'react';
import { useAppSettingsStore } from './stores/appSettingsStore';
import { localizedTranslator, type Translator } from './i18n/messages';
import type { AppLanguage } from '@shared/types/settings';
export { translate, type LocalizedTranslator, type TranslationKey, type Translator } from './i18n/messages';

export const useI18n = () => {
  const language = useAppSettingsStore((state) => state.settings.appearance.language);

  return useMemo(
    (): { language: AppLanguage; t: Translator } => ({
      language,
      t: localizedTranslator(language),
    }),
    [language],
  );
};
