import { enOnboarding } from './locales/en/onboarding';
import { zhOnboarding } from './locales/zh-CN/onboarding';
import type { AppLanguage } from '@shared/types/settings';
import { enApp } from './locales/en/app';
import { enChat } from './locales/en/chat';
import { enComposer } from './locales/en/composer';
import { enContextBreakdown } from './locales/en/contextBreakdown';
import { enContextMenu } from './locales/en/contextMenu';
import { enControl } from './locales/en/control';
import { enDevice } from './locales/en/device';
import { enDialog } from './locales/en/dialog';
import { enEmptyWorkbench } from './locales/en/emptyWorkbench';
import { enFont } from './locales/en/font';
import { enKnowledgeCenter } from './locales/en/knowledgeCenter';
import { enLanguage } from './locales/en/language';
import { enMemory } from './locales/en/memory';
import { enMode } from './locales/en/mode';
import { enProjectCapture } from './locales/en/projectCapture';
import { enSettings } from './locales/en/settings';
import { enSidebar } from './locales/en/sidebar';
import { enTerminal } from './locales/en/terminal';
import { enTheme } from './locales/en/theme';
import { enUserMenu } from './locales/en/userMenu';
import { zhApp } from './locales/zh-CN/app';
import { zhChat } from './locales/zh-CN/chat';
import { zhComposer } from './locales/zh-CN/composer';
import { zhContextBreakdown } from './locales/zh-CN/contextBreakdown';
import { zhContextMenu } from './locales/zh-CN/contextMenu';
import { zhControl } from './locales/zh-CN/control';
import { zhDevice } from './locales/zh-CN/device';
import { zhDialog } from './locales/zh-CN/dialog';
import { zhEmptyWorkbench } from './locales/zh-CN/emptyWorkbench';
import { zhFont } from './locales/zh-CN/font';
import { zhKnowledgeCenter } from './locales/zh-CN/knowledgeCenter';
import { zhLanguage } from './locales/zh-CN/language';
import { zhMemory } from './locales/zh-CN/memory';
import { zhMode } from './locales/zh-CN/mode';
import { zhProjectCapture } from './locales/zh-CN/projectCapture';
import { zhSettings } from './locales/zh-CN/settings';
import { zhSidebar } from './locales/zh-CN/sidebar';
import { zhTerminal } from './locales/zh-CN/terminal';
import { zhTheme } from './locales/zh-CN/theme';
import { zhUserMenu } from './locales/zh-CN/userMenu';

export const englishTranslations = {
  ...enOnboarding,
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

export const chineseTranslations: Record<TranslationKey, string> = {
  ...zhOnboarding,
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
  'zh-CN': chineseTranslations,
  en: englishTranslations,
};

export const translate = (
  language: AppLanguage,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string => {
  const text = translations[language][key] ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => Object.hasOwn(params, name) ? String(params[name]) : placeholder);
};

export type Translator = (key: TranslationKey, params?: Record<string, string | number>) => string;
