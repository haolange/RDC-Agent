import { z } from 'zod';
import type { ManifestTextTranslations } from '../types/agentManifest';
import type { AppLanguage } from '../types/settings';

/** Per-language manifest copy: at least one language, each a bounded non-empty string. */
export function manifestTextTranslationsSchema(maxLength: number) {
  const translated = z.string().trim().min(1).max(maxLength);
  return z.object({ 'zh-CN': translated.optional(), en: translated.optional() }).strict()
    .refine(value => Object.values(value).some(text => text !== undefined), {
      message: 'At least one translation is required when translations are present.',
    });
}

export const handoffLabelTranslationsSchema = manifestTextTranslationsSchema(200);
export const agentTextTranslationsSchema = manifestTextTranslationsSchema(1000);

/** The text in the interface language when the manifest ships one, else the manifest's own text. */
export function resolveManifestText(text: string, translations: ManifestTextTranslations | undefined, language: AppLanguage): string {
  return translations?.[language] ?? text;
}

export function resolveHandoffLabel(
  handoff: { label: string; labelTranslations?: ManifestTextTranslations },
  language: AppLanguage,
): string {
  return resolveManifestText(handoff.label, handoff.labelTranslations, language);
}
