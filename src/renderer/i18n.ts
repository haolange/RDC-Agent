import { useMemo } from 'react';
import type { AppLanguage } from '@shared/types/settings';
import { useAppSettingsStore } from './stores/appSettingsStore';
import { enApp } from './i18n/locales/en/app';
import { enChat } from './i18n/locales/en/chat';
import { enComposer } from './i18n/locales/en/composer';
import { enContextBreakdown } from './i18n/locales/en/contextBreakdown';
import { enContextMenu } from './i18n/locales/en/contextMenu';
import { enControl } from './i18n/locales/en/control';
import { enDevice } from './i18n/locales/en/device';
import { enDialog } from './i18n/locales/en/dialog';
import { enEmptyWorkbench } from './i18n/locales/en/emptyWorkbench';
import { enFont } from './i18n/locales/en/font';
import { enKnowledgeCenter } from './i18n/locales/en/knowledgeCenter';
import { enLanguage } from './i18n/locales/en/language';
import { enMemory } from './i18n/locales/en/memory';
import { enMode } from './i18n/locales/en/mode';
import { enProjectCapture } from './i18n/locales/en/projectCapture';
import { enSettings } from './i18n/locales/en/settings';
import { enSidebar } from './i18n/locales/en/sidebar';
import { enTerminal } from './i18n/locales/en/terminal';
import { enTheme } from './i18n/locales/en/theme';
import { enUserMenu } from './i18n/locales/en/userMenu';
import { zhApp } from './i18n/locales/zh-CN/app';
import { zhChat } from './i18n/locales/zh-CN/chat';
import { zhComposer } from './i18n/locales/zh-CN/composer';
import { zhContextBreakdown } from './i18n/locales/zh-CN/contextBreakdown';
import { zhContextMenu } from './i18n/locales/zh-CN/contextMenu';
import { zhControl } from './i18n/locales/zh-CN/control';
import { zhDevice } from './i18n/locales/zh-CN/device';
import { zhDialog } from './i18n/locales/zh-CN/dialog';
import { zhEmptyWorkbench } from './i18n/locales/zh-CN/emptyWorkbench';
import { zhFont } from './i18n/locales/zh-CN/font';
import { zhKnowledgeCenter } from './i18n/locales/zh-CN/knowledgeCenter';
import { zhLanguage } from './i18n/locales/zh-CN/language';
import { zhMemory } from './i18n/locales/zh-CN/memory';
import { zhMode } from './i18n/locales/zh-CN/mode';
import { zhProjectCapture } from './i18n/locales/zh-CN/projectCapture';
import { zhSettings } from './i18n/locales/zh-CN/settings';
import { zhSidebar } from './i18n/locales/zh-CN/sidebar';
import { zhTerminal } from './i18n/locales/zh-CN/terminal';
import { zhTheme } from './i18n/locales/zh-CN/theme';
import { zhUserMenu } from './i18n/locales/zh-CN/userMenu';

const englishTranslations = {
  ...enApp,
  ...enChat,
  ...enComposer,
  ...enContextBreakdown,
  ...enContextMenu,
  ...enControl,
  ...enDevice,
  ...enDialog,
  ...enEmptyWorkbench,
  ...enFont,
  ...enKnowledgeCenter,
  ...enLanguage,
  ...enMemory,
  ...enMode,
  ...enProjectCapture,
  ...enSettings,
  ...enSidebar,
  ...enTerminal,
  ...enTheme,
  ...enUserMenu,
} satisfies Record<string, string>;

export type TranslationKey = keyof typeof englishTranslations;

const zhCnOverrides: Partial<Record<TranslationKey, string>> = {
  ...zhApp,
  ...zhChat,
  ...zhComposer,
  ...zhContextBreakdown,
  ...zhContextMenu,
  ...zhControl,
  ...zhDevice,
  ...zhDialog,
  ...zhEmptyWorkbench,
  ...zhFont,
  ...zhKnowledgeCenter,
  ...zhLanguage,
  ...zhMemory,
  ...zhMode,
  ...zhProjectCapture,
  ...zhSettings,
  ...zhSidebar,
  ...zhTerminal,
  ...zhTheme,
  ...zhUserMenu,
};

const translations: Record<AppLanguage, Record<TranslationKey, string>> = {
  'zh-CN': {
    ...englishTranslations,
    ...zhCnOverrides,
  },
  en: englishTranslations,
};

export const translate = (
  language: AppLanguage,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string => {
  let text = translations[language][key] ?? key;
  if (!params) return text;
  for (const [param, value] of Object.entries(params)) {
    text = text.replace(`{${param}}`, String(value));
  }
  return text;
};

export const useI18n = () => {
  const language = useAppSettingsStore((state) => state.settings.appearance.language);

  return useMemo(() => ({
    language,
    t: (key: TranslationKey, params?: Record<string, string | number>) => translate(language, key, params),
  }), [language]);
};
