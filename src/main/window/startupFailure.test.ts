import { afterEach, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({ locale: 'en-US', showMessageBoxSync: vi.fn(() => 0) }));
vi.mock('electron', () => ({
  app: { getLocale: () => electron.locale, getPath: (name: string) => (name === 'userData' ? DATA : '') },
  dialog: { showMessageBoxSync: electron.showMessageBoxSync },
}));

import {
  reportSettingsStartupFailure,
  reportStoredDataStartupFailure,
  settingsStartupFailureText,
} from './startupFailure';

const FILE = '/home/user/.rdc-agent/config.json';
const DATA = '/home/user/.config/RDC-Agent';

afterEach(() => {
  electron.locale = 'en-US';
  vi.restoreAllMocks();
  electron.showMessageBoxSync.mockClear();
});

it('asks for the whole data directory and the settings file to be deleted, in the system language', () => {
  const chinese = settingsStartupFailureText('zh-CN', FILE, DATA);
  expect(chinese.message).toContain('数据格式已变更');
  expect(chinese.detail).toContain(`请删除整个数据目录和设置文件，然后重新启动 RDC-Agent：\n${DATA}\n${FILE}`);
  expect(settingsStartupFailureText('zh-TW', FILE, DATA).title).toBe('RDC-Agent 无法启动');
  const english = settingsStartupFailureText('fr-FR', FILE, DATA);
  expect(english.title).toBe('RDC-Agent cannot start');
  expect(english.message).toContain('data format has changed');
  expect(english.detail).toContain(
    `Delete the whole data directory and the settings file, then start RDC-Agent again:\n${DATA}\n${FILE}`,
  );
});

it('shows a native error box naming the userData directory on the desktop', () => {
  electron.locale = 'zh-CN';
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  reportSettingsStartupFailure(FILE, false);
  expect(electron.showMessageBoxSync).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'error',
      title: 'RDC-Agent 无法启动',
      detail: expect.stringContaining(`${DATA}\n${FILE}`),
    }),
  );
  expect(stderr).not.toHaveBeenCalled();
});

it('prints the same text to stderr without a dialog when headless', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  reportSettingsStartupFailure(FILE, true);
  const text = settingsStartupFailureText('en-US', FILE, DATA);
  expect(stderr).toHaveBeenCalledWith(`${text.title}\n${text.message}\n${text.detail}\n`);
  expect(electron.showMessageBoxSync).not.toHaveBeenCalled();
});

it('names the unreadable application record and data directory in the desktop error box', () => {
  electron.locale = 'zh-CN';
  const registry = `${DATA}/state/projects/registry.json`;
  reportStoredDataStartupFailure(registry, false);
  expect(electron.showMessageBoxSync).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'error',
      message: 'RDC-Agent 无法读取本地数据文件。',
      detail: expect.stringContaining(`${registry}\n${DATA}`),
    }),
  );
});
