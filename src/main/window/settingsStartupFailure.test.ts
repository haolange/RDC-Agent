import { afterEach, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({ locale: 'en-US', showMessageBoxSync: vi.fn(() => 0) }));
vi.mock('electron', () => ({
  app: { getLocale: () => electron.locale },
  dialog: { showMessageBoxSync: electron.showMessageBoxSync },
}));

import { reportSettingsStartupFailure, settingsStartupFailureText } from './settingsStartupFailure';

const FILE = '/home/user/.rdc-agent/config.json';

afterEach(() => {
  electron.locale = 'en-US';
  vi.restoreAllMocks();
  electron.showMessageBoxSync.mockClear();
});

it('names the settings file in the system language', () => {
  expect(settingsStartupFailureText('zh-CN', FILE).detail).toContain(
    `请删除下面这个文件，然后重新启动 RDC-Agent：\n${FILE}`,
  );
  expect(settingsStartupFailureText('zh-TW', FILE).title).toBe('RDC-Agent 无法启动');
  const english = settingsStartupFailureText('fr-FR', FILE);
  expect(english.title).toBe('RDC-Agent cannot start');
  expect(english.detail).toContain(`Delete this file, then start RDC-Agent again:\n${FILE}`);
});

it('shows a native error box on the desktop', () => {
  electron.locale = 'zh-CN';
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  reportSettingsStartupFailure(FILE, false);
  expect(electron.showMessageBoxSync).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'error',
      title: 'RDC-Agent 无法启动',
      detail: expect.stringContaining(FILE),
    }),
  );
  expect(stderr).not.toHaveBeenCalled();
});

it('prints the same text to stderr without a dialog when headless', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  reportSettingsStartupFailure(FILE, true);
  const text = settingsStartupFailureText('en-US', FILE);
  expect(stderr).toHaveBeenCalledWith(`${text.title}\n${text.message}\n${text.detail}\n`);
  expect(electron.showMessageBoxSync).not.toHaveBeenCalled();
});
