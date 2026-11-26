import { enOnboarding } from './locales/en/onboarding';
import { zhOnboarding } from './locales/zh-CN/onboarding';
import { enApp } from './locales/en/app';
import { enChat } from './locales/en/chat';
import { enComposer } from './locales/en/composer';
import { enContextBreakdown } from './locales/en/contextBreakdown';
import { enContextMenu } from './locales/en/contextMenu';
import { enControl } from './locales/en/control';
import { enDevice } from './locales/en/device';
import { enDialog } from './locales/en/dialog';
import { enEmptyWorkbench } from './locales/en/emptyWorkbench';
import { enErrors } from './locales/en/errors';
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
import { zhErrors } from './locales/zh-CN/errors';
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
import { pseudoLocaleEnabled, pseudoLocalize } from './pseudoLocale';
import type { AppLanguage } from '@shared/types/settings';

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
  ...enErrors,
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
  ...zhErrors,
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

// Keys also arrive through template casts (`settings.kind.${kind}` as TranslationKey), so a lookup can miss.
const translations: Record<AppLanguage, Readonly<Partial<Record<string, string>>>> = {
  'zh-CN': chineseTranslations,
  en: englishTranslations,
};

const HAN = /[\u3400-\u9fff\uf900-\ufaff]/u;
const LATIN = /[A-Za-z0-9]/u;
const meetsAcrossScripts = (left: string | undefined, right: string | undefined): boolean =>
  Boolean(left && right) && ((HAN.test(left!) && LATIN.test(right!)) || (LATIN.test(left!) && HAN.test(right!)));

/**
 * Chinese copy puts a space between Han characters and Latin letters or digits. Templates are written that way; a value
 * dropped into a template gets the same space where it meets the surrounding text, so「编辑{kind}」reads「编辑钩子」and
 * 「编辑 MCP」alike.
 */
const spaceAtSeams = (value: string, before: string | undefined, after: string | undefined): string =>
  `${meetsAcrossScripts(before, value[0]) ? ' ' : ''}${value}${meetsAcrossScripts(value.at(-1), after) ? ' ' : ''}`;

export const translate = (
  language: AppLanguage,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string => {
  const stored = translations[language][key] ?? key;
  const text = language === 'en' && pseudoLocaleEnabled() ? pseudoLocalize(stored) : stored;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string, offset: number) => {
    if (!Object.hasOwn(params, name)) return placeholder;
    const value = String(params[name]);
    return language === 'zh-CN' ? spaceAtSeams(value, text[offset - 1], text[offset + placeholder.length]) : value;
  });
};

export type Translator = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** A translator that also names its language, for text that formats numbers, dates and durations with `Intl`. */
export type LocalizedTranslator = Translator & { readonly language: AppLanguage };

/** Gives an existing translator its language; components pair `useI18n`'s `t` and `language` this way. */
export const withLanguage = (t: Translator, language: AppLanguage): LocalizedTranslator =>
  Object.assign((key: TranslationKey, params?: Record<string, string | number>) => t(key, params), { language });

const localizedTranslators = new Map<AppLanguage, LocalizedTranslator>();

/** One translator per language, so caches keyed by translator identity survive re-renders. */
export const localizedTranslator = (language: AppLanguage): LocalizedTranslator => {
  const existing = localizedTranslators.get(language);
  if (existing) return existing;
  const created = Object.assign(
    (key: TranslationKey, params?: Record<string, string | number>) => translate(language, key, params),
    { language },
  );
  localizedTranslators.set(language, created);
  return created;
};
