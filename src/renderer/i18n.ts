import { useMemo } from 'react';
import { useAppSettingsStore } from './stores/appSettingsStore';
import { translate, type TranslationKey } from './i18n/messages';
export { translate, type TranslationKey, type Translator } from './i18n/messages';

export const useI18n = () => {
  const language = useAppSettingsStore((state) => state.settings.appearance.language);

  return useMemo(() => ({
    language,
    t: (key: TranslationKey, params?: Record<string, string | number>) => translate(language, key, params),
  }), [language]);
};
