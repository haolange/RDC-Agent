import { parseRdcThemeV1, type RdcThemeV1Rejection } from '@shared/theme/rdcThemeV1';
import type { ThemeChromeConfig, ThemeVariant } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

export type AppearanceTranslate = ReturnType<typeof useI18n>['t'];

export type ThemeImportPreview =
  | { state: 'empty' }
  | { state: 'invalid'; reason: RdcThemeV1Rejection; error: string }
  | { state: 'valid'; chrome: ThemeChromeConfig };

/**
 * Only a non-empty payload is parsed, so an untouched field stays neutral
 * instead of reporting an error the user has not caused yet.
 */
export function previewThemeImport(text: string, variant: ThemeVariant): ThemeImportPreview {
  if (!text.trim()) return { state: 'empty' };
  const result = parseRdcThemeV1(text, variant);
  return result.ok
    ? { state: 'valid', chrome: result.chrome }
    : { state: 'invalid', reason: result.reason, error: result.error };
}

const THEME_IMPORT_ERROR_COPY = {
  prefix: 'settings.appearanceImportPrefixError',
  json: 'settings.appearanceImportJsonError',
  payload: 'settings.appearanceImportPayloadError',
  variant: 'settings.appearanceImportVariantError',
  target: 'settings.appearanceImportTargetError',
} as const satisfies Record<RdcThemeV1Rejection, string>;

export function themeImportErrorMessage(reason: RdcThemeV1Rejection, t: AppearanceTranslate): string {
  return t(THEME_IMPORT_ERROR_COPY[reason]);
}
