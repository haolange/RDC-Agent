import { app, dialog } from 'electron';
import { languageForLocale, nativeText } from './nativeMessages';

export interface SettingsStartupFailureText {
  title: string;
  message: string;
  detail: string;
}

/**
 * What the user reads when the settings file cannot be used at startup. Settings are unreadable at this point, so the
 * language comes from the system locale. The file is never converted or repaired: the user deletes it and reconfigures.
 */
export function settingsStartupFailureText(locale: string, filePath: string): SettingsStartupFailureText {
  const language = languageForLocale(locale);
  return {
    title: nativeText(language, 'settingsUnusableTitle'),
    message: nativeText(language, 'settingsUnusableMessage'),
    detail: nativeText(language, 'settingsUnusableDetail', { file: filePath }),
  };
}

/** A native error box on the desktop; headless and Browser QA runs print the same text to stderr instead. */
export function reportSettingsStartupFailure(filePath: string, headless: boolean): void {
  const text = settingsStartupFailureText(app.getLocale(), filePath);
  if (headless) {
    process.stderr.write(`${text.title}\n${text.message}\n${text.detail}\n`);
    return;
  }
  dialog.showMessageBoxSync({ type: 'error', title: text.title, message: text.message, detail: text.detail });
}
