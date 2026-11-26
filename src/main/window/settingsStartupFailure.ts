import { app, dialog } from 'electron';
import { languageForLocale, nativeText } from './nativeMessages';

export interface SettingsStartupFailureText {
  title: string;
  message: string;
  detail: string;
}

/**
 * What the user reads when the settings file cannot be used at startup. Settings are unreadable at this point, so the
 * language comes from the system locale. Persisted formats carry no version and nothing is converted or repaired: a
 * format change fails here first, so the user deletes the whole data directory and the settings file and starts again.
 */
export function settingsStartupFailureText(
  locale: string,
  filePath: string,
  dataDirectory: string,
): SettingsStartupFailureText {
  const language = languageForLocale(locale);
  return {
    title: nativeText(language, 'settingsUnusableTitle'),
    message: nativeText(language, 'settingsUnusableMessage'),
    detail: nativeText(language, 'settingsUnusableDetail', { file: filePath, dataDirectory }),
  };
}

/** A native error box on the desktop; headless and Browser QA runs print the same text to stderr instead. */
export function reportSettingsStartupFailure(filePath: string, headless: boolean): void {
  const text = settingsStartupFailureText(app.getLocale(), filePath, app.getPath('userData'));
  if (headless) {
    process.stderr.write(`${text.title}\n${text.message}\n${text.detail}\n`);
    return;
  }
  dialog.showMessageBoxSync({ type: 'error', title: text.title, message: text.message, detail: text.detail });
}
