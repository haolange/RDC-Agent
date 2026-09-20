import type { ThemeChromeConfig, ThemeVariant } from '@shared/types/settings';
import { parseRdcThemeV1 } from '@shared/theme/rdcThemeV1';
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
  const result = parseRdcThemeV1(text, variant);
  return result.ok ? { state: 'valid', chrome: result.chrome } : { state: 'invalid', error: result.error };
}

export function themeImportErrorMessage(error: string, t: AppearanceTranslate): string {
  if (error.includes('must start with') || error.includes('not supported')) return t('settings.appearanceImportPrefixError');
  if (error.includes('Invalid JSON')) return t('settings.appearanceImportJsonError');
  if (error.includes('variant must be')) return t('settings.appearanceImportVariantError');
  if (error.includes('but this Import targets')) return t('settings.appearanceImportTargetError');
  return t('settings.appearanceImportPayloadError');
}
