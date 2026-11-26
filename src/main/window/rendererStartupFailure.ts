import { dialog, type BrowserWindow } from 'electron';
import { settingsService } from '../settings/settings-core/SettingsService';
import { nativeText } from './nativeMessages';
import type { AppLanguage } from '@shared/types/settings';

export interface RendererStartupFailureText {
  title: string;
  message: string;
  detail: string;
  buttons: [reload: string, quit: string];
}

/**
 * What the person reads when the window's renderer cannot start: loading its document failed, or it died again while
 * showing the failure page. Settings are readable here, so the committed language is used.
 */
export function rendererStartupFailureText(language: AppLanguage, reason: string): RendererStartupFailureText {
  return {
    title: nativeText(language, 'rendererFailureTitle'),
    message: nativeText(language, 'rendererFailureMessage'),
    detail: nativeText(language, 'rendererFailureDetail', { reason }),
    buttons: [nativeText(language, 'reload'), nativeText(language, 'quit')],
  };
}

/** A native box with Reload and Quit, the last way out when no renderer can show anything. */
export async function askRendererStartupFailure(window: BrowserWindow, reason: string): Promise<'reload' | 'quit'> {
  const text = rendererStartupFailureText(settingsService.snapshot().user.appearance.language, reason);
  const { response } = await dialog.showMessageBox(window, {
    type: 'error',
    title: text.title,
    message: text.message,
    detail: text.detail,
    buttons: text.buttons,
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  return response === 0 ? 'reload' : 'quit';
}
