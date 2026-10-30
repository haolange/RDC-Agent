import { settingsService } from '../settings/SettingsService';
import { nativeText, type NativeMessageKey } from './nativeMessages';

/** Read the committed language when the native surface opens. */
export const nativeMessage = (key: NativeMessageKey, params?: Record<string, string | number>): string =>
  nativeText(settingsService.getAll().appearance.language, key, params);
