import { beforeEach, expect, it, vi } from 'vitest';
import { nativeChinese, nativeEnglish, nativeText } from './nativeMessages';

const state = vi.hoisted(() => ({
  language: 'zh-CN', template: [] as Electron.MenuItemConstructorOptions[],
  showMessageBox: vi.fn(async () => ({ response: 1 })),
  setApplicationMenu: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getVersion: () => 'test-version' },
  dialog: { showMessageBox: state.showMessageBox },
  Menu: {
    buildFromTemplate: (template: Electron.MenuItemConstructorOptions[]) => { state.template = template; return template; },
    setApplicationMenu: state.setApplicationMenu,
  },
  shell: { openExternal: vi.fn() },
}));
vi.mock('../settings/SettingsService', () => ({ settingsService: {
  getAll: () => ({ appearance: { language: state.language } }),
} }));

import { installApplicationMenu, refreshApplicationMenu } from './applicationMenu';
import { nativeMessage } from './nativeI18n';

beforeEach(() => { state.language = 'zh-CN'; vi.clearAllMocks(); });

it('has complete native translations with matching parameters', () => {
  expect(Object.keys(nativeChinese).sort()).toEqual(Object.keys(nativeEnglish).sort());
  for (const key of Object.keys(nativeEnglish) as Array<keyof typeof nativeEnglish>) {
    expect(nativeChinese[key].match(/\{\w+\}/g) ?? []).toEqual(nativeEnglish[key].match(/\{\w+\}/g) ?? []);
    expect(nativeText('en', key)).toBe(nativeEnglish[key]);
    expect(nativeText('zh-CN', key)).toBe(nativeChinese[key]);
  }
  expect(nativeText('zh-CN', 'version', { version: '1.2.3' })).toBe('版本：1.2.3');
});

it('refreshes an installed native menu and reads the current language when About opens', async () => {
  installApplicationMenu({ openRdcFiles: vi.fn(), newCase: vi.fn(), openSettings: vi.fn() });
  const labels = () => state.template.map(item => item.label);
  expect(labels()).toContain('帮助');
  state.language = 'en';
  refreshApplicationMenu();
  expect(labels()).toContain('Help');
  const help = state.template.find(item => item.label === 'Help')!;
  const about = (help.submenu as Electron.MenuItemConstructorOptions[]).find(item => item.label === 'About RDC-Agent')!;
  await (about.click as () => void)();
  expect(state.showMessageBox.mock.calls[0]).toEqual([expect.objectContaining({ title: 'About RDC-Agent', detail: expect.stringContaining('Version: test-version') })]);
  state.language = 'zh-CN';
  refreshApplicationMenu();
  expect(labels()).toContain('帮助');
  expect(nativeMessage('cancel')).toBe('取消');
  expect(state.setApplicationMenu).toHaveBeenCalledTimes(3);
});
