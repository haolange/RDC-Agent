import { z } from 'zod';
import type { HandoffLabelTranslations } from '../types/agentManifest';
import type { AppLanguage } from '../types/settings';

const translatedLabel = z.string().trim().min(1).max(200);
export const handoffLabelTranslationsSchema = z.object({
  'zh-CN': translatedLabel.optional(),
  en: translatedLabel.optional(),
}).strict().refine(value => Object.values(value).some(label => label !== undefined), {
  message: 'At least one translated label is required when labelTranslations is present.',
});

export function resolveHandoffLabel(
  handoff: { label: string; labelTranslations?: HandoffLabelTranslations },
  language: AppLanguage,
): string {
  return handoff.labelTranslations?.[language] ?? handoff.label;
}
