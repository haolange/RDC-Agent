import type { ThemeChromeConfig, ThemeVariant } from '@shared/types/settings';
import { parseRdxThemeV1 } from '@shared/theme/rdxThemeV1';
import type { useI18n } from '../../../../i18n';

export type AppearanceTranslate = ReturnType<typeof useI18n>['t'];

export type ThemeImportPreview =
  | { state: 'empty' }
  | { state: 'invalid'; error: string }
  | { state: 'valid'; chrome: ThemeChromeConfig };

/**
 * Only a non-empty payload is parsed, so an untouched field stays neutral
 * instead of reporting an error the user has not caused yet.
 */
export function previewThemeImport(text: string, variant: ThemeVariant): ThemeImportPreview {
  if (!text.trim()) return { state: 'empty' };
  const result = parseRdxThemeV1(text, variant);
  return result.ok ? { state: 'valid', chrome: result.chrome } : { state: 'invalid', error: result.error };
}
